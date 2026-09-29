import { describe, expect, it, vi } from "vitest";

import { RecordedStepMapper } from "../../src/core/application/recorded-step-mapper";
import type {
  AutomationStep,
  ElementLocator
} from "../../src/core/domain/automation-step";
import type {
  RecorderCheckEvent,
  RecorderClickEvent,
  RecorderInputEvent,
  RecorderPressKeyEvent,
  RecorderSelectEvent,
  RecorderUncheckEvent,
  RecorderReloadEvent
} from "../../src/core/domain/recorder-event";
import { validatePreset } from "../../src/core/domain/preset-validator";

describe("RecordedStepMapper", () => {
  it("converts a recorded click into a valid click step", () => {
    const mapper = mapperWithIds("click-step");

    const result = mapper.map([clickEvent(1)]);

    expect(result.skipped).toEqual([]);
    expect(result.steps).toEqual([
      {
        id: "click-step",
        type: "click",
        enabled: true,
        target: {
          primary: {
            type: "role",
            role: "button",
            name: "Submit",
            exact: true
          },
          fallbacks: [
            { type: "css", value: 'button[type="submit"]' }
          ]
        },
        button: "left",
        clickCount: 1
      }
    ]);
  });

  it("converts text input into a valid input step", () => {
    const mapper = mapperWithIds("input-step");

    const result = mapper.map([inputEvent(1, "Recorded value")]);

    expect(result.skipped).toEqual([]);
    expect(result.steps).toEqual([
      {
        id: "input-step",
        type: "input",
        enabled: true,
        target: {
          primary: { type: "label", value: "Search", exact: true },
          fallbacks: [{ type: "css", value: 'input[name="query"]' }]
        },
        value: "Recorded value",
        clearFirst: true,
        inputMode: "default"
      }
    ]);
  });

  it("converts extended recorder events in their actual order", () => {
    const mapper = mapperWithIds("advanced-step");

    const result = mapper.map([
      selectEvent(1),
      checkEvent(2, "checkbox"),
      checkEvent(3, "radio"),
      uncheckEvent(4),
      pressKeyEvent(5)
    ]);

    expect(result.skipped).toEqual([]);
    expect(result.steps).toEqual([
      {
        id: "advanced-step",
        type: "select",
        enabled: true,
        target: targetFrom([{ type: "testId", value: "country" }]),
        option: { by: "label", value: "Canada" }
      },
      {
        id: "advanced-step-2",
        type: "check",
        enabled: true,
        target: targetFrom([{ type: "testId", value: "terms" }])
      },
      {
        id: "advanced-step-3",
        type: "check",
        enabled: true,
        target: targetFrom([{ type: "testId", value: "plan-pro" }])
      },
      {
        id: "advanced-step-4",
        type: "uncheck",
        enabled: true,
        target: targetFrom([{ type: "testId", value: "terms" }])
      },
      {
        id: "advanced-step-5",
        type: "pressKey",
        enabled: true,
        target: targetFrom([{ type: "testId", value: "search" }]),
        key: "Control+Enter"
      }
    ]);
    expect(new Set(result.steps.map((step) => step.id)).size).toBe(5);
    expect(validatePreset(presetWithSteps(result.steps))).toEqual([]);
  });

  it("removes a duplicate click immediately followed by a control state event", () => {
    const mapper = mapperWithIds("control-step");
    const target = [{ type: "testId", value: "terms" }] as const;

    const result = mapper.map([
      clickEvent(1, target),
      checkEvent(2, "checkbox")
    ]);

    expect(result.steps).toEqual([
      {
        id: "control-step",
        type: "check",
        enabled: true,
        target: targetFrom(target)
      }
    ]);
    expect(result.skipped).toEqual([
      {
        eventId: "event-1",
        kind: "click",
        reason: "duplicate-control-click"
      }
    ]);
  });

  it("keeps a valid click when the following control event is malformed", () => {
    const mapper = mapperWithIds("control-step");
    const target = [{ type: "testId", value: "terms" }] as const;
    const malformedCheck = {
      ...checkEvent(2, "checkbox"),
      payload: { control: "checkbox", checked: false }
    };

    const result = mapper.map([clickEvent(1, target), malformedCheck]);

    expect(result.steps).toEqual([
      expect.objectContaining({ id: "control-step", type: "click" })
    ]);
    expect(result.skipped).toEqual([
      {
        eventId: "event-2",
        kind: "check",
        reason: "invalid-event"
      }
    ]);
  });

  it("preserves event order and makes repeated generated ids unique", () => {
    const createStepId = vi.fn(() => "recorded-step");
    const mapper = new RecordedStepMapper({ createStepId });

    const result = mapper.map([
      clickEvent(1),
      inputEvent(2, "value"),
      clickEvent(3)
    ]);

    expect(result.steps.map((step) => step.type)).toEqual([
      "click",
      "input",
      "click"
    ]);
    expect(result.steps.map((step) => step.id)).toEqual([
      "recorded-step",
      "recorded-step-2",
      "recorded-step-3"
    ]);
    expect(createStepId).toHaveBeenCalledTimes(3);
  });

  it("coalesces consecutive input events for the same field", () => {
    const createStepId = vi.fn(() => "input-step");
    const mapper = new RecordedStepMapper({ createStepId });

    const result = mapper.map([
      inputEvent(1, "h"),
      inputEvent(2, "he"),
      inputEvent(3, "hello"),
      inputEvent(4, "other", [{ type: "testId", value: "other-input" }])
    ]);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({
      id: "input-step",
      type: "input",
      value: "hello"
    });
    expect(result.steps[1]).toMatchObject({
      id: "input-step-2",
      type: "input",
      value: "other"
    });
    expect(createStepId).toHaveBeenCalledTimes(2);
  });

  it("does not coalesce input separated by another recorded action", () => {
    const mapper = mapperWithIds("step");

    const result = mapper.map([
      inputEvent(1, "before"),
      clickEvent(2),
      inputEvent(3, "after")
    ]);

    expect(result.steps).toHaveLength(3);
    expect(result.steps.map((step) => step.type)).toEqual([
      "input",
      "click",
      "input"
    ]);
  });

  it("produces steps that pass structural and semantic preset validation", () => {
    const mapper = mapperWithIds("valid-step");
    const result = mapper.map([clickEvent(1), inputEvent(2, "value")]);

    expect(validatePreset(presetWithSteps(result.steps))).toEqual([]);
    expect(new Set(result.steps.map((step) => step.id)).size).toBe(
      result.steps.length
    );
  });

  it("converts one navigation reload into one valid reload step", () => {
    const mapper = mapperWithIds("reload-step");

    const result = mapper.map([
      reloadEvent(3, "navigation-1"),
      reloadEvent(4, "navigation-1")
    ]);

    expect(result.steps).toEqual([
      {
        id: "reload-step",
        type: "reload",
        enabled: true,
        waitUntil: "domcontentloaded"
      }
    ]);
    expect(result.skipped).toEqual([
      {
        eventId: "event-4",
        kind: "reload",
        reason: "duplicate-navigation"
      }
    ]);
    expect(validatePreset(presetWithSteps(result.steps))).toEqual([]);
  });

  it("safely skips unknown, unsupported and malformed events", () => {
    const mapper = mapperWithIds("step");
    const modifiedClick = clickEvent(1);
    const unsupportedEvents: unknown[] = [
      {
        ...eventBase(2),
        kind: "pageReady",
        payload: { navigationId: "nav-1", state: "load" }
      },
      { ...eventBase(3), kind: "scroll", payload: { top: 100 } },
      { kind: "click" },
      {
        ...inputEvent(4, "invalid"),
        target: { locators: [{ type: "css", value: "" }] }
      },
      {
        ...modifiedClick,
        payload: { ...modifiedClick.payload, modifiers: ["Control"] }
      },
      {
        ...selectEvent(5),
        payload: { option: { by: "index", value: -1 } }
      },
      {
        ...pressKeyEvent(6),
        payload: { key: "Control++Invalid" }
      }
    ];

    expect(() => mapper.map(unsupportedEvents)).not.toThrow();
    const result = mapper.map(unsupportedEvents);

    expect(result.steps).toEqual([]);
    expect(result.skipped.map((event) => event.reason)).toEqual([
      "unsupported-event-kind",
      "unsupported-event-kind",
      "invalid-event",
      "invalid-event",
      "unsupported-click-modifiers",
      "invalid-event",
      "invalid-generated-step"
    ]);
  });
});

function mapperWithIds(base: string): RecordedStepMapper {
  return new RecordedStepMapper({ createStepId: () => base });
}

function reloadEvent(
  index: number,
  navigationId: string
): RecorderReloadEvent {
  return {
    ...eventBase(index),
    kind: "reload",
    payload: { navigationId, waitUntil: "domcontentloaded" }
  };
}

function eventBase(index: number) {
  return {
    version: 1 as const,
    eventId: `event-${index}`,
    sessionId: "recorder-1",
    tabId: 42,
    documentId: "document-1",
    occurredAt: `2026-09-29T00:00:0${index}.000Z`,
    url: "https://example.com/form"
  };
}

function clickEvent(
  index: number,
  locators: readonly ElementLocator[] = [
    {
      type: "role",
      role: "button",
      name: "Submit",
      exact: true
    },
    { type: "css", value: 'button[type="submit"]' }
  ]
): RecorderClickEvent {
  return {
    ...eventBase(index),
    kind: "click",
    target: { locators },
    payload: { button: "left", clickCount: 1, modifiers: [] }
  };
}

function selectEvent(index: number): RecorderSelectEvent {
  return {
    ...eventBase(index),
    kind: "select",
    target: { locators: [{ type: "testId", value: "country" }] },
    payload: { option: { by: "label", value: "Canada" } }
  };
}

function checkEvent(
  index: number,
  control: "checkbox" | "radio"
): RecorderCheckEvent {
  return {
    ...eventBase(index),
    kind: "check",
    target: {
      locators: [
        {
          type: "testId",
          value: control === "checkbox" ? "terms" : "plan-pro"
        }
      ]
    },
    payload: { control, checked: true }
  };
}

function uncheckEvent(index: number): RecorderUncheckEvent {
  return {
    ...eventBase(index),
    kind: "uncheck",
    target: { locators: [{ type: "testId", value: "terms" }] },
    payload: { control: "checkbox", checked: false }
  };
}

function pressKeyEvent(index: number): RecorderPressKeyEvent {
  return {
    ...eventBase(index),
    kind: "pressKey",
    target: { locators: [{ type: "testId", value: "search" }] },
    payload: { key: "Control+Enter" }
  };
}

function targetFrom(locators: readonly ElementLocator[]) {
  const [primary, ...fallbacks] = locators;
  if (primary === undefined) {
    throw new Error("At least one locator is required.");
  }
  return { primary, fallbacks };
}

function inputEvent(
  index: number,
  value: string,
  locators: readonly ElementLocator[] = [
    { type: "label", value: "Search", exact: true },
    { type: "css", value: 'input[name="query"]' }
  ]
): RecorderInputEvent {
  return {
    ...eventBase(index),
    kind: "input",
    target: { locators },
    payload: { value, inputType: "text" }
  };
}

function presetWithSteps(steps: readonly AutomationStep[]) {
  return {
    schemaVersion: 1,
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "Mapped recorder steps",
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    site: { hostname: "example.com", protocols: ["https"] },
    automation: {
      defaults: {
        timeoutMs: 10_000,
        postActionDelayMs: 0,
        humanInput: { enabled: false, minDelayMs: 0, maxDelayMs: 0 }
      },
      steps
    },
    siteSettings: {
      enabled: true,
      repeat: { enabled: false, intervalMinutes: 1 }
    }
  };
}
