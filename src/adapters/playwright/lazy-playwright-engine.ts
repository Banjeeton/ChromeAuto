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
import type {
  HtmlModalSmokeResult,
  PlaywrightEngine,
  PlaywrightPageSnapshot
} from "./playwright-engine";

type PlaywrightEngineRuntime = Pick<
  PlaywrightEngine,
  | keyof AutomationEngine
  | "snapshot"
  | "reload"
  | "testHtmlModal"
  | "detachAll"
>;

export type PlaywrightEngineLoader = () => Promise<PlaywrightEngineRuntime>;

/**
 * Keeps the experimental Playwright CRX bundle out of the service worker's
 * startup path. Preset management remains available even if the browser
 * automation runtime cannot be loaded by the current Chrome version.
 */
export class LazyPlaywrightEngine implements AutomationEngine {
  readonly #loader: PlaywrightEngineLoader;
  #enginePromise?: Promise<PlaywrightEngineRuntime>;

  constructor(loader: PlaywrightEngineLoader = loadPlaywrightEngine) {
    this.#loader = loader;
  }

  async start(
    request: StartAutomationRequest
  ): Promise<AutomationSessionHandle> {
    return (await this.#engine()).start(request);
  }

  async executeStep(
    request: ExecuteAutomationStepRequest
  ): Promise<AutomationStepExecutionResult> {
    return (await this.#engine()).executeStep(request);
  }

  async complete(sessionId: AutomationSessionId): Promise<void> {
    await (await this.#engine()).complete(sessionId);
  }

  async stop(request: StopAutomationRequest): Promise<void> {
    await (await this.#engine()).stop(request);
  }

  async stopAll(request: StopAllAutomationsRequest): Promise<void> {
    await (await this.#engine()).stopAll(request);
  }

  async snapshot(tabId: number): Promise<PlaywrightPageSnapshot> {
    return (await this.#engine()).snapshot(tabId);
  }

  async reload(tabId: number): Promise<PlaywrightPageSnapshot> {
    return (await this.#engine()).reload(tabId);
  }

  async testHtmlModal(tabId: number): Promise<HtmlModalSmokeResult> {
    return (await this.#engine()).testHtmlModal(tabId);
  }

  async detachAll(): Promise<void> {
    await (await this.#engine()).detachAll();
  }

  async #engine(): Promise<PlaywrightEngineRuntime> {
    if (this.#enginePromise === undefined) {
      this.#enginePromise = this.#loader().catch((error: unknown) => {
        this.#enginePromise = undefined;
        throw error;
      });
    }
    return this.#enginePromise;
  }
}

async function loadPlaywrightEngine(): Promise<PlaywrightEngineRuntime> {
  const runtimeUrl = chrome.runtime.getURL("background/playwright-engine.js");
  const { PlaywrightEngine } = (await import(
    /* @vite-ignore */ runtimeUrl
  )) as typeof import("./playwright-engine");
  return new PlaywrightEngine();
}
