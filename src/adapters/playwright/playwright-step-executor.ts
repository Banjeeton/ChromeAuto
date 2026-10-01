import type { Locator, Page } from "playwright-crx";

import type {
  ElementLocator,
  ElementTarget,
  InputStep,
  PressKeyStep,
  SelectStep,
  WaitStep
} from "../../core/domain/automation-step";
import { isSupportedAutomationKey } from "../../core/domain/automation-key";
import type { ExecuteAutomationStepRequest } from "../../core/ports/automation-engine";
import { executeCustomJavaScript } from "./custom-javascript-executor";

export interface PlaywrightStepExecutorOptions {
  readonly random?: () => number;
}

/** Executes one domain step without exposing Playwright types to core. */
export async function executePlaywrightStep(
  page: Page,
  request: ExecuteAutomationStepRequest,
  options: PlaywrightStepExecutorOptions = {}
): Promise<unknown> {
  const { step } = request;
  if (!step.enabled) {
    return undefined;
  }

  const timeout = step.timeoutMs ?? request.defaults.timeoutMs;
  let output: unknown;

  switch (step.type) {
    case "click": {
      const locator = await resolveTarget(page, step.target);
      await locator.click({
        button: step.button,
        clickCount: step.clickCount,
        timeout
      });
      break;
    }

    case "input": {
      const locator = await resolveTarget(page, step.target);
      await executeInputStep(
        page,
        locator,
        step,
        request.defaults.humanInput,
        timeout,
        options.random ?? Math.random
      );
      break;
    }

    case "select": {
      const locator = await resolveTarget(page, step.target);
      await executeSelectStep(locator, step, timeout);
      break;
    }

    case "check": {
      const locator = await resolveTarget(page, step.target);
      await locator.check({ timeout });
      break;
    }

    case "uncheck": {
      const locator = await resolveTarget(page, step.target);
      await locator.uncheck({ timeout });
      break;
    }

    case "pressKey":
      await executePressKeyStep(page, step, timeout);
      break;

    case "wait":
      await executeWaitStep(page, step, timeout);
      break;

    case "reload":
      await page.reload({
        timeout,
        waitUntil: step.waitUntil === "none" ? "commit" : step.waitUntil
      });
      break;

    case "customCode":
      output = await executeCustomJavaScript(page, step, timeout);
      break;

    default:
      throw new Error("Automation step type is not implemented");
  }

  const postActionDelay =
    step.postActionDelayMs ?? request.defaults.postActionDelayMs;
  if (postActionDelay > 0) {
    await page.waitForTimeout(postActionDelay);
  }

  return output;
}

async function executePressKeyStep(
  page: Page,
  step: PressKeyStep,
  timeout: number
): Promise<void> {
  if (!isSupportedAutomationKey(step.key)) {
    throw new Error(`Unsupported pressKey value: ${JSON.stringify(step.key)}`);
  }

  if (step.target !== undefined) {
    const locator = await resolveTarget(page, step.target);
    await locator.press(step.key, { timeout });
    return;
  }

  await withTimeout(
    page.keyboard.press(step.key),
    timeout,
    `Page pressKey ${JSON.stringify(step.key)} timed out after ${timeout} ms`
  );
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      const error = new Error(message);
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);

    operation.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

async function executeSelectStep(
  locator: Locator,
  step: SelectStep,
  timeout: number
): Promise<void> {
  switch (step.option.by) {
    case "value":
      await locator.selectOption({ value: step.option.value }, { timeout });
      return;
    case "label":
      await locator.selectOption({ label: step.option.value }, { timeout });
      return;
    case "index":
      await locator.selectOption({ index: step.option.value }, { timeout });
  }
}

async function executeInputStep(
  page: Page,
  locator: Locator,
  step: InputStep,
  defaults: ExecuteAutomationStepRequest["defaults"]["humanInput"],
  timeout: number,
  random: () => number
): Promise<void> {
  const humanInputEnabled =
    step.inputMode === "human" ||
    (step.inputMode === "default" && defaults.enabled);

  if (!humanInputEnabled && step.clearFirst) {
    await locator.fill(step.value, { timeout });
    return;
  }

  if (step.clearFirst) {
    await locator.fill("", { timeout });
  }

  if (!humanInputEnabled) {
    await locator.pressSequentially(step.value, { delay: 0, timeout });
    return;
  }

  const delays = step.humanInput ?? defaults;
  const characters = [...step.value];
  for (const [index, character] of characters.entries()) {
    await locator.pressSequentially(character, { delay: 0, timeout });
    if (index < characters.length - 1) {
      await page.waitForTimeout(
        randomInteger(delays.minDelayMs, delays.maxDelayMs, random)
      );
    }
  }
}

async function executeWaitStep(
  page: Page,
  step: WaitStep,
  timeout: number
): Promise<void> {
  const { condition } = step;

  switch (condition.type) {
    case "timeout":
      await page.waitForTimeout(condition.durationMs);
      return;

    case "element": {
      // Hidden and detached waits must also be able to address an element that
      // is currently invisible, so they intentionally bypass actionability
      // filtering used by interactive steps.
      const locator = await resolveTarget(page, condition.target, "any");
      await locator.waitFor({ state: condition.state, timeout });
      return;
    }

    case "url":
      await page.waitForURL(createUrlMatcher(condition.match, condition.value), {
        timeout
      });
      return;

    case "pageLoad":
      await page.waitForLoadState(condition.state, { timeout });
  }
}

function createUrlMatcher(
  match: "exact" | "contains" | "regex",
  value: string
): (url: URL) => boolean {
  if (match === "exact") {
    return (url) => url.href === value;
  }
  if (match === "contains") {
    return (url) => url.href.includes(value);
  }

  const expression = new RegExp(value);
  return (url) => expression.test(url.href);
}

type TargetVisibility = "visible" | "any";

async function resolveTarget(
  page: Page,
  target: ElementTarget,
  visibility: TargetVisibility = "visible"
): Promise<Locator> {
  const locators = [target.primary, ...target.fallbacks].map((locator) => {
    const candidate = createLocator(page, locator);

    // Custom dropdowns commonly keep a hidden copy of the selected value in
    // the DOM while rendering the open option list in an overlay. Selecting
    // `.first()` before filtering can therefore bind a click to the hidden
    // copy. The DOM order of those copies may change between renders, which
    // makes the failure appear intermittent. A visible locator is re-evaluated
    // by Playwright while it auto-waits, so delayed overlay animations remain
    // deterministic as well.
    const supportsVisibilityFilter =
      typeof (candidate as Partial<Locator>).filter === "function";

    return (visibility === "visible" && supportsVisibilityFilter
      ? candidate.filter({ visible: true })
      : candidate
    ).first();
  });

  for (const locator of locators) {
    try {
      if ((await locator.count()) > 0) {
        return locator;
      }
    } catch {
      // A malformed or stale primary locator must not prevent a valid fallback
      // from being selected. The action below will still expose an error when
      // every locator is unusable.
    }
  }

  // Preserve Playwright auto-waiting for any locator that appears after the
  // step starts. The immediate scan above keeps primary/fallback priority when
  // an element already exists.
  return locators
    .slice(1)
    .reduce((combined, locator) => combined.or(locator), locators[0])
    .first();
}

function createLocator(page: Page, locator: ElementLocator): Locator {
  switch (locator.type) {
    case "css":
      return page.locator(locator.value);
    case "xpath":
      return page.locator(`xpath=${locator.value}`);
    case "testId":
      return page.getByTestId(locator.value);
    case "text":
      return page.getByText(locator.value, { exact: locator.exact });
    case "label":
      return page.getByLabel(locator.value, { exact: locator.exact });
    case "placeholder":
      return page.getByPlaceholder(locator.value, { exact: locator.exact });
    case "role":
      return page.getByRole(
        locator.role as Parameters<Page["getByRole"]>[0],
        { name: locator.name, exact: locator.exact }
      );
  }
}

function randomInteger(
  minimum: number,
  maximum: number,
  random: () => number
): number {
  return Math.floor(random() * (maximum - minimum + 1)) + minimum;
}
