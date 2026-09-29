import type { Locator, Page } from "playwright-crx";
import { describe, expect, it, vi } from "vitest";

import { executePlaywrightStep } from "../../src/adapters/playwright/playwright-step-executor";
import type { AutomationDefaults } from "../../src/core/domain/automation";
import type { AutomationStep } from "../../src/core/domain/automation-step";
import type { ExecuteAutomationStepRequest } from "../../src/core/ports/automation-engine";

const defaults: AutomationDefaults = {
  timeoutMs: 5_000,
  postActionDelayMs: 0,
  humanInput: {
    enabled: false,
    minDelayMs: 40,
    maxDelayMs: 120
  }
};

describe("Playwright step executor", () => {
  it("clicks the first existing fallback with step timing overrides", async () => {
    const primary = createLocator(0);
    const fallback = createLocator(1);
    const page = createPage({
      locator: vi.fn((selector: string) =>
        selector === "#primary" ? primary : fallback
      )
    });
    const step: AutomationStep = {
      id: "click-submit",
      type: "click",
      enabled: true,
      timeoutMs: 1_500,
      postActionDelayMs: 25,
      target: {
        primary: { type: "css", value: "#primary" },
        fallbacks: [{ type: "css", value: "#fallback" }]
      },
      button: "left",
      clickCount: 2
    };

    await executePlaywrightStep(page, createRequest(step));

    expect(fallback.click).toHaveBeenCalledWith({
      button: "left",
      clickCount: 2,
      timeout: 1_500
    });
    expect(page.waitForTimeout).toHaveBeenCalledWith(25);
    expect(primary.click).not.toHaveBeenCalled();
  });

  it("fills and clears an input instantly", async () => {
    const input = createLocator(1);
    const page = createPage({ getByLabel: vi.fn(() => input) });
    const step: AutomationStep = {
      id: "fill-search",
      type: "input",
      enabled: true,
      target: {
        primary: { type: "label", value: "Search", exact: true },
        fallbacks: []
      },
      value: "Playwright CRX",
      clearFirst: true,
      inputMode: "instant"
    };

    await executePlaywrightStep(page, createRequest(step));

    expect(page.getByLabel).toHaveBeenCalledWith("Search", { exact: true });
    expect(input.fill).toHaveBeenCalledWith("Playwright CRX", {
      timeout: 5_000
    });
    expect(input.pressSequentially).not.toHaveBeenCalled();
  });

  it.each([
    ["value", "ca", { value: "ca" }],
    ["label", "Canada", { label: "Canada" }],
    ["index", 2, { index: 2 }]
  ] as const)("selects an option by %s", async (by, value, expected) => {
    const select = createLocator(1);
    const page = createPage({ getByLabel: vi.fn(() => select) });
    const step: AutomationStep = {
      id: `select-country-${by}`,
      name: "Select country",
      type: "select",
      enabled: true,
      target: {
        primary: { type: "label", value: "Country", exact: true },
        fallbacks: []
      },
      option: { by, value }
    } as AutomationStep;

    await executePlaywrightStep(page, createRequest(step));

    expect(select.selectOption).toHaveBeenCalledWith(expected, {
      timeout: 5_000
    });
  });

  it("selects through a fallback locator with timing overrides", async () => {
    const primary = createLocator(0);
    const fallback = createLocator(1);
    const page = createPage({
      locator: vi.fn((selector: string) =>
        selector === "#country" ? primary : fallback
      )
    });
    const step: AutomationStep = {
      id: "select-country",
      type: "select",
      enabled: true,
      timeoutMs: 1_750,
      postActionDelayMs: 40,
      target: {
        primary: { type: "css", value: "#country" },
        fallbacks: [{ type: "css", value: "select[name=country]" }]
      },
      option: { by: "value", value: "ca" }
    };

    await executePlaywrightStep(page, createRequest(step));

    expect(fallback.selectOption).toHaveBeenCalledWith(
      { value: "ca" },
      { timeout: 1_750 }
    );
    expect(primary.selectOption).not.toHaveBeenCalled();
    expect(page.waitForTimeout).toHaveBeenCalledWith(40);
  });

  it("checks an element through a fallback locator with timing overrides", async () => {
    const primary = createLocator(0);
    const fallback = createLocator(1);
    const page = createPage({
      locator: vi.fn((selector: string) =>
        selector === "#terms" ? primary : fallback
      )
    });
    const step: AutomationStep = {
      id: "accept-terms",
      type: "check",
      enabled: true,
      timeoutMs: 1_200,
      postActionDelayMs: 35,
      target: {
        primary: { type: "css", value: "#terms" },
        fallbacks: [{ type: "css", value: "input[name=terms]" }]
      }
    };

    await executePlaywrightStep(page, createRequest(step));

    expect(fallback.check).toHaveBeenCalledWith({ timeout: 1_200 });
    expect(primary.check).not.toHaveBeenCalled();
    expect(page.waitForTimeout).toHaveBeenCalledWith(35);
  });

  it("unchecks an element using the default timeout and delay", async () => {
    const checkbox = createLocator(1);
    const page = createPage({ getByLabel: vi.fn(() => checkbox) });
    const step: AutomationStep = {
      id: "disable-newsletter",
      type: "uncheck",
      enabled: true,
      target: {
        primary: { type: "label", value: "Newsletter", exact: true },
        fallbacks: []
      }
    };
    const request: ExecuteAutomationStepRequest = {
      ...createRequest(step),
      defaults: { ...defaults, postActionDelayMs: 20 }
    };

    await executePlaywrightStep(page, request);

    expect(checkbox.uncheck).toHaveBeenCalledWith({ timeout: 5_000 });
    expect(page.waitForTimeout).toHaveBeenCalledWith(20);
  });

  it.each(["check", "uncheck"] as const)(
    "safely repeats an already satisfied %s action",
    async (type) => {
      const checkbox = createLocator(1);
      const page = createPage({ locator: vi.fn(() => checkbox) });
      const step: AutomationStep = {
        id: `repeat-${type}`,
        type,
        enabled: true,
        target: {
          primary: { type: "css", value: "#preconfigured" },
          fallbacks: []
        }
      };

      await expect(
        executePlaywrightStep(page, createRequest(step))
      ).resolves.toBeUndefined();
      await expect(
        executePlaywrightStep(page, createRequest(step))
      ).resolves.toBeUndefined();

      expect(checkbox[type]).toHaveBeenCalledTimes(2);
    }
  );

  it("appends input without clearing the current value", async () => {
    const input = createLocator(1);
    const page = createPage({ locator: vi.fn(() => input) });
    const step: AutomationStep = {
      id: "append-search",
      type: "input",
      enabled: true,
      target: {
        primary: { type: "css", value: "input" },
        fallbacks: []
      },
      value: " appended",
      clearFirst: false,
      inputMode: "instant"
    };

    await executePlaywrightStep(page, createRequest(step));

    expect(input.fill).not.toHaveBeenCalled();
    expect(input.pressSequentially).toHaveBeenCalledWith(" appended", {
      delay: 0,
      timeout: 5_000
    });
  });

  it("types human input with a randomized delay between characters", async () => {
    const input = createLocator(1);
    const page = createPage({ locator: vi.fn(() => input) });
    const step: AutomationStep = {
      id: "human-search",
      type: "input",
      enabled: true,
      target: {
        primary: { type: "css", value: "input" },
        fallbacks: []
      },
      value: "ab",
      clearFirst: true,
      inputMode: "human",
      humanInput: { minDelayMs: 50, maxDelayMs: 100 }
    };

    await executePlaywrightStep(page, createRequest(step), { random: () => 0.5 });

    expect(input.fill).toHaveBeenCalledWith("", { timeout: 5_000 });
    expect(input.pressSequentially).toHaveBeenNthCalledWith(1, "a", {
      delay: 0,
      timeout: 5_000
    });
    expect(input.pressSequentially).toHaveBeenNthCalledWith(2, "b", {
      delay: 0,
      timeout: 5_000
    });
    expect(page.waitForTimeout).toHaveBeenCalledWith(75);
  });

  it("waits for a fixed duration", async () => {
    const page = createPage();
    const step: AutomationStep = {
      id: "pause",
      type: "wait",
      enabled: true,
      condition: { type: "timeout", durationMs: 800 }
    };

    await executePlaywrightStep(page, createRequest(step));

    expect(page.waitForTimeout).toHaveBeenCalledWith(800);
  });

  it("waits for an element state", async () => {
    const modal = createLocator(1);
    const page = createPage({ getByTestId: vi.fn(() => modal) });
    const step: AutomationStep = {
      id: "wait-modal",
      type: "wait",
      enabled: true,
      timeoutMs: 2_000,
      condition: {
        type: "element",
        state: "visible",
        target: {
          primary: { type: "testId", value: "modal" },
          fallbacks: []
        }
      }
    };

    await executePlaywrightStep(page, createRequest(step));

    expect(modal.waitFor).toHaveBeenCalledWith({
      state: "visible",
      timeout: 2_000
    });
  });

  it.each([
    ["exact", "https://example.com/done", true, false],
    ["contains", "/done", true, false],
    ["regex", "example\\.com/(done|success)", true, false]
  ] as const)("waits for a URL using %s matching", async (match, value, matches, misses) => {
    const page = createPage();
    const step: AutomationStep = {
      id: `wait-url-${match}`,
      type: "wait",
      enabled: true,
      condition: { type: "url", match, value }
    };

    await executePlaywrightStep(page, createRequest(step));

    const matcher = vi.mocked(page.waitForURL).mock.calls[0][0];
    if (typeof matcher !== "function") {
      throw new Error("Expected a URL predicate");
    }
    expect(matcher(new URL("https://example.com/done"))).toBe(matches);
    expect(matcher(new URL("https://example.com/other"))).toBe(misses);
    expect(page.waitForURL).toHaveBeenCalledWith(matcher, { timeout: 5_000 });
  });

  it("waits for a page load state", async () => {
    const page = createPage();
    const step: AutomationStep = {
      id: "wait-load",
      type: "wait",
      enabled: true,
      condition: { type: "pageLoad", state: "networkidle" }
    };

    await executePlaywrightStep(page, createRequest(step));

    expect(page.waitForLoadState).toHaveBeenCalledWith("networkidle", {
      timeout: 5_000
    });
  });

  it.each([
    ["none", "commit"],
    ["domcontentloaded", "domcontentloaded"],
    ["load", "load"],
    ["networkidle", "networkidle"]
  ] as const)("maps reload waitUntil %s to %s", async (waitUntil, expected) => {
    const page = createPage();
    const step: AutomationStep = {
      id: `reload-${waitUntil}`,
      type: "reload",
      enabled: true,
      waitUntil
    };

    await executePlaywrightStep(page, createRequest(step));

    expect(page.reload).toHaveBeenCalledWith({
      timeout: 5_000,
      waitUntil: expected
    });
  });

  it("skips disabled steps without touching the page", async () => {
    const page = createPage();
    const step: AutomationStep = {
      id: "disabled-reload",
      type: "reload",
      enabled: false,
      waitUntil: "load"
    };

    await executePlaywrightStep(page, createRequest(step));

    expect(page.reload).not.toHaveBeenCalled();
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it("returns custom JavaScript output and applies its post-action delay", async () => {
    const page = createPage({
      evaluate: vi.fn(async () => ({
        status: "completed",
        logs: ["custom log"],
        value: 42
      }))
    });
    const step: AutomationStep = {
      id: "custom-code",
      type: "customCode",
      enabled: true,
      postActionDelayMs: 30,
      language: "javascript",
      apiVersion: 1,
      executionContext: "page",
      source: "automation.log('custom log'); return 42;"
    };

    await expect(
      executePlaywrightStep(page, createRequest(step))
    ).resolves.toEqual({ logs: ["custom log"], value: 42 });
    expect(page.waitForTimeout).toHaveBeenCalledWith(30);
  });
});

function createRequest(step: AutomationStep): ExecuteAutomationStepRequest {
  return {
    sessionId: "session-1",
    stepIndex: 0,
    step,
    defaults
  };
}

function createLocator(count = 1): Locator {
  const locator = {
    check: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    count: vi.fn(async () => count),
    fill: vi.fn(async () => undefined),
    first: vi.fn(),
    pressSequentially: vi.fn(async () => undefined),
    selectOption: vi.fn(async () => []),
    uncheck: vi.fn(async () => undefined),
    waitFor: vi.fn(async () => undefined)
  };
  locator.first.mockReturnValue(locator);
  return locator as unknown as Locator;
}

function createPage(overrides: Record<string, unknown> = {}): Page {
  const defaultLocator = createLocator();
  return {
    getByLabel: vi.fn(() => defaultLocator),
    getByPlaceholder: vi.fn(() => defaultLocator),
    getByRole: vi.fn(() => defaultLocator),
    getByTestId: vi.fn(() => defaultLocator),
    getByText: vi.fn(() => defaultLocator),
    locator: vi.fn(() => defaultLocator),
    reload: vi.fn(async () => null),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    waitForURL: vi.fn(async () => undefined),
    ...overrides
  } as unknown as Page;
}
