import type {
  RecorderClickEvent,
  RecorderEvent,
  RecorderInputEvent,
  RecorderInputType,
  RecorderTargetCandidate
} from "../core/domain/recorder-event";
import { generateDomLocatorTarget } from "./locator-generator";

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
  readonly generateTarget?: (
    element: RecorderCaptureElement
  ) => RecorderTargetCandidate;
  readonly onError?: (
    error: unknown,
    context: RecorderCaptureErrorContext
  ) => void;
}

export interface RecorderCaptureErrorContext {
  readonly action: "capture-click" | "capture-input";
  readonly tabId: number;
  readonly sessionId: string;
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

export interface RecorderCaptureElement {
  readonly tagName: string;
  readonly textContent?: string | null;
  readonly isContentEditable?: boolean;
  readonly value?: unknown;
  getAttribute(name: string): string | null;
}

interface PendingInput {
  readonly element: RecorderCaptureElement;
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
  readonly #generateTarget: NonNullable<RecorderCaptureOptions["generateTarget"]>;
  readonly #onError: NonNullable<RecorderCaptureOptions["onError"]>;
  readonly #pendingInputs = new Map<RecorderCaptureElement, PendingInput>();
  #session?: RecorderCaptureSession;

  readonly #handleClick = (event: RecorderDocumentEvent): void => {
    try {
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
        target: this.#generateTarget(element),
        payload: {
          button:
            mouse.button === 1
              ? "middle"
              : mouse.button === 2
                ? "right"
                : "left",
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
    } catch (error) {
      this.#reportError(error, "capture-click");
    }
  };

  readonly #handleInput = (event: RecorderDocumentEvent): void => {
    try {
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
        target: this.#generateTarget(element),
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
    } catch (error) {
      this.#reportError(error, "capture-input");
    }
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
    this.#generateTarget =
      options.generateTarget ??
      ((element) => generateDomLocatorTarget(element as unknown as Element));
    this.#onError = options.onError ?? (() => undefined);
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

  #reportError(
    error: unknown,
    action: RecorderCaptureErrorContext["action"]
  ): void {
    const session = this.#session;
    if (session !== undefined) {
      this.#onError(error, {
        action,
        tabId: session.tabId,
        sessionId: session.sessionId
      });
    }
  }
}

function eventElement(
  event: RecorderDocumentEvent
): RecorderCaptureElement | undefined {
  for (const candidate of event.composedPath()) {
    if (isElementLike(candidate)) {
      return candidate;
    }
  }
  const target: unknown = event.target;
  return isElementLike(target) ? target : undefined;
}

function isElementLike(value: unknown): value is RecorderCaptureElement {
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
  element: RecorderCaptureElement
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
