import { describe, expect, it } from "vitest";

import { RecorderContentController } from "../../src/content/recorder-content-controller";
import {
  RecorderDomCapture,
  type RecorderCaptureOptions,
  type RecorderDocumentEventSource
} from "../../src/content/recorder-dom-capture";
import type { RecorderEvent } from "../../src/core/domain/recorder-event";
import {
  RECORDER_CONTENT_MESSAGE,
  RECORDER_DIAGNOSTIC_MESSAGE,
  RECORDER_EVENT_MESSAGE,
  isRecorderContentMessage,
  isRecorderDiagnosticMessage,
  isRecorderEventMessage
} from "../../src/shared/types/recorder-runtime";

describe("RecorderDomCapture", () => {
  it("captures trusted clicks in the page DOM and an HTML modal", () => {
    const harness = createHarness();
    const pageButton = new FakeElement("button", { id: "page-action" });
    const modalButton = new FakeElement("button", {
      "data-testid": "modal-save"
    });

    harness.source.dispatch("click", trustedEvent(pageButton));
    expect(harness.events).toEqual([]);

    harness.capture.start(captureSession());
    harness.source.dispatch("click", untrustedEvent(pageButton));
    harness.source.dispatch("click", trustedEvent(pageButton, { detail: 1 }));
    harness.source.dispatch(
      "click",
      trustedEvent(modalButton, { button: 2, detail: 2, shiftKey: true })
    );

    expect(harness.events).toEqual([
      expect.objectContaining({
        kind: "click",
        tabId: 42,
        url: "https://example.com/form",
        occurredAt: "2026-09-28T18:00:00.000Z",
        target: { locators: [{ type: "css", value: "#page-action" }] },
        payload: { button: "left", clickCount: 1, modifiers: [] }
      }),
      expect.objectContaining({
        kind: "click",
        target: { locators: [{ type: "testId", value: "modal-save" }] },
        payload: { button: "right", clickCount: 2, modifiers: ["Shift"] }
      })
    ]);
  });

  it("coalesces consecutive input events for the same element", () => {
    const harness = createHarness();
    const input = new FakeElement("input", { name: "query", type: "search" });
    harness.capture.start(captureSession());

    input.value = "h";
    harness.source.dispatch("input", trustedEvent(input));
    input.value = "he";
    harness.source.dispatch("input", trustedEvent(input));
    input.value = "hello";
    harness.source.dispatch("input", trustedEvent(input));

    expect(harness.events).toEqual([]);
    expect(harness.scheduler.size).toBe(1);
    harness.scheduler.flushAll();

    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({
      kind: "input",
      target: {
        locators: [{ type: "css", value: 'input[name="query"]' }]
      },
      payload: { value: "hello", inputType: "search" }
    });
  });

  it("captures a select change without recording its click", () => {
    const harness = createHarness();
    const select = new FakeElement("select", { id: "country" });
    select.selectedIndex = 1;
    select.options = [
      { value: "", label: "Choose a country" },
      { value: "ca", label: "Canada" }
    ];
    harness.capture.start(captureSession());

    harness.source.dispatch("click", trustedEvent(select));
    harness.source.dispatch("change", trustedEvent(select));

    expect(harness.events).toEqual([
      expect.objectContaining({
        version: 1,
        eventId: "event-1",
        sessionId: "recorder-1",
        tabId: 42,
        documentId: "document-1",
        occurredAt: "2026-09-28T18:00:00.000Z",
        url: "https://example.com/form",
        kind: "select",
        target: { locators: [{ type: "css", value: "#country" }] },
        payload: { option: { by: "value", value: "ca" } }
      })
    ]);
  });

  it("captures checkbox state changes without duplicate clicks", () => {
    const harness = createHarness();
    const checkbox = new FakeElement("input", {
      id: "terms",
      type: "checkbox"
    });
    harness.capture.start(captureSession());

    checkbox.checked = true;
    harness.source.dispatch("click", trustedEvent(checkbox));
    harness.source.dispatch("input", trustedEvent(checkbox));
    harness.source.dispatch("change", trustedEvent(checkbox));
    checkbox.checked = false;
    harness.source.dispatch("change", trustedEvent(checkbox));

    expect(harness.events).toEqual([
      expect.objectContaining({
        kind: "check",
        target: { locators: [{ type: "css", value: "#terms" }] },
        payload: { control: "checkbox", checked: true }
      }),
      expect.objectContaining({
        kind: "uncheck",
        target: { locators: [{ type: "css", value: "#terms" }] },
        payload: { control: "checkbox", checked: false }
      })
    ]);
    expect(harness.scheduler.size).toBe(0);
  });

  it("captures only the checked state of a radio control", () => {
    const harness = createHarness();
    const radio = new FakeElement("input", {
      name: "plan",
      type: "radio"
    });
    harness.capture.start(captureSession());

    radio.checked = false;
    harness.source.dispatch("change", trustedEvent(radio));
    radio.checked = true;
    harness.source.dispatch("change", trustedEvent(radio));

    expect(harness.events).toEqual([
      expect.objectContaining({
        kind: "check",
        target: {
          locators: [{ type: "css", value: 'input[name="plan"]' }]
        },
        payload: { control: "radio", checked: true }
      })
    ]);
  });

  it.each([
    ["Enter", {}, "Enter"],
    ["Escape", {}, "Escape"],
    ["Tab", { shiftKey: true }, "Shift+Tab"],
    ["ArrowDown", { altKey: true }, "Alt+ArrowDown"],
    ["F12", { ctrlKey: true, metaKey: true }, "Control+Meta+F12"]
  ] as const)("captures the special key %s", (key, details, expected) => {
    const harness = createHarness();
    const button = new FakeElement("button", { id: "key-target" });
    harness.capture.start(captureSession());

    harness.source.dispatch("keydown", trustedEvent(button, { key, ...details }));

    expect(harness.events).toEqual([
      expect.objectContaining({
        kind: "pressKey",
        sessionId: "recorder-1",
        tabId: 42,
        url: "https://example.com/form",
        occurredAt: "2026-09-28T18:00:00.000Z",
        target: { locators: [{ type: "css", value: "#key-target" }] },
        payload: { key: expected }
      })
    ]);
  });

  it("keeps ordinary characters and editing keys inside one input event", () => {
    const harness = createHarness();
    const input = new FakeElement("input", { id: "query", type: "text" });
    harness.capture.start(captureSession());

    harness.source.dispatch("keydown", trustedEvent(input, { key: "a" }));
    input.value = "a";
    harness.source.dispatch("input", trustedEvent(input));
    harness.source.dispatch("keydown", trustedEvent(input, { key: " " }));
    input.value = "a ";
    harness.source.dispatch("input", trustedEvent(input));
    harness.source.dispatch("keydown", trustedEvent(input, { key: "Backspace" }));
    input.value = "a";
    harness.source.dispatch("input", trustedEvent(input));
    harness.scheduler.flushAll();

    expect(harness.events).toEqual([
      expect.objectContaining({
        kind: "input",
        payload: { value: "a", inputType: "text" }
      })
    ]);
  });

  it("flushes text input before recording a special key on the field", () => {
    const harness = createHarness();
    const input = new FakeElement("input", { id: "query", type: "search" });
    harness.capture.start(captureSession());

    input.value = "automation";
    harness.source.dispatch("input", trustedEvent(input));
    harness.source.dispatch("keydown", trustedEvent(input, { key: "Enter" }));

    expect(harness.scheduler.size).toBe(0);
    expect(harness.events).toEqual([
      expect.objectContaining({
        kind: "input",
        payload: { value: "automation", inputType: "search" }
      }),
      expect.objectContaining({
        kind: "pressKey",
        target: { locators: [{ type: "css", value: "#query" }] },
        payload: { key: "Enter" }
      })
    ]);
  });

  it("ignores untrusted select, check and key events", () => {
    const harness = createHarness();
    const select = new FakeElement("select", { id: "country" });
    select.selectedIndex = 0;
    select.options = [{ value: "ca", label: "Canada" }];
    const checkbox = new FakeElement("input", { type: "checkbox" });
    checkbox.checked = true;
    const button = new FakeElement("button");
    harness.capture.start(captureSession());

    harness.source.dispatch("change", untrustedEvent(select));
    harness.source.dispatch("change", untrustedEvent(checkbox));
    harness.source.dispatch(
      "keydown",
      untrustedEvent(button, { key: "Enter" })
    );

    expect(harness.events).toEqual([]);
  });

  it("calls timer hooks without an illegal receiver", () => {
    const source = new FakeDocumentSource();
    const events: RecorderEvent[] = [];
    const errors: unknown[] = [];
    const tasks = new Map<ReturnType<typeof setTimeout>, () => void>();
    let nextHandle = 0;
    const schedule: NonNullable<RecorderCaptureOptions["schedule"]> = function (
      this: unknown,
      callback
    ) {
      if (this !== undefined) {
        throw new TypeError("Illegal invocation");
      }
      const handle = { id: ++nextHandle } as unknown as ReturnType<
        typeof setTimeout
      >;
      tasks.set(handle, callback);
      return handle;
    };
    const cancel: NonNullable<
      RecorderCaptureOptions["cancelScheduled"]
    > = function (this: unknown, handle) {
      if (this !== undefined) {
        throw new TypeError("Illegal invocation");
      }
      tasks.delete(handle);
    };
    const capture = new RecorderDomCapture(
      source,
      (event) => events.push(event),
      {
        schedule,
        cancelScheduled: cancel,
        generateTarget: () => ({
          locators: [{ type: "testId", value: "recorder-input" }]
        }),
        onError: (error) => errors.push(error)
      }
    );
    const input = new FakeElement("input", { type: "text" });
    capture.start(captureSession());

    input.value = "R";
    source.dispatch("input", trustedEvent(input));
    input.value = "Record";
    source.dispatch("input", trustedEvent(input));
    [...tasks.values()].forEach((task) => task());

    expect(errors).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "input",
      payload: { value: "Record" }
    });
  });

  it("does not record password values", () => {
    const harness = createHarness();
    const password = new FakeElement("input", {
      name: "password",
      type: "password"
    });
    password.value = "secret-value";
    harness.capture.start(captureSession());

    harness.source.dispatch("input", trustedEvent(password));
    harness.scheduler.flushAll();

    expect(harness.events).toEqual([]);
    expect(harness.scheduler.size).toBe(0);
  });

  it("flushes pending input and removes every listener after Stop", () => {
    const harness = createHarness();
    const textarea = new FakeElement("textarea", { id: "notes" });
    textarea.value = "latest text";
    harness.capture.start(captureSession());
    harness.source.dispatch("input", trustedEvent(textarea));

    expect(harness.capture.stop()).toEqual({
      stopped: true,
      flushedInputCount: 1
    });
    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({
      kind: "input",
      payload: { value: "latest text", inputType: "textarea" }
    });
    expect(harness.source.listenerCount("click")).toBe(0);
    expect(harness.source.listenerCount("input")).toBe(0);
    expect(harness.source.listenerCount("change")).toBe(0);
    expect(harness.source.listenerCount("keydown")).toBe(0);

    harness.source.dispatch("click", trustedEvent(textarea));
    expect(harness.events).toHaveLength(1);
    expect(harness.capture.stop()).toEqual({
      stopped: false,
      flushedInputCount: 0
    });
  });

  it("makes repeated start idempotent without duplicate handlers", () => {
    const harness = createHarness();
    const session = captureSession();

    expect(harness.capture.start(session)).toEqual({
      sessionId: "recorder-1",
      alreadyActive: false
    });
    expect(harness.capture.start(session)).toEqual({
      sessionId: "recorder-1",
      alreadyActive: true
    });
    expect(harness.source.listenerCount("click")).toBe(1);
    expect(harness.source.listenerCount("input")).toBe(1);
    expect(harness.source.listenerCount("change")).toBe(1);
    expect(harness.source.listenerCount("keydown")).toBe(1);

    harness.source.dispatch(
      "click",
      trustedEvent(new FakeElement("button", { id: "one-click" }))
    );
    expect(harness.events).toHaveLength(1);
  });

  it("reports capture failures without stopping the session", () => {
    const errors: unknown[] = [];
    const harness = createHarness({
      generateTarget: () => {
        throw new Error("Locator generation failed");
      },
      onError: (error, context) => errors.push({ error, context })
    });
    harness.capture.start(captureSession());

    harness.source.dispatch(
      "click",
      trustedEvent(new FakeElement("button", { id: "broken" }))
    );

    expect(harness.events).toEqual([]);
    expect(harness.capture.status()).toEqual({
      recording: true,
      sessionId: "recorder-1"
    });
    expect(errors).toMatchObject([
      {
        error: { message: "Locator generation failed" },
        context: {
          action: "capture-click",
          tabId: 42,
          sessionId: "recorder-1"
        }
      }
    ]);
  });
});

describe("Recorder content message contract", () => {
  it("starts, reports and stops capture through typed commands", () => {
    const harness = createHarness();
    const controller = new RecorderContentController(harness.capture);
    const start = {
      type: RECORDER_CONTENT_MESSAGE,
      action: "start" as const,
      ...captureSession()
    };

    expect(isRecorderContentMessage(start)).toBe(true);
    expect(controller.handle(start)).toEqual({
      ok: true,
      result: {
        kind: "started",
        sessionId: "recorder-1",
        alreadyActive: false
      }
    });
    expect(
      controller.handle({ type: RECORDER_CONTENT_MESSAGE, action: "status" })
    ).toEqual({
      ok: true,
      result: { kind: "status", recording: true, sessionId: "recorder-1" }
    });
    expect(
      controller.handle({ type: RECORDER_CONTENT_MESSAGE, action: "stop" })
    ).toEqual({
      ok: true,
      result: { kind: "stopped", stopped: true, flushedInputCount: 0 }
    });
    expect(controller.handle({ type: "unrelated" })).toBeUndefined();
  });

  it("recognizes the typed event envelope sent to background", () => {
    const harness = createHarness();
    harness.capture.start(captureSession());
    harness.source.dispatch(
      "click",
      trustedEvent(new FakeElement("button", { id: "save" }))
    );
    const message = {
      type: RECORDER_EVENT_MESSAGE,
      event: harness.events[0]
    };

    expect(isRecorderEventMessage(message)).toBe(true);
    expect(isRecorderEventMessage({ ...message, event: { kind: "click" } })).toBe(
      false
    );
  });

  it("recognizes an extended recorder-event envelope", () => {
    const event: RecorderEvent = {
      version: 1,
      eventId: "event-select",
      sessionId: "recorder-1",
      tabId: 42,
      documentId: "document-1",
      occurredAt: "2026-09-28T18:00:00.000Z",
      url: "https://example.com/form",
      kind: "select",
      target: { locators: [{ type: "testId", value: "country" }] },
      payload: { option: { by: "value", value: "ca" } }
    };

    expect(
      isRecorderEventMessage({ type: RECORDER_EVENT_MESSAGE, event })
    ).toBe(true);
    expect(
      isRecorderEventMessage({
        type: RECORDER_EVENT_MESSAGE,
        event: { ...event, target: undefined }
      })
    ).toBe(false);
  });

  it("recognizes typed content-script diagnostics", () => {
    const diagnostic = {
      type: RECORDER_DIAGNOSTIC_MESSAGE,
      tabId: 42,
      sessionId: "recorder-1",
      action: "capture-click",
      message: "Unable to capture click.",
      details: "Error: locator failed"
    };

    expect(isRecorderDiagnosticMessage(diagnostic)).toBe(true);
    expect(isRecorderDiagnosticMessage({ ...diagnostic, tabId: "42" })).toBe(
      false
    );
  });
});

function createHarness(overrides: Partial<RecorderCaptureOptions> = {}) {
  const source = new FakeDocumentSource();
  const scheduler = new ManualScheduler();
  const events: RecorderEvent[] = [];
  let eventIndex = 0;
  const options: RecorderCaptureOptions = {
    inputDebounceMs: 300,
    clock: () => "2026-09-28T18:00:00.000Z",
    createEventId: () => `event-${++eventIndex}`,
    schedule: scheduler.schedule,
    cancelScheduled: scheduler.cancel,
    generateTarget: (element) => {
      const testId = element.getAttribute("data-testid");
      if (testId !== null) {
        return { locators: [{ type: "testId", value: testId }] };
      }
      const id = element.getAttribute("id");
      if (id !== null) {
        return { locators: [{ type: "css", value: `#${id}` }] };
      }
      const tag = element.tagName.toLowerCase();
      const name = element.getAttribute("name");
      return {
        locators: [
          {
            type: "css",
            value: name === null ? tag : `${tag}[name="${name}"]`
          }
        ]
      };
    },
    ...overrides
  };
  const capture = new RecorderDomCapture(
    source,
    (event) => events.push(event),
    options
  );
  return { capture, events, scheduler, source };
}

function captureSession() {
  return {
    sessionId: "recorder-1",
    tabId: 42,
    documentId: "document-1",
    url: "https://example.com/form"
  };
}

type DocumentListener = Parameters<
  RecorderDocumentEventSource["addEventListener"]
>[1];
type DocumentEventType = Parameters<
  RecorderDocumentEventSource["addEventListener"]
>[0];

class FakeDocumentSource implements RecorderDocumentEventSource {
  readonly #listeners = new Map<DocumentEventType, Set<DocumentListener>>();

  addEventListener(
    type: DocumentEventType,
    listener: DocumentListener
  ): void {
    const listeners = this.#listeners.get(type) ?? new Set<DocumentListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(
    type: DocumentEventType,
    listener: DocumentListener
  ): void {
    this.#listeners.get(type)?.delete(listener);
  }

  dispatch(type: DocumentEventType, event: ReturnType<typeof trustedEvent>) {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }

  listenerCount(type: DocumentEventType): number {
    return this.#listeners.get(type)?.size ?? 0;
  }
}

class FakeElement {
  readonly tagName: string;
  readonly #attributes: Readonly<Record<string, string>>;
  checked = false;
  options: Array<{ value: string; label?: string; textContent?: string }> = [];
  selectedIndex = -1;
  value = "";
  textContent = "";
  isContentEditable = false;

  constructor(tagName: string, attributes: Record<string, string> = {}) {
    this.tagName = tagName.toUpperCase();
    this.#attributes = attributes;
  }

  getAttribute(name: string): string | null {
    return this.#attributes[name] ?? null;
  }
}

function trustedEvent(
  target: FakeElement,
  details: Record<string, unknown> = {}
) {
  return {
    isTrusted: true,
    target: target as unknown as EventTarget,
    composedPath: () => [target as unknown as EventTarget],
    ...details
  };
}

function untrustedEvent(
  target: FakeElement,
  details: Record<string, unknown> = {}
) {
  return { ...trustedEvent(target, details), isTrusted: false };
}

class ManualScheduler {
  readonly #tasks = new Map<ReturnType<typeof setTimeout>, () => void>();
  #nextId = 0;

  readonly schedule: NonNullable<RecorderCaptureOptions["schedule"]> = (
    callback
  ) => {
    const handle = { id: ++this.#nextId } as unknown as ReturnType<
      typeof setTimeout
    >;
    this.#tasks.set(handle, callback);
    return handle;
  };

  readonly cancel: NonNullable<RecorderCaptureOptions["cancelScheduled"]> = (
    handle
  ) => {
    this.#tasks.delete(handle);
  };

  get size(): number {
    return this.#tasks.size;
  }

  flushAll(): void {
    const tasks = [...this.#tasks.values()];
    this.#tasks.clear();
    tasks.forEach((task) => task());
  }
}
