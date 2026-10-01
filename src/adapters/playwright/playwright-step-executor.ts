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
    case "attribute": {
      const startedAt = Date.now();
      const { attribute, value } = step.option;
      if (!/^[a-zA-Z_][a-zA-Z0-9_.:-]*$/u.test(attribute)) {
        throw new Error(`Invalid option attribute name: ${attribute}`);
      }
      // Query only options belonging to this select. Do not infer an index
      // from another select or fall back to a different option on failure.
      const escaped = value.replace(/[\\"\n\r\f]/gu, (character) =>
        `\\${character.codePointAt(0)!.toString(16)} `
      );
      const option = locator.locator(`option[${attribute}="${escaped}"]`);
      await option.first().waitFor({ state: "attached", timeout });
      if (await option.count() !== 1) {
        throw new Error(`Select option ${attribute}=${JSON.stringify(value)} is ambiguous`);
      }
      const handle = await option.elementHandle({ timeout: Math.max(1, timeout - (Date.now() - startedAt)) });
      if (handle === null) {
        throw new Error(`Select option ${attribute}=${JSON.stringify(value)} was not found`);
      }
      try {
        await locator.selectOption(handle, { timeout: Math.max(1, timeout - (Date.now() - startedAt)) });
      } finally {
        await handle.dispose();
      }
      return;
    }
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
  const locators = [target.primary, ...target.fallbacks].flatMap((locator) =>
    createLocatorVariants(page, locator).map((candidate) => {
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
    })
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

function createLocatorVariants(
  page: Page,
  locator: ElementLocator
): readonly Locator[] {
  const variants = [createLocator(page, locator)];
  if (locator.type !== "css") {
    return variants;
  }

  for (const relaxedSelector of relaxedStructuralSelectors(locator.value)) {
    variants.push(page.locator(relaxedSelector));
  }
  return variants;
}

function relaxedStructuralSelectors(selector: string): readonly string[] {
  const nthPattern = /:nth-of-type\(\d+\)/gu;
  const matches = [...selector.matchAll(nthPattern)];
  if (matches.length === 0 || !/[.#][a-z_-]/iu.test(selector)) {
    return [];
  }

  const variants: string[] = [];
  if (matches.length > 1) {
    const lastIndex = matches.at(-1)?.index;
    let occurrence = 0;
    const keepLast = selector.replace(nthPattern, (match, offset: number) => {
      occurrence += 1;
      return offset === lastIndex || occurrence === matches.length ? match : "";
    });
    if (keepLast !== selector) {
      variants.push(keepLast);
    }
  }

  const withoutPositions = selector.replace(nthPattern, "");
  if (withoutPositions !== selector && !variants.includes(withoutPositions)) {
    variants.push(withoutPositions);
  }
  return variants;
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
