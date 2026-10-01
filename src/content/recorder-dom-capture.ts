import type {
  RecorderCheckEvent,
  RecorderClickEvent,
  RecorderEvent,
  RecorderInputEvent,
  RecorderInputType,
  RecorderPressKeyEvent,
  RecorderSelectEvent,
  RecorderTargetCandidate,
  RecorderUncheckEvent
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
  readonly action:
    | "capture-click"
    | "capture-input"
    | "capture-change"
    | "capture-keydown";
  readonly tabId: number;
  readonly sessionId: string;
}

type RecorderDocumentEvent = Pick<Event, "isTrusted" | "target" | "composedPath">;
type RecorderDocumentListener = (event: RecorderDocumentEvent) => void;

export interface RecorderDocumentEventSource {
  addEventListener(
    type: "click" | "input" | "change" | "keydown",
    listener: RecorderDocumentListener,
    options: { readonly capture: true }
  ): void;
  removeEventListener(
    type: "click" | "input" | "change" | "keydown",
    listener: RecorderDocumentListener,
    options: { readonly capture: true }
  ): void;
}

export interface RecorderCaptureElement {
  readonly tagName: string;
  readonly textContent?: string | null;
  readonly isContentEditable?: boolean;
  readonly checked?: unknown;
  readonly options?: ArrayLike<RecorderSelectOptionElement>;
  readonly selectedIndex?: unknown;
  readonly value?: unknown;
  getAttribute(name: string): string | null;
}

export interface RecorderSelectOptionElement {
  readonly label?: unknown;
  readonly textContent?: string | null;
  readonly value?: unknown;
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
      if (element === undefined || suppressSemanticClick(event, element)) {
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

  readonly #handleChange = (event: RecorderDocumentEvent): void => {
    try {
      if (!event.isTrusted || this.#session === undefined) {
        return;
      }
      const element = eventElement(event);
      if (element === undefined) {
        return;
      }

      const select = readSelect(element);
      const checked = readCheckedControl(element);
      if (select === undefined && checked === undefined) {
        return;
      }

      this.#flushPendingInputs();
      const target = this.#generateTarget(element);
      if (select !== undefined) {
        const captured: RecorderSelectEvent = {
          ...this.#eventBase("select"),
          target,
          payload: { option: select }
        };
        this.#emit(captured);
        return;
      }

      if (checked === undefined) {
        return;
      }
      if (checked.kind === "check") {
        const captured: RecorderCheckEvent = {
          ...this.#eventBase("check"),
          target,
          payload: {
            control: checked.control,
            checked: true
          }
        };
        this.#emit(captured);
        return;
      }

      const captured: RecorderUncheckEvent = {
        ...this.#eventBase("uncheck"),
        target,
        payload: { control: "checkbox", checked: false }
      };
      this.#emit(captured);
    } catch (error) {
      this.#reportError(error, "capture-change");
    }
  };

  readonly #handleKeydown = (event: RecorderDocumentEvent): void => {
    try {
      if (!event.isTrusted || this.#session === undefined) {
        return;
      }
      const element = eventElement(event);
      if (element === undefined) {
        return;
      }
      const keyboard = event as RecorderDocumentEvent & {
        readonly key?: string;
        readonly altKey?: boolean;
        readonly ctrlKey?: boolean;
        readonly metaKey?: boolean;
        readonly shiftKey?: boolean;
      };
      const key = recordedKey(keyboard, element);
      if (key === undefined) {
        return;
      }

      this.#flushPendingInputs();
      const captured: RecorderPressKeyEvent = {
        ...this.#eventBase("pressKey"),
        target: this.#generateTarget(element),
        payload: { key }
      };
      this.#emit(captured);
    } catch (error) {
      this.#reportError(error, "capture-keydown");
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
    const configuredSchedule = options.schedule;
    const configuredCancel = options.cancelScheduled;
    this.#schedule =
      configuredSchedule === undefined
        ? (callback, delayMs) => globalThis.setTimeout(callback, delayMs)
        : (callback, delayMs) => configuredSchedule(callback, delayMs);
    this.#cancelScheduled =
      configuredCancel === undefined
        ? (handle) => globalThis.clearTimeout(handle)
        : (handle) => configuredCancel(handle);
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
    this.#source.addEventListener(
      "change",
      this.#handleChange,
      CAPTURE_OPTIONS
    );
    this.#source.addEventListener(
      "keydown",
      this.#handleKeydown,
      CAPTURE_OPTIONS
    );
    return { sessionId: session.sessionId, alreadyActive: false };
  }

  stop(): RecorderCaptureStopResult {
    if (this.#session === undefined) {
      return { stopped: false, flushedInputCount: 0 };
    }

    this.#source.removeEventListener("click", this.#handleClick, CAPTURE_OPTIONS);
    this.#source.removeEventListener("input", this.#handleInput, CAPTURE_OPTIONS);
    this.#source.removeEventListener(
      "change",
      this.#handleChange,
      CAPTURE_OPTIONS
    );
    this.#source.removeEventListener(
      "keydown",
      this.#handleKeydown,
      CAPTURE_OPTIONS
    );
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

  #eventBase<K extends RecorderEvent["kind"]>(kind: K) {
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
    if (
      !["text", "email", "search", "tel", "url", "number"].includes(type) ||
      typeof element.value !== "string"
    ) {
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

function suppressSemanticClick(
  event: RecorderDocumentEvent,
  element: RecorderCaptureElement
): boolean {
  const candidates: RecorderCaptureElement[] = [element];
  for (const candidate of event.composedPath()) {
    if (isElementLike(candidate)) {
      candidates.push(candidate);
    }
  }
  return candidates.some((candidate) => {
    const tagName = candidate.tagName.toLowerCase();
    if (tagName === "select" || tagName === "option" || tagName === "label") {
      return true;
    }
    if (tagName !== "input") {
      return false;
    }
    const type = (candidate.getAttribute("type") ?? "text").toLowerCase();
    return type === "checkbox" || type === "radio";
  });
}

function readSelect(
  element: RecorderCaptureElement
): RecorderSelectEvent["payload"]["option"] | undefined {
  if (
    element.tagName.toLowerCase() !== "select" ||
    !Number.isInteger(element.selectedIndex) ||
    (element.selectedIndex as number) < 0
  ) {
    return undefined;
  }

  const selectedIndex = element.selectedIndex as number;
  const options = Array.from(element.options ?? []);
  const selected = options[selectedIndex];
  if (selected === undefined) {
    return { by: "index", value: selectedIndex };
  }

  const label =
    typeof selected.label === "string"
      ? selected.label
      : selected.textContent ?? "";
  if (
    label.length > 0 &&
    options.filter((option) => {
      const candidate =
        typeof option.label === "string"
          ? option.label
          : option.textContent ?? "";
      return candidate === label;
    }).length === 1
  ) {
    return { by: "label", value: label };
  }

  // Application-generated option values are frequently hashes or temporary
  // database keys. Prefer the user-visible label because it is much more
  // likely to survive a reload or a later repeat-cycle pass. Value remains a
  // fallback for selects whose labels are empty or duplicated.
  const value = typeof selected.value === "string" ? selected.value : "";
  if (
    value.length > 0 &&
    options.filter((option) => option.value === value).length === 1
  ) {
    return { by: "value", value };
  }

  return { by: "index", value: selectedIndex };
}

function readCheckedControl(
  element: RecorderCaptureElement
):
  | { readonly kind: "check"; readonly control: "checkbox" | "radio" }
  | { readonly kind: "uncheck"; readonly control: "checkbox" }
  | undefined {
  if (
    element.tagName.toLowerCase() !== "input" ||
    typeof element.checked !== "boolean"
  ) {
    return undefined;
  }

  const type = (element.getAttribute("type") ?? "text").toLowerCase();
  if (type === "checkbox") {
    return element.checked
      ? { kind: "check", control: "checkbox" }
      : { kind: "uncheck", control: "checkbox" };
  }
  if (type === "radio" && element.checked) {
    return { kind: "check", control: "radio" };
  }
  return undefined;
}

const RECORDED_SPECIAL_KEYS = new Set([
  "Enter",
  "Escape",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "Delete",
  "Backspace",
  "Space",
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`)
]);

const TEXT_EDITING_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "Delete",
  "Backspace",
  "Space"
]);

function recordedKey(
  event: {
    readonly key?: string;
    readonly altKey?: boolean;
    readonly ctrlKey?: boolean;
    readonly metaKey?: boolean;
    readonly shiftKey?: boolean;
  },
  element: RecorderCaptureElement
): string | undefined {
  const key = event.key === " " ? "Space" : event.key;
  if (key === undefined || !RECORDED_SPECIAL_KEYS.has(key)) {
    return undefined;
  }
  if (isEditableElement(element) && TEXT_EDITING_KEYS.has(key)) {
    return undefined;
  }

  return [
    ...(event.ctrlKey ? ["Control"] : []),
    ...(event.altKey ? ["Alt"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
    ...(event.metaKey ? ["Meta"] : []),
    key
  ].join("+");
}

function isEditableElement(element: RecorderCaptureElement): boolean {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "textarea" || element.isContentEditable === true) {
    return true;
  }
  if (tagName !== "input") {
    return false;
  }
  const type = (element.getAttribute("type") ?? "text").toLowerCase();
  return ["text", "email", "search", "tel", "url", "number"].includes(type);
}
