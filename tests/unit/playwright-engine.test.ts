import type { CrxApplication, Page } from "playwright-crx";
import { describe, expect, it, vi } from "vitest";

import { PlaywrightEngine } from "../../src/adapters/playwright/playwright-engine";
import type { AutomationDefaults } from "../../src/core/domain/automation";

vi.mock("playwright-crx", () => ({
  crx: { start: vi.fn() }
}));

describe("PlaywrightEngine", () => {
  it("implements the automation session and step lifecycle", async () => {
    const button = {
      click: vi.fn(async () => undefined),
      count: vi.fn(async () => 1),
      first: vi.fn()
    };
    button.first.mockReturnValue(button);
    const page = createPage({
      locator: vi.fn(() => button),
      waitForTimeout: vi.fn(async () => undefined)
    });
    const application = createApplication(page);
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });

    await expect(
      engine.start({ sessionId: "session-1", target: { tabId: 42 } })
    ).resolves.toEqual({
      sessionId: "session-1",
      target: { tabId: 42 }
    });
    await expect(
      engine.executeStep({
        sessionId: "session-1",
        stepIndex: 2,
        defaults,
        step: {
          id: "click-button",
          type: "click",
          enabled: true,
          target: {
            primary: { type: "css", value: "button" },
            fallbacks: []
          },
          button: "left",
          clickCount: 1
        }
      })
    ).resolves.toEqual({
      sessionId: "session-1",
      stepId: "click-button",
      stepIndex: 2,
      output: undefined
    });

    await engine.complete("session-1");

    expect(button.click).toHaveBeenCalledOnce();
    expect(application.detach).toHaveBeenCalledWith(42);
    await expect(engine.complete("session-1")).rejects.toMatchObject({
      code: "session-not-found"
    });
  });

  it("converts Playwright timeouts to a contextual domain error", async () => {
    const timeout = new Error("Timeout");
    timeout.name = "TimeoutError";
    const button = {
      click: vi.fn(async () => {
        throw timeout;
      }),
      count: vi.fn(async () => 1),
      first: vi.fn()
    };
    button.first.mockReturnValue(button);
    const page = createPage({
      locator: vi.fn(() => button),
      waitForTimeout: vi.fn(async () => undefined)
    });
    const application = createApplication(page);
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });
    await engine.start({ sessionId: "session-1", target: { tabId: 42 } });

    await expect(
      engine.executeStep({
        sessionId: "session-1",
        stepIndex: 3,
        defaults,
        step: {
          id: "click-button",
          type: "click",
          enabled: true,
          target: {
            primary: { type: "css", value: "button" },
            fallbacks: []
          },
          button: "left",
          clickCount: 1
        }
      })
    ).rejects.toMatchObject({
      code: "step-timeout",
      context: {
        sessionId: "session-1",
        tabId: 42,
        stepId: "click-button",
        stepIndex: 3
      },
      cause: timeout
    });
  });

  it("attaches a tab once and returns its page snapshot", async () => {
    const page = createPage();
    const application = createApplication(page);
    const start = vi.fn(async () => application);
    const engine = new PlaywrightEngine({ start });

    await expect(engine.snapshot(42)).resolves.toEqual({
      tabId: 42,
      title: "Example",
      url: "https://example.com/"
    });
    await engine.snapshot(42);

    expect(start).toHaveBeenCalledOnce();
    expect(application.attach).toHaveBeenCalledOnce();
    expect(application.attach).toHaveBeenCalledWith(42);
  });

  it("reloads an attached page and waits for DOM content", async () => {
    const page = createPage();
    const application = createApplication(page);
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });

    await engine.reload(7);

    expect(page.reload).toHaveBeenCalledWith({
      waitUntil: "domcontentloaded"
    });
  });

  it("detaches only tabs attached by this engine", async () => {
    const page = createPage();
    const application = createApplication(page);
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });

    await engine.detach(8);
    await engine.attach(8);
    await engine.detach(8);
    await engine.detach(8);

    expect(application.detach).toHaveBeenCalledOnce();
    expect(application.detach).toHaveBeenCalledWith(8);
  });

  it("keeps an ordered list of independently attached tabs", async () => {
    const page = createPage();
    const application = createApplication(page);
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });

    await engine.attach(12);
    await engine.attach(4);

    expect(engine.attachedTabIds()).toEqual([4, 12]);

    await engine.detach(4);

    expect(engine.attachedTabIds()).toEqual([12]);
  });

  it("opens, fills and closes the HTML modal fixture", async () => {
    const modal = {
      isHidden: vi.fn(async () => true),
      locator: vi.fn(),
      waitFor: vi.fn(async () => undefined)
    };
    const input = {
      fill: vi.fn(async () => undefined),
      inputValue: vi.fn(async () => "Playwright CRX modal test")
    };
    const closeButton = { click: vi.fn(async () => undefined) };
    modal.locator.mockImplementation((selector: string) =>
      selector === "[data-spike-modal-input]" ? input : closeButton
    );
    const openButton = { click: vi.fn(async () => undefined) };
    const page = createPage({
      locator: vi.fn((selector: string) =>
        selector === "[data-spike-modal]" ? modal : openButton
      )
    });
    const application = createApplication(page);
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });

    await expect(engine.testHtmlModal(3)).resolves.toEqual({
      closed: true,
      inputValue: "Playwright CRX modal test",
      opened: true
    });
    expect(openButton.click).toHaveBeenCalledOnce();
    expect(input.fill).toHaveBeenCalledWith("Playwright CRX modal test");
    expect(closeButton.click).toHaveBeenCalledOnce();
  });

  it("rejects invalid Chrome tab ids", async () => {
    const engine = new PlaywrightEngine({ start: vi.fn() });

    await expect(engine.attach(-1)).rejects.toThrow("Invalid Chrome tab id");
    await expect(engine.attach(1.5)).rejects.toThrow("Invalid Chrome tab id");
  });
});

function createPage(overrides: Record<string, unknown> = {}): Page {
  return {
    title: vi.fn(async () => "Example"),
    url: vi.fn(() => "https://example.com/"),
    reload: vi.fn(async () => null),
    ...overrides
  } as unknown as Page;
}

function createApplication(page: Page): CrxApplication {
  return {
    attach: vi.fn(async () => page),
    detach: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    on: vi.fn(function (this: CrxApplication) {
      return this;
    })
  } as unknown as CrxApplication;
}

const defaults: AutomationDefaults = {
  timeoutMs: 5_000,
  postActionDelayMs: 0,
  humanInput: {
    enabled: false,
    minDelayMs: 40,
    maxDelayMs: 120
  }
};
