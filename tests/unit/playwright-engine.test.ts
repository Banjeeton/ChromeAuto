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

  it("converts automation.stop to a contextual stopped-session error", async () => {
    const page = createPage({
      evaluate: vi.fn(async () => ({
        status: "stopped",
        logs: ["stopping"],
        reason: "done"
      })),
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
        stepIndex: 4,
        defaults,
        step: {
          id: "custom-stop",
          type: "customCode",
          enabled: true,
          language: "javascript",
          apiVersion: 1,
          executionContext: "page",
          source: 'automation.stop("done");'
        }
      })
    ).rejects.toMatchObject({
      code: "session-stopped",
      context: {
        sessionId: "session-1",
        tabId: 42,
        stepId: "custom-stop",
        stepIndex: 4
      },
      cause: {
        name: "CustomJavaScriptStopError",
        reason: "done",
        logs: ["stopping"]
      }
    });
  });

  it("rejects duplicate session and tab reservations before attaching", async () => {
    const page = createPage();
    const application = createApplication(page);
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });

    await engine.start({ sessionId: "session-1", target: { tabId: 42 } });

    await expect(
      engine.start({ sessionId: "session-1", target: { tabId: 43 } })
    ).rejects.toMatchObject({
      code: "session-conflict",
      context: { sessionId: "session-1", tabId: 43 }
    });
    await expect(
      engine.start({ sessionId: "session-2", target: { tabId: 42 } })
    ).rejects.toMatchObject({
      code: "session-conflict",
      context: { sessionId: "session-2", tabId: 42 }
    });
    expect(application.attach).toHaveBeenCalledOnce();
  });

  it("releases the reservation when attaching a session fails", async () => {
    const page = createPage();
    const attachFailure = new Error("Debugger is already attached");
    const application = createApplication(page);
    vi.mocked(application.attach)
      .mockRejectedValueOnce(attachFailure)
      .mockResolvedValueOnce(page);
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });

    await expect(
      engine.start({ sessionId: "session-1", target: { tabId: 42 } })
    ).rejects.toMatchObject({
      code: "engine-unavailable",
      context: { sessionId: "session-1", tabId: 42 },
      cause: attachFailure
    });
    await expect(
      engine.start({ sessionId: "session-1", target: { tabId: 42 } })
    ).resolves.toEqual({
      sessionId: "session-1",
      target: { tabId: 42 }
    });
    expect(application.attach).toHaveBeenCalledTimes(2);
  });

  it("keeps two automation sessions isolated by tab", async () => {
    const firstPage = createPage();
    const secondPage = createPage();
    const application = createApplication(firstPage);
    vi.mocked(application.attach).mockImplementation(async (tabId) =>
      tabId === 11 ? firstPage : secondPage
    );
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });

    await engine.start({ sessionId: "session-1", target: { tabId: 11 } });
    await engine.start({ sessionId: "session-2", target: { tabId: 22 } });
    await engine.executeStep(reloadRequest("session-1", "reload-first"));
    await engine.executeStep(reloadRequest("session-2", "reload-second"));
    await engine.stop({ sessionId: "session-1", reason: "user" });

    await expect(
      engine.executeStep(reloadRequest("session-1", "after-stop"))
    ).rejects.toMatchObject({ code: "session-not-found" });
    await expect(
      engine.executeStep(reloadRequest("session-2", "still-running"))
    ).resolves.toMatchObject({
      sessionId: "session-2",
      stepId: "still-running"
    });

    expect(firstPage.reload).toHaveBeenCalledOnce();
    expect(secondPage.reload).toHaveBeenCalledTimes(2);
    expect(application.detach).toHaveBeenCalledOnce();
    expect(application.detach).toHaveBeenCalledWith(11);
    expect(engine.attachedTabIds()).toEqual([22]);
  });

  it("detaches every tab and invalidates every session on Stop All", async () => {
    const page = createPage();
    const application = createApplication(page);
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });
    await engine.start({ sessionId: "session-1", target: { tabId: 11 } });
    await engine.start({ sessionId: "session-2", target: { tabId: 22 } });

    await engine.stopAll({ reason: "user" });

    expect(application.detachAll).toHaveBeenCalledOnce();
    expect(engine.attachedTabIds()).toEqual([]);
    await expect(
      engine.executeStep(reloadRequest("session-1", "after-stop-all"))
    ).rejects.toMatchObject({ code: "session-not-found" });
    await expect(engine.complete("session-2")).rejects.toMatchObject({
      code: "session-not-found"
    });
  });

  it("forgets the session when Playwright reports an external detach", async () => {
    const detachedHandlers: Array<(tabId: number) => void> = [];
    const page = createPage();
    const application = createApplication(page);
    vi.mocked(application.on).mockImplementation((event, handler) => {
      if (event === "detached") {
        detachedHandlers.push(handler as (tabId: number) => void);
      }
      return application;
    });
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });
    await engine.start({ sessionId: "session-1", target: { tabId: 42 } });

    detachedHandlers[0]?.(42);

    expect(engine.attachedTabIds()).toEqual([]);
    await expect(
      engine.executeStep(reloadRequest("session-1", "detached"))
    ).rejects.toMatchObject({
      code: "session-not-found",
      context: { sessionId: "session-1" }
    });
  });

  it("keeps a session available for a retry when detach fails", async () => {
    const page = createPage();
    const detachFailure = new Error("Debugger detach failed");
    const application = createApplication(page);
    vi.mocked(application.detach)
      .mockRejectedValueOnce(detachFailure)
      .mockResolvedValueOnce(undefined);
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });
    await engine.start({ sessionId: "session-1", target: { tabId: 42 } });

    await expect(
      engine.stop({ sessionId: "session-1", reason: "user" })
    ).rejects.toMatchObject({
      code: "engine-unavailable",
      context: { sessionId: "session-1", tabId: 42 },
      cause: detachFailure
    });
    await expect(
      engine.executeStep(reloadRequest("session-1", "after-failed-stop"))
    ).resolves.toMatchObject({ stepId: "after-failed-stop" });
    await expect(
      engine.stop({ sessionId: "session-1", reason: "user" })
    ).resolves.toBeUndefined();
    expect(application.detach).toHaveBeenCalledTimes(2);
  });

  it("closes and recreates the Playwright CRX application", async () => {
    const firstApplication = createApplication(createPage());
    const secondApplication = createApplication(createPage());
    const start = vi
      .fn()
      .mockResolvedValueOnce(firstApplication)
      .mockResolvedValueOnce(secondApplication);
    const engine = new PlaywrightEngine({ start });

    await engine.start({ sessionId: "session-1", target: { tabId: 42 } });
    await engine.close();
    await engine.start({ sessionId: "session-1", target: { tabId: 42 } });

    expect(firstApplication.close).toHaveBeenCalledOnce();
    expect(secondApplication.attach).toHaveBeenCalledWith(42);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("converts non-timeout step failures to contextual domain errors", async () => {
    const failure = new TypeError("Selector is invalid");
    const button = {
      click: vi.fn(async () => {
        throw failure;
      }),
      count: vi.fn(async () => 1),
      first: vi.fn()
    };
    button.first.mockReturnValue(button);
    const page = createPage({ locator: vi.fn(() => button) });
    const application = createApplication(page);
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });
    await engine.start({ sessionId: "session-1", target: { tabId: 42 } });

    await expect(
      engine.executeStep({
        sessionId: "session-1",
        stepIndex: 5,
        defaults,
        step: {
          id: "invalid-selector",
          type: "click",
          enabled: true,
          target: {
            primary: { type: "css", value: "[" },
            fallbacks: []
          },
          button: "left",
          clickCount: 1
        }
      })
    ).rejects.toMatchObject({
      code: "step-failed",
      context: {
        sessionId: "session-1",
        tabId: 42,
        stepId: "invalid-selector",
        stepIndex: 5
      },
      cause: failure
    });
  });

  it("reports a missing select option as a contextual domain error", async () => {
    const failure = new Error('Option with label "Canada" was not found');
    const select = {
      count: vi.fn(async () => 1),
      first: vi.fn(),
      selectOption: vi.fn(async () => {
        throw failure;
      })
    };
    select.first.mockReturnValue(select);
    const page = createPage({ getByLabel: vi.fn(() => select) });
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => createApplication(page))
    });
    await engine.start({ sessionId: "session-1", target: { tabId: 42 } });

    await expect(
      engine.executeStep({
        sessionId: "session-1",
        stepIndex: 2,
        defaults,
        step: {
          id: "select-country",
          name: "Select country",
          type: "select",
          enabled: true,
          target: {
            primary: { type: "label", value: "Country", exact: true },
            fallbacks: []
          },
          option: { by: "label", value: "Canada" }
        }
      })
    ).rejects.toMatchObject({
      code: "step-failed",
      message:
        'Automation step select-country failed: Option with label "Canada" was not found',
      context: {
        sessionId: "session-1",
        tabId: 42,
        stepId: "select-country",
        stepIndex: 2,
        stepNumber: 3,
        stepType: "select",
        stepName: "Select country",
        action: "select",
        target: {
          primary: { type: "label", value: "Country", exact: true },
          fallbacks: []
        },
        selectOption: { by: "label", value: "Canada" }
      },
      cause: failure
    });
  });

  it("reports a missing select element as a contextual timeout", async () => {
    const timeout = new Error("Select element was not found within 5000ms");
    timeout.name = "TimeoutError";
    const missingSelect = {
      count: vi.fn(async () => 0),
      first: vi.fn(),
      selectOption: vi.fn(async () => {
        throw timeout;
      })
    };
    missingSelect.first.mockReturnValue(missingSelect);
    const page = createPage({ locator: vi.fn(() => missingSelect) });
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => createApplication(page))
    });
    await engine.start({ sessionId: "session-1", target: { tabId: 42 } });

    await expect(
      engine.executeStep({
        sessionId: "session-1",
        stepIndex: 1,
        defaults,
        step: {
          id: "select-missing-country",
          type: "select",
          enabled: true,
          target: {
            primary: { type: "css", value: "#missing-country" },
            fallbacks: []
          },
          option: { by: "value", value: "ca" }
        }
      })
    ).rejects.toMatchObject({
      code: "step-timeout",
      message:
        "Automation step select-missing-country failed: Select element was not found within 5000ms",
      context: {
        sessionId: "session-1",
        tabId: 42,
        stepId: "select-missing-country",
        stepIndex: 1
      },
      cause: timeout
    });
  });

  it.each(["check", "uncheck"] as const)(
    "reports an incompatible element for %s with complete step context",
    async (type) => {
      const failure = new Error(
        `Element does not support the ${type} action: expected a checkbox or radio`
      );
      const control = {
        check: vi.fn(async () => {
          throw failure;
        }),
        count: vi.fn(async () => 1),
        first: vi.fn(),
        uncheck: vi.fn(async () => {
          throw failure;
        })
      };
      control.first.mockReturnValue(control);
      const page = createPage({ locator: vi.fn(() => control) });
      const engine = new PlaywrightEngine({
        start: vi.fn(async () => createApplication(page))
      });
      await engine.start({ sessionId: "session-1", target: { tabId: 42 } });

      await expect(
        engine.executeStep({
          sessionId: "session-1",
          stepIndex: 3,
          defaults,
          step: {
            id: `${type}-terms`,
            name: `${type} terms`,
            type,
            enabled: true,
            target: {
              primary: { type: "css", value: "#terms" },
              fallbacks: []
            }
          }
        })
      ).rejects.toMatchObject({
        code: "step-failed",
        message: `Automation step ${type}-terms failed: Element does not support the ${type} action: expected a checkbox or radio`,
        context: {
          sessionId: "session-1",
          tabId: 42,
          stepId: `${type}-terms`,
          stepIndex: 3,
          stepNumber: 4,
          stepType: type,
          stepName: `${type} terms`,
          action: type,
          target: {
            primary: { type: "css", value: "#terms" },
            fallbacks: []
          }
        },
        cause: failure
      });
    }
  );

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
    detachAll: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    on: vi.fn(function (this: CrxApplication) {
      return this;
    })
  } as unknown as CrxApplication;
}

function reloadRequest(sessionId: string, stepId: string) {
  return {
    sessionId,
    stepIndex: 0,
    defaults,
    step: {
      id: stepId,
      type: "reload" as const,
      enabled: true,
      waitUntil: "domcontentloaded" as const
    }
  };
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
