import { describe, expect, expectTypeOf, it } from "vitest";

import type { AutomationStep } from "../../src/core/domain/automation-step";
import {
  RecorderError,
  isRecorderError
} from "../../src/core/domain/recorder-error";
import {
  RECORDER_EVENT_KINDS,
  type RecorderClickEvent,
  type RecorderEvent,
  type RecorderInputEvent,
  type RecorderPageReadyEvent,
  type RecorderReloadEvent
} from "../../src/core/domain/recorder-event";
import {
  RECORDER_STATES,
  type RecorderRuntimeState,
  type RecordingRecorderState
} from "../../src/core/domain/recorder-session";
import type {
  GetRecorderStateRequest,
  Recorder,
  StartRecorderRequest,
  StopRecorderRequest
} from "../../src/core/ports/recorder";

describe("Recorder port", () => {
  it("defines start, stop and state commands without browser-specific types", () => {
    expectTypeOf<Recorder["start"]>().toEqualTypeOf<
      (
        request: StartRecorderRequest
      ) => Promise<RecordingRecorderState>
    >();
    expectTypeOf<Recorder["stop"]>().toEqualTypeOf<
      (request: StopRecorderRequest) => Promise<RecorderRuntimeState>
    >();
    expectTypeOf<Recorder["getState"]>().toEqualTypeOf<
      (request: GetRecorderStateRequest) => Promise<RecorderRuntimeState>
    >();
  });

  it("exposes every recorder lifecycle state through one runtime union", () => {
    const baseSession = {
      sessionId: "recorder-1",
      tabId: 42,
      context: {
        url: "https://example.com/form",
        hostname: "example.com",
        protocol: "https" as const
      },
      startedAt: "2026-09-28T18:00:00.000Z",
      recordedEventCount: 2
    };
    const states: readonly RecorderRuntimeState[] = [
      { state: "idle", tabId: 42 },
      { ...baseSession, state: "recording" },
      { ...baseSession, state: "stopping", stopReason: "user" },
      {
        ...baseSession,
        state: "stopped",
        stopReason: "user",
        stoppedAt: "2026-09-28T18:01:00.000Z"
      },
      {
        ...baseSession,
        state: "failed",
        failedAt: "2026-09-28T18:01:00.000Z",
        failure: { code: "recorder-unavailable", message: "Disconnected." }
      }
    ];

    expect(states.map((state) => state.state)).toEqual(RECORDER_STATES);
  });
});

describe("Recorder events", () => {
  const common = {
    version: 1 as const,
    eventId: "event-1",
    sessionId: "recorder-1",
    tabId: 42,
    documentId: "document-1",
    occurredAt: "2026-09-28T18:00:00.000Z",
    url: "https://example.com/form"
  };
  const target = {
    locators: [
      { type: "testId" as const, value: "submit" },
      { type: "css" as const, value: "button[type='submit']" }
    ]
  };

  it("models click, input, reload and pageReady as a discriminated union", () => {
    const events: readonly RecorderEvent[] = [
      {
        ...common,
        kind: "click",
        target,
        payload: {
          button: "left",
          clickCount: 1,
          modifiers: ["Control"]
        }
      } satisfies RecorderClickEvent,
      {
        ...common,
        eventId: "event-2",
        kind: "input",
        target,
        payload: { value: "hello", inputType: "text" }
      } satisfies RecorderInputEvent,
      {
        ...common,
        eventId: "event-3",
        kind: "reload",
        payload: {
          navigationId: "navigation-1",
          waitUntil: "domcontentloaded"
        }
      } satisfies RecorderReloadEvent,
      {
        ...common,
        eventId: "event-4",
        kind: "pageReady",
        payload: { navigationId: "navigation-1", state: "load" }
      } satisfies RecorderPageReadyEvent
    ];

    expect(events.map((event) => event.kind)).toEqual(RECORDER_EVENT_KINDS);
    expect(structuredClone(events)).toEqual(events);
    expect(events.every((event) => event.tabId === 42)).toBe(true);
    expect(events.every((event) => event.url === common.url)).toBe(true);
    expect(events.every((event) => event.occurredAt === common.occurredAt)).toBe(
      true
    );
  });

  it("keeps internal events distinct from portable automation steps", () => {
    expectTypeOf<RecorderEvent>().not.toEqualTypeOf<AutomationStep>();

    const event: RecorderEvent = {
      ...common,
      kind: "click",
      target,
      payload: { button: "left", clickCount: 1, modifiers: [] }
    };

    expect(event).not.toHaveProperty("type");
    expect(event).not.toHaveProperty("enabled");
    expect(event).not.toHaveProperty("schemaVersion");
  });
});

describe("RecorderError", () => {
  it("preserves a stable code, recorder context and original cause", () => {
    const cause = new Error("content script did not respond");
    const error = new RecorderError(
      "recorder-unavailable",
      "Unable to start recording.",
      {
        cause,
        context: {
          sessionId: "recorder-1",
          tabId: 42,
          url: "https://example.com/form"
        }
      }
    );

    expect(error).toMatchObject({
      name: "RecorderError",
      code: "recorder-unavailable",
      message: "Unable to start recording.",
      context: {
        sessionId: "recorder-1",
        tabId: 42,
        url: "https://example.com/form"
      },
      cause
    });
  });

  it("narrows domain recorder errors and freezes copied context", () => {
    const context = { tabId: 7, eventId: "event-1" };
    const error = new RecorderError("invalid-event", "Invalid event.", {
      context
    });
    context.eventId = "changed-outside";

    expect(isRecorderError(error)).toBe(true);
    expect(isRecorderError(new Error("unknown"))).toBe(false);
    expect(error.context.eventId).toBe("event-1");
    expect(Object.isFrozen(error.context)).toBe(true);
  });
});
