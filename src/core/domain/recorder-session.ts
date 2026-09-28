import type { RecorderErrorCode } from "./recorder-error";

export const RECORDER_STATES = [
  "idle",
  "recording",
  "stopping",
  "stopped",
  "failed"
] as const;

export type RecorderState = (typeof RECORDER_STATES)[number];
export type RecorderSessionId = string;
export type RecorderProtocol = "http" | "https";

export type RecorderStopReason =
  | "user"
  | "tab-context-changed"
  | "tab-closed";

export interface RecorderSourceContext {
  readonly url: string;
  readonly hostname: string;
  readonly protocol: RecorderProtocol;
}

export interface IdleRecorderState {
  readonly state: "idle";
  readonly tabId: number;
}

export interface RecorderSessionBase {
  readonly sessionId: RecorderSessionId;
  readonly tabId: number;
  readonly context: RecorderSourceContext;
  readonly startedAt: string;
  readonly recordedEventCount: number;
}

export interface RecordingRecorderState extends RecorderSessionBase {
  readonly state: "recording";
}

export interface StoppingRecorderState extends RecorderSessionBase {
  readonly state: "stopping";
  readonly stopReason: RecorderStopReason;
}

export interface StoppedRecorderState extends RecorderSessionBase {
  readonly state: "stopped";
  readonly stopReason: RecorderStopReason;
  readonly stoppedAt: string;
}

export interface RecorderFailureDetails {
  readonly code: RecorderErrorCode;
  readonly message: string;
}

export interface FailedRecorderState extends RecorderSessionBase {
  readonly state: "failed";
  readonly failedAt: string;
  readonly failure: RecorderFailureDetails;
}

export type RecorderRuntimeState =
  | IdleRecorderState
  | RecordingRecorderState
  | StoppingRecorderState
  | StoppedRecorderState
  | FailedRecorderState;
