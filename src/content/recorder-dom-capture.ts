import type {
  RecorderClickEvent,
  RecorderEvent,
  RecorderInputEvent,
  RecorderInputType,
  RecorderTargetCandidate
} from "../core/domain/recorder-event";

export interface RecorderCaptureSession {
  readonly sessionId: string;
  readonly tabId: number;
  readonly documentId: string;
  readonly url: string;
}

export interface RecorderCaptureStatus {
  readonly recording: boolean;
  readonly sessionId?: string;
}

export interface RecorderCaptureStartResult {
  readonly sessionId: string;
  readonly alreadyActive: boolean;
}

export interface RecorderCaptureStopResult {
  readonly stopped: boolean;
  readonly flushedInputCount: number;
}

export interface RecorderCaptureOptions {
  readonly inputDebounceMs?: number;
  readonly clock?: () => string;
  readonly createEventId?: () => string;
  readonly schedule?: (
    callback: () => void,
    delayMs: number
  ) => ReturnType<typeof setTimeout>;
  readonly cancelScheduled?: (handle: ReturnType<typeof setTimeout>) => void;
}

type RecorderDocumentEvent = Pick<Event, "isTrusted" | "target" | "composedPath">;
type RecorderDocumentListener = (event: RecorderDocumentEvent) => void;

export interface RecorderDocumentEventSource {
  addEventListener(
    type: "click" | "input",
    listener: RecorderDocumentListener,
    options: { readonly capture: true }
  ): void;
  removeEventListener(
    type: "click" | "input",
    listener: RecorderDocumentListener,
    options: { readonly capture: true }
  ): void;
}

interface ElementLike {
  readonly tagName: string;
  readonly textContent?: string | null;
  readonly isContentEditable?: boolean;
  readonly value?: unknown;
  getAttribute(name: string): string | null;
}

interface PendingInput {
  readonly element: ElementLike;
  event: RecorderInputEvent;
  handle: ReturnType<typeof setTimeout>;
}

const CAPTURE_OPTIONS = Object.freeze({ capture: true as const });

/** Captures trusted user actions while an explicit recorder session is active. */
export class RecorderDomCapture {
  readonly #source: RecorderDocumentEventSource;
  readonly #emit: (event: RecorderEvent) => void;
  readonly #inputDebounceMs: number;
  readonly #clock: () => string;
  readonly #createEventId: () => string;
  readonly #schedule: NonNullable<RecorderCaptureOptions["schedule"]>;
  readonly #cancelScheduled: NonNullable<
    RecorderCaptureOptions["cancelScheduled"]
  >;
  readonly #pendingInputs = new Map<ElementLike, PendingInput>();
  #session?: RecorderCaptureSession;

  readonly #handleClick = (event: RecorderDocumentEvent): void => {
    if (!event.isTrusted || this.#session === undefined) {
      return;
    }
    const element = eventElement(event);
    if (element === undefined) {
      return;
    }

    const mouse = event as RecorderDocumentEvent & {
      readonly button?: number;
      readonly detail?: number;
      readonly altKey?: boolean;
      readonly ctrlKey?: boolean;
      readonly metaKey?: boolean;
      readonly shiftKey?: boolean;
    };
    const captured: RecorderClickEvent = {
      ...this.#eventBase("click"),
      target: basicTargetCandidate(element),
      payload: {
        button:
          mouse.button === 1 ? "middle" : mouse.button === 2 ? "right" : "left",
        clickCount:
          Number.isInteger(mouse.detail) && (mouse.detail as number) > 0
            ? (mouse.detail as number)
            : 1,
        modifiers: [
          ...(mouse.altKey ? (["Alt"] as const) : []),
          ...(mouse.ctrlKey ? (["Control"] as const) : []),
          ...(mouse.metaKey ? (["Meta"] as const) : []),
          ...(mouse.shiftKey ? (["Shift"] as const) : [])
        ]
      }
    };
    this.#emit(captured);
  };

  readonly #handleInput = (event: RecorderDocumentEvent): void => {
    if (!event.isTrusted || this.#session === undefined) {
      return;
    }
    const element = eventElement(event);
    const input = element === undefined ? undefined : readInput(element);
    if (element === undefined || input === undefined) {
      return;
    }

    const previous = this.#pendingInputs.get(element);
    if (previous !== undefined) {
      this.#cancelScheduled(previous.handle);
    }

    const captured: RecorderInputEvent = {
      ...this.#eventBase("input"),
      target: basicTargetCandidate(element),
      payload: input
    };
    const handle = this.#schedule(() => {
      const pending = this.#pendingInputs.get(element);
      if (pending?.handle !== handle) {
        return;
      }
      this.#pendingInputs.delete(element);
      this.#emit(pending.event);
    }, this.#inputDebounceMs);
    this.#pendingInputs.set(element, { element, event: captured, handle });
  };

  constructor(
    source: RecorderDocumentEventSource,
    emit: (event: RecorderEvent) => void,
    options: RecorderCaptureOptions = {}
  ) {
    this.#source = source;
    this.#emit = emit;
    this.#inputDebounceMs = options.inputDebounceMs ?? 300;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#createEventId = options.createEventId ?? (() => crypto.randomUUID());
    this.#schedule = options.schedule ?? setTimeout;
    this.#cancelScheduled = options.cancelScheduled ?? clearTimeout;
  }

  start(session: RecorderCaptureSession): RecorderCaptureStartResult {
    if (this.#session?.sessionId === session.sessionId) {
      return { sessionId: session.sessionId, alreadyActive: true };
    }
    if (this.#session !== undefined) {
      this.stop();
    }

    this.#session = Object.freeze({ ...session });
    this.#source.addEventListener("click", this.#handleClick, CAPTURE_OPTIONS);
    this.#source.addEventListener("input", this.#handleInput, CAPTURE_OPTIONS);
    return { sessionId: session.sessionId, alreadyActive: false };
  }

  stop(): RecorderCaptureStopResult {
    if (this.#session === undefined) {
      return { stopped: false, flushedInputCount: 0 };
    }

    this.#source.removeEventListener("click", this.#handleClick, CAPTURE_OPTIONS);
    this.#source.removeEventListener("input", this.#handleInput, CAPTURE_OPTIONS);
    const flushedInputCount = this.#flushPendingInputs();
    this.#session = undefined;
    return { stopped: true, flushedInputCount };
  }

  status(): RecorderCaptureStatus {
    return this.#session === undefined
      ? { recording: false }
      : { recording: true, sessionId: this.#session.sessionId };
  }

  #flushPendingInputs(): number {
    const pending = [...this.#pendingInputs.values()];
    this.#pendingInputs.clear();
    for (const item of pending) {
      this.#cancelScheduled(item.handle);
      this.#emit(item.event);
    }
    return pending.length;
  }

  #eventBase<K extends "click" | "input">(kind: K) {
    const session = this.#session;
    if (session === undefined) {
      throw new Error("Recorder capture is not active.");
    }
    return {
      version: 1 as const,
      eventId: this.#createEventId(),
      sessionId: session.sessionId,
      tabId: session.tabId,
      documentId: session.documentId,
      occurredAt: this.#clock(),
      url: session.url,
      kind
    };
  }
}

function eventElement(event: RecorderDocumentEvent): ElementLike | undefined {
  for (const candidate of event.composedPath()) {
    if (isElementLike(candidate)) {
      return candidate;
    }
  }
  const target: unknown = event.target;
  return isElementLike(target) ? target : undefined;
}

function isElementLike(value: unknown): value is ElementLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "tagName" in value &&
    typeof value.tagName === "string" &&
    "getAttribute" in value &&
    typeof value.getAttribute === "function"
  );
}

function readInput(
  element: ElementLike
): { readonly value: string; readonly inputType: RecorderInputType } | undefined {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (type === "password" || typeof element.value !== "string") {
      return undefined;
    }
    const supportedType: RecorderInputType =
      type === "email" ||
      type === "search" ||
      type === "tel" ||
      type === "url" ||
      type === "number"
        ? type
        : "text";
    return { value: element.value, inputType: supportedType };
  }
  if (tagName === "textarea" && typeof element.value === "string") {
    return { value: element.value, inputType: "textarea" };
  }
  if (element.isContentEditable === true) {
    return {
      value: element.textContent ?? "",
      inputType: "contenteditable"
    };
  }
  return undefined;
}

function basicTargetCandidate(element: ElementLike): RecorderTargetCandidate {
  const testId = element.getAttribute("data-testid");
  if (testId !== null && testId.length > 0) {
    return { locators: [{ type: "testId", value: testId }] };
  }
  const id = element.getAttribute("id");
  if (id !== null && id.length > 0) {
    return { locators: [{ type: "css", value: `#${escapeCss(id)}` }] };
  }
  const tagName = element.tagName.toLowerCase();
  const name = element.getAttribute("name");
  if (name !== null && name.length > 0) {
    return {
      locators: [
        { type: "css", value: `${tagName}[name="${escapeAttribute(name)}"]` }
      ]
    };
  }
  return { locators: [{ type: "css", value: tagName }] };
}

function escapeCss(value: string): string {
  return value.replaceAll(/([^a-zA-Z0-9_-])/g, "\\$1");
}

function escapeAttribute(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
