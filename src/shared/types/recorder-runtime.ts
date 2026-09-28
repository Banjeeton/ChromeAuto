import type { RecorderEvent } from "../../core/domain/recorder-event";

export const RECORDER_CONTENT_MESSAGE = "automation/recorder-content" as const;
export const RECORDER_EVENT_MESSAGE = "automation/recorder-event" as const;

export type RecorderContentMessage =
  | {
      readonly type: typeof RECORDER_CONTENT_MESSAGE;
      readonly action: "start";
      readonly sessionId: string;
      readonly tabId: number;
      readonly documentId: string;
      readonly url: string;
    }
  | {
      readonly type: typeof RECORDER_CONTENT_MESSAGE;
      readonly action: "stop" | "status";
    };

export type RecorderContentResult =
  | {
      readonly kind: "started";
      readonly sessionId: string;
      readonly alreadyActive: boolean;
    }
  | {
      readonly kind: "stopped";
      readonly stopped: boolean;
      readonly flushedInputCount: number;
    }
  | {
      readonly kind: "status";
      readonly recording: boolean;
      readonly sessionId?: string;
    };

export type RecorderContentResponse =
  | { readonly ok: true; readonly result: RecorderContentResult }
  | { readonly ok: false; readonly error: string };

export interface RecorderEventMessage {
  readonly type: typeof RECORDER_EVENT_MESSAGE;
  readonly event: RecorderEvent;
}

export interface RecorderEventReceivedResult {
  readonly kind: "recorder-event-received";
  readonly eventId: string;
}

export type RecorderEventResponse =
  | { readonly ok: true; readonly result: RecorderEventReceivedResult }
  | { readonly ok: false; readonly error: string };

export function isRecorderContentMessage(
  value: unknown
): value is RecorderContentMessage {
  if (!isObject(value) || value.type !== RECORDER_CONTENT_MESSAGE) {
    return false;
  }
  if (value.action === "stop" || value.action === "status") {
    return true;
  }
  return (
    value.action === "start" &&
    typeof value.sessionId === "string" &&
    value.sessionId.trim().length > 0 &&
    Number.isInteger(value.tabId) &&
    (value.tabId as number) >= 0 &&
    typeof value.documentId === "string" &&
    value.documentId.trim().length > 0 &&
    typeof value.url === "string" &&
    value.url.length > 0
  );
}

export function isRecorderEventMessage(
  value: unknown
): value is RecorderEventMessage {
  if (
    !isObject(value) ||
    value.type !== RECORDER_EVENT_MESSAGE ||
    !isObject(value.event)
  ) {
    return false;
  }

  const event = value.event;
  return (
    event.version === 1 &&
    typeof event.eventId === "string" &&
    event.eventId.length > 0 &&
    typeof event.sessionId === "string" &&
    event.sessionId.length > 0 &&
    Number.isInteger(event.tabId) &&
    (event.tabId as number) >= 0 &&
    typeof event.documentId === "string" &&
    event.documentId.length > 0 &&
    typeof event.occurredAt === "string" &&
    typeof event.url === "string" &&
    (event.kind === "click" ||
      event.kind === "input" ||
      event.kind === "reload" ||
      event.kind === "pageReady") &&
    isObject(event.payload) &&
    ((event.kind !== "click" && event.kind !== "input") ||
      isObject(event.target))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
