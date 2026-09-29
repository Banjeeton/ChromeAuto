import type { RecorderEventKind } from "./recorder-event";

export const RECORDER_ERROR_CODES = [
  "invalid-target",
  "unsupported-url",
  "session-conflict",
  "session-not-found",
  "invalid-event",
  "context-changed",
  "recorder-unavailable"
] as const;

export type RecorderErrorCode = (typeof RECORDER_ERROR_CODES)[number];

export interface RecorderErrorContext {
  readonly sessionId?: string;
  readonly tabId?: number;
  readonly eventId?: string;
  readonly eventKind?: RecorderEventKind;
  readonly url?: string;
}

export interface RecorderErrorOptions {
  readonly context?: RecorderErrorContext;
  readonly cause?: unknown;
}

/** Stable domain error exposed at the Recorder boundary. */
export class RecorderError extends Error {
  readonly code: RecorderErrorCode;
  readonly context: Readonly<RecorderErrorContext>;

  constructor(
    code: RecorderErrorCode,
    message: string,
    options: RecorderErrorOptions = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "RecorderError";
    this.code = code;
    this.context = Object.freeze({ ...options.context });
  }
}

export function isRecorderError(error: unknown): error is RecorderError {
  return error instanceof RecorderError;
}
