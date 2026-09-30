import type { RecorderErrorCode } from "./recorder-error";
import type { RecorderEventKind } from "./recorder-event";
import type { RecorderStopReason } from "./recorder-session";

export type RecorderLogEvent =
  | "started"
  | "action-recorded"
  | "action-skipped"
  | "stopped"
  | "context-changed"
  | "tab-closed"
  | "failed";

export interface RecorderLogTechnicalDetails {
  readonly name: string;
  readonly message: string;
  readonly code?: RecorderErrorCode;
  readonly cause?: string;
  readonly stack?: string;
}

export interface RecorderLogEntry {
  readonly id: string;
  readonly recordedAt: string;
  readonly tabId: number;
  readonly sessionId?: string;
  readonly event: RecorderLogEvent;
  readonly action: string;
  readonly message: string;
  readonly recorderEventId?: string;
  readonly recorderEventKind?: RecorderEventKind;
  readonly stepCount?: number;
  readonly stopReason?: RecorderStopReason;
  readonly details?: RecorderLogTechnicalDetails;
}

export interface RecorderLogQuery {
  readonly tabId?: number;
  readonly sessionId?: string;
}
