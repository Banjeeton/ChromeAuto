import { describe, expect, it, vi } from "vitest";

import { RecordedStepMapper } from "../../src/core/application/recorded-step-mapper";
import type {
  AutomationStep,
  ElementLocator
} from "../../src/core/domain/automation-step";
import type {
  RecorderClickEvent,
  RecorderInputEvent
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

  it("safely skips unknown, unsupported and malformed events", () => {
    const mapper = mapperWithIds("step");
    const modifiedClick = clickEvent(1);
    const unsupportedEvents: unknown[] = [
      {
        ...eventBase(2),
        kind: "reload",
        payload: { navigationId: "nav-1", waitUntil: "domcontentloaded" }
      },
      {
        ...eventBase(3),
        kind: "pageReady",
        payload: { navigationId: "nav-1", state: "load" }
      },
      { ...eventBase(4), kind: "scroll", payload: { top: 100 } },
      { kind: "click" },
      {
        ...inputEvent(5, "invalid"),
        target: { locators: [{ type: "css", value: "" }] }
      },
      {
        ...modifiedClick,
        payload: { ...modifiedClick.payload, modifiers: ["Control"] }
      }
    ];

    expect(() => mapper.map(unsupportedEvents)).not.toThrow();
    const result = mapper.map(unsupportedEvents);

    expect(result.steps).toEqual([]);
    expect(result.skipped.map((event) => event.reason)).toEqual([
      "unsupported-event-kind",
      "unsupported-event-kind",
      "unsupported-event-kind",
      "invalid-event",
      "invalid-event",
      "unsupported-click-modifiers"
    ]);
  });
});

function mapperWithIds(base: string): RecordedStepMapper {
  return new RecordedStepMapper({ createStepId: () => base });
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

function clickEvent(index: number): RecorderClickEvent {
  return {
    ...eventBase(index),
    kind: "click",
    target: {
      locators: [
        {
          type: "role",
          role: "button",
          name: "Submit",
          exact: true
        },
        { type: "css", value: 'button[type="submit"]' }
      ]
    },
    payload: { button: "left", clickCount: 1, modifiers: [] }
  };
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
