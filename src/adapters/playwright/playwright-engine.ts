import {
  crx,
  type CrxApplication,
  type Page
} from "playwright-crx";

import {
  AutomationEngineError,
  isAutomationEngineError,
  type AutomationEngineErrorContext
} from "../../core/domain/automation-engine-error";
import type {
  AutomationStep,
  ElementTarget
} from "../../core/domain/automation-step";
import type { AutomationSessionId } from "../../core/domain/run-session";
import type {
  AutomationEngine,
  AutomationSessionHandle,
  AutomationStepExecutionResult,
  ExecuteAutomationStepRequest,
  StartAutomationRequest,
  StopAllAutomationsRequest,
  StopAutomationRequest
} from "../../core/ports/automation-engine";
import {
  CustomJavaScriptStopError,
  CustomJavaScriptTimeoutError
} from "./custom-javascript-executor";
import { executePlaywrightStep } from "./playwright-step-executor";

export type PlaywrightPageSnapshot = {
  tabId: number;
  title: string;
  url: string;
};

export type HtmlModalSmokeResult = {
  closed: boolean;
  inputValue: string;
  opened: boolean;
};

type CrxRuntime = Pick<typeof crx, "start">;

export interface PlaywrightEngineOptions {
  readonly inspectFrames?: (tabId: number) => Promise<readonly string[]>;
}

class ProtectedExtensionFrameError extends Error {
  readonly frameCount: number;

  constructor(frameCount: number) {
    super(
      `Cannot access ${frameCount} chrome-extension:// frame${frameCount === 1 ? "" : "s"} owned by another extension`
    );
    this.name = "ProtectedExtensionFrameError";
    this.frameCount = frameCount;
  }
}

/**
 * Thin boundary around playwright-crx.
 *
 * The rest of the application must not import playwright-crx directly. The
 * package is experimental for this project and can be replaced without
 * changing the automation domain model.
 */
export class PlaywrightEngine implements AutomationEngine {
  readonly #runtime: CrxRuntime;
  readonly #inspectFrames: (tabId: number) => Promise<readonly string[]>;
  readonly #pages = new Map<number, Page>();
  readonly #tabIdBySessionId = new Map<AutomationSessionId, number>();
  readonly #sessionIdByTabId = new Map<number, AutomationSessionId>();
  #applicationPromise?: Promise<CrxApplication>;

  constructor(
    runtime: CrxRuntime = crx,
    options: PlaywrightEngineOptions = {}
  ) {
    this.#runtime = runtime;
    this.#inspectFrames = options.inspectFrames ?? inspectTabFrames;
  }

  async start(
    request: StartAutomationRequest
  ): Promise<AutomationSessionHandle> {
    const { sessionId, target } = request;
    this.#assertEngineTabId(target.tabId);

    if (
      this.#tabIdBySessionId.has(sessionId) ||
      this.#sessionIdByTabId.has(target.tabId)
    ) {
      throw new AutomationEngineError(
        "session-conflict",
        `Automation session conflicts with tab ${target.tabId}`,
        { context: { sessionId, tabId: target.tabId } }
      );
    }

    this.#tabIdBySessionId.set(sessionId, target.tabId);
    this.#sessionIdByTabId.set(target.tabId, sessionId);

    try {
      await this.attach(target.tabId);
      return { sessionId, target: { tabId: target.tabId } };
    } catch (error) {
      this.#removeSessionForTab(target.tabId);
      throw this.#toEngineError(
        "engine-unavailable",
        attachFailureMessage(target.tabId, error),
        error,
        { sessionId, tabId: target.tabId }
      );
    }
  }

  async executeStep(
    request: ExecuteAutomationStepRequest
  ): Promise<AutomationStepExecutionResult> {
    const tabId = this.#requireSession(request.sessionId);
    const page = this.#pages.get(tabId);

    if (!page) {
      throw new AutomationEngineError(
        "engine-unavailable",
        `Attached page for session ${request.sessionId} is unavailable`,
        { context: this.#stepContext(request, tabId) }
      );
    }

    try {
      const output = await executePlaywrightStep(page, request);
      return {
        sessionId: request.sessionId,
        stepId: request.step.id,
        stepIndex: request.stepIndex,
        output
      };
    } catch (error) {
      const safeError = sanitizeStepFailure(error, request.step);
      const code =
        safeError instanceof CustomJavaScriptStopError
          ? "session-stopped"
          : isStepTimeout(safeError)
            ? "step-timeout"
            : "step-failed";
      throw this.#toEngineError(
        code,
        `Automation step ${request.step.id} failed: ${errorMessage(safeError)}`,
        safeError,
        this.#stepContext(request, tabId)
      );
    }
  }

  async complete(sessionId: AutomationSessionId): Promise<void> {
    await this.#detachSession(sessionId);
  }

  async stop(request: StopAutomationRequest): Promise<void> {
    await this.#detachSession(request.sessionId);
  }

  async stopAll(_request: StopAllAutomationsRequest): Promise<void> {
    try {
      await this.detachAll();
    } catch (error) {
      throw this.#toEngineError(
        "engine-unavailable",
        "Could not stop all automation sessions",
        error
      );
    }
  }

  async attach(tabId: number): Promise<Page> {
    this.#assertTabId(tabId);

    const attachedPage = this.#pages.get(tabId);
    if (attachedPage) {
      return attachedPage;
    }

    const frames = await this.#inspectFrames(tabId).catch(() => []);
    const protectedFrameCount = frames.filter(isForeignExtensionFrame).length;
    if (protectedFrameCount > 0) {
      throw new ProtectedExtensionFrameError(protectedFrameCount);
    }

    const application = await this.#application();
    try {
      const page = await application.attach(tabId);
      this.#pages.set(tabId, page);
      return page;
    } catch (error) {
      // playwright-crx can fail after chrome.debugger has already attached,
      // especially while discovering an inaccessible OOPIF. Always release
      // only this tab so a reload can start a clean session and other tabs stay
      // attached.
      await application.detach(tabId).catch(() => undefined);
      this.#pages.delete(tabId);
      this.#removeSessionForTab(tabId);
      throw error;
    }
  }

  async snapshot(tabId: number): Promise<PlaywrightPageSnapshot> {
    const page = await this.attach(tabId);

    return {
      tabId,
      title: await page.title(),
      url: page.url()
    };
  }

  async reload(tabId: number): Promise<PlaywrightPageSnapshot> {
    const page = await this.attach(tabId);
    await page.reload({ waitUntil: "domcontentloaded" });
    return this.snapshot(tabId);
  }

  async testHtmlModal(tabId: number): Promise<HtmlModalSmokeResult> {
    const page = await this.attach(tabId);
    const modal = page.locator("[data-spike-modal]");
    const input = modal.locator("[data-spike-modal-input]");

    await page.locator("[data-spike-open-modal]").click();
    await modal.waitFor({ state: "visible" });
    await input.fill("Playwright CRX modal test");
    const inputValue = await input.inputValue();
    await modal.locator("[data-spike-close-modal]").click();
    await modal.waitFor({ state: "hidden" });

    return {
      closed: await modal.isHidden(),
      inputValue,
      opened: true
    };
  }

  attachedTabIds(): number[] {
    return [...this.#pages.keys()].sort((left, right) => left - right);
  }

  async detach(tabId: number): Promise<void> {
    this.#assertTabId(tabId);

    if (!this.#pages.has(tabId)) {
      this.#removeSessionForTab(tabId);
      return;
    }

    const application = await this.#application();
    await application.detach(tabId);
    this.#pages.delete(tabId);
    this.#removeSessionForTab(tabId);
  }

  async detachAll(): Promise<void> {
    if (!this.#applicationPromise) {
      this.#clearSessions();
      return;
    }

    const application = await this.#applicationPromise;
    await application.detachAll();
    this.#pages.clear();
    this.#clearSessions();
  }

  async close(): Promise<void> {
    if (!this.#applicationPromise) {
      this.#clearSessions();
      return;
    }

    const application = await this.#applicationPromise;
    await application.close();
    this.#pages.clear();
    this.#clearSessions();
    this.#applicationPromise = undefined;
  }

  async #application(): Promise<CrxApplication> {
    if (!this.#applicationPromise) {
      this.#applicationPromise = this.#runtime.start();

      try {
        const application = await this.#applicationPromise;
        application.on("detached", (tabId) => {
          this.#pages.delete(tabId);
          this.#removeSessionForTab(tabId);
        });
      } catch (error) {
        this.#applicationPromise = undefined;
        throw error;
      }
    }

    return this.#applicationPromise;
  }

  #assertTabId(tabId: number): void {
    if (!Number.isInteger(tabId) || tabId < 0) {
      throw new TypeError(`Invalid Chrome tab id: ${tabId}`);
    }
  }

  #assertEngineTabId(tabId: number): void {
    if (!Number.isInteger(tabId) || tabId < 0) {
      throw new AutomationEngineError(
        "invalid-target",
        `Invalid Chrome tab id: ${tabId}`,
        { context: { tabId } }
      );
    }
  }

  #requireSession(sessionId: AutomationSessionId): number {
    const tabId = this.#tabIdBySessionId.get(sessionId);
    if (tabId === undefined) {
      throw new AutomationEngineError(
        "session-not-found",
        `Automation session ${sessionId} was not found`,
        { context: { sessionId } }
      );
    }
    return tabId;
  }

  async #detachSession(sessionId: AutomationSessionId): Promise<void> {
    const tabId = this.#requireSession(sessionId);
    try {
      await this.detach(tabId);
    } catch (error) {
      throw this.#toEngineError(
        "engine-unavailable",
        `Could not detach automation session ${sessionId}`,
        error,
        { sessionId, tabId }
      );
    }
  }

  #removeSessionForTab(tabId: number): void {
    const sessionId = this.#sessionIdByTabId.get(tabId);
    if (sessionId !== undefined) {
      this.#sessionIdByTabId.delete(tabId);
      this.#tabIdBySessionId.delete(sessionId);
    }
  }

  #clearSessions(): void {
    this.#sessionIdByTabId.clear();
    this.#tabIdBySessionId.clear();
  }

  #stepContext(request: ExecuteAutomationStepRequest, tabId: number) {
    const target = stepTarget(request.step);
    return {
      sessionId: request.sessionId,
      tabId,
      stepId: request.step.id,
      stepIndex: request.stepIndex,
      stepNumber: request.stepIndex + 1,
      stepType: request.step.type,
      ...(request.step.name === undefined
        ? {}
        : { stepName: request.step.name }),
      action: request.step.type,
      ...(target === undefined ? {} : { target: structuredClone(target) }),
      ...(request.step.type === "select"
        ? { selectOption: structuredClone(request.step.option) }
        : {}),
      ...(request.step.type === "pressKey" ? { key: request.step.key } : {})
    };
  }

  #toEngineError(
    code:
      | "engine-unavailable"
      | "session-stopped"
      | "step-failed"
      | "step-timeout",
    message: string,
    error: unknown,
    context: AutomationEngineErrorContext = {}
  ): AutomationEngineError {
    if (isAutomationEngineError(error)) {
      return error;
    }
    return new AutomationEngineError(code, message, { cause: error, context });
  }
}

function isStepTimeout(error: unknown): boolean {
  return (
    error instanceof CustomJavaScriptTimeoutError ||
    (error instanceof Error && error.name === "TimeoutError")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function attachFailureMessage(tabId: number, error: unknown): string {
  const message = errorChainText(error);
  if (
    error instanceof ProtectedExtensionFrameError ||
    message.includes("Cannot access a chrome-extension:// URL of different extension") ||
    /chrome-extension:\/\/.*different extension/i.test(message)
  ) {
    return (
      `Could not attach automation session to tab ${tabId}. ` +
      "Another extension injected a protected frame into this page. " +
      "Close its popup or disable it for this site, reload the tab, and try again."
    );
  }
  if (
    /another debugger|debugger is already attached|already attached to the tab/i.test(
      message
    )
  ) {
    return (
      `Could not attach automation session to tab ${tabId}. ` +
      "DevTools or another automation tool is already controlling this tab. " +
      "Close it, reload the page, and try again."
    );
  }
  if (/no tab|tab .*not found|target closed|inspected target navigated or closed/i.test(message)) {
    return (
      `Could not attach automation session to tab ${tabId}. ` +
      "The tab was closed or became unavailable. Open the HTTP/HTTPS page again and retry."
    );
  }
  if (/cannot access contents of url|cannot attach to this target/i.test(message)) {
    return (
      `Could not attach automation session to tab ${tabId}. ` +
      "Automation is only available on ordinary HTTP or HTTPS pages."
    );
  }
  return (
    `Could not attach automation session to tab ${tabId}. ` +
    "Reload the page and try again. If the problem continues, close DevTools and disable other automation extensions for this site."
  );
}

function errorChainText(error: unknown): string {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !visited.has(current)) {
    visited.add(current);
    messages.push(errorMessage(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages.join("\n");
}

async function inspectTabFrames(tabId: number): Promise<readonly string[]> {
  if (
    typeof chrome === "undefined" ||
    chrome.webNavigation?.getAllFrames === undefined
  ) {
    return [];
  }
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  return frames?.map(({ url }) => url) ?? [];
}

function isForeignExtensionFrame(url: string): boolean {
  if (!url.startsWith("chrome-extension://")) return false;
  if (typeof chrome === "undefined" || chrome.runtime?.getURL === undefined) {
    return true;
  }
  return !url.startsWith(chrome.runtime.getURL(""));
}

function stepTarget(step: AutomationStep): ElementTarget | undefined {
  if ("target" in step && step.target !== undefined) {
    return step.target;
  }
  return step.type === "wait" && step.condition.type === "element"
    ? step.condition.target
    : undefined;
}

function sanitizeStepFailure(error: unknown, step: AutomationStep): unknown {
  if (step.type !== "input" || step.value.length === 0) {
    return error;
  }

  const redact = (value: string) => value.replaceAll(step.value, "[REDACTED]");
  if (!(error instanceof Error)) {
    return typeof error === "string" ? redact(error) : error;
  }

  const sanitized = new Error(redact(error.message), {
    cause:
      error.cause instanceof Error
        ? `${error.cause.name}: ${redact(error.cause.message)}`
        : typeof error.cause === "string"
          ? redact(error.cause)
          : error.cause
  });
  sanitized.name = error.name;
  if (error.stack !== undefined) {
    sanitized.stack = redact(error.stack);
  }
  return sanitized;
}
