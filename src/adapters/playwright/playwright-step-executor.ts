import type { Locator, Page } from "playwright-crx";

import type {
  ElementLocator,
  ElementTarget,
  InputStep,
  WaitStep
} from "../../core/domain/automation-step";
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
      throw new Error(`Step type ${step.type} is not implemented`);
  }

  const postActionDelay =
    step.postActionDelayMs ?? request.defaults.postActionDelayMs;
  if (postActionDelay > 0) {
    await page.waitForTimeout(postActionDelay);
  }

  return output;
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
      const locator = await resolveTarget(page, condition.target);
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

async function resolveTarget(page: Page, target: ElementTarget): Promise<Locator> {
  const locators = [target.primary, ...target.fallbacks].map((locator) =>
    createLocator(page, locator).first()
  );

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
