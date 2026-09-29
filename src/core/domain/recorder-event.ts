import type {
  ElementLocator,
  MouseButton,
  SelectOption
} from "./automation-step";

export const RECORDER_EVENT_KINDS = [
  "click",
  "input",
  "select",
  "check",
  "uncheck",
  "pressKey",
  "reload",
  "pageReady"
] as const;

export type RecorderEventKind = (typeof RECORDER_EVENT_KINDS)[number];

export type RecorderModifierKey = "Alt" | "Control" | "Meta" | "Shift";

export type RecorderInputType =
  | "text"
  | "email"
  | "search"
  | "tel"
  | "url"
  | "number"
  | "textarea"
  | "contenteditable";

export type RecorderPageReadyState = "domcontentloaded" | "load";

/**
 * Serializable locator candidates captured for an element.
 *
 * DOM nodes and browser-driver objects must never cross this boundary.
 */
export interface RecorderTargetCandidate {
  readonly locators: readonly ElementLocator[];
}

export interface RecorderEventBase {
  readonly version: 1;
  readonly eventId: string;
  readonly sessionId: string;
  readonly tabId: number;
  readonly documentId: string;
  readonly occurredAt: string;
  readonly url: string;
  readonly kind: RecorderEventKind;
}

export interface RecorderClickEvent extends RecorderEventBase {
  readonly kind: "click";
  readonly target: RecorderTargetCandidate;
  readonly payload: {
    readonly button: MouseButton;
    readonly clickCount: number;
    readonly modifiers: readonly RecorderModifierKey[];
  };
}

export interface RecorderInputEvent extends RecorderEventBase {
  readonly kind: "input";
  readonly target: RecorderTargetCandidate;
  readonly payload: {
    readonly value: string;
    readonly inputType: RecorderInputType;
  };
}

export interface RecorderSelectEvent extends RecorderEventBase {
  readonly kind: "select";
  readonly target: RecorderTargetCandidate;
  readonly payload: {
    readonly option: SelectOption;
  };
}

export interface RecorderCheckEvent extends RecorderEventBase {
  readonly kind: "check";
  readonly target: RecorderTargetCandidate;
  readonly payload: {
    readonly control: "checkbox" | "radio";
    readonly checked: true;
  };
}

export interface RecorderUncheckEvent extends RecorderEventBase {
  readonly kind: "uncheck";
  readonly target: RecorderTargetCandidate;
  readonly payload: {
    readonly control: "checkbox";
    readonly checked: false;
  };
}

export interface RecorderPressKeyEvent extends RecorderEventBase {
  readonly kind: "pressKey";
  readonly target: RecorderTargetCandidate;
  readonly payload: {
    readonly key: string;
  };
}

export interface RecorderReloadEvent extends RecorderEventBase {
  readonly kind: "reload";
  readonly payload: {
    readonly navigationId: string;
    readonly waitUntil: RecorderPageReadyState;
  };
}

export interface RecorderPageReadyEvent extends RecorderEventBase {
  readonly kind: "pageReady";
  readonly payload: {
    readonly navigationId: string;
    readonly state: RecorderPageReadyState;
  };
}

/** Internal event stream. It is never embedded into a portable preset. */
export type RecorderEvent =
  | RecorderClickEvent
  | RecorderInputEvent
  | RecorderSelectEvent
  | RecorderCheckEvent
  | RecorderUncheckEvent
  | RecorderPressKeyEvent
  | RecorderReloadEvent
  | RecorderPageReadyEvent;
