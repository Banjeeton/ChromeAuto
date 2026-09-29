import type {
  RecorderRuntimeState,
  RecorderSessionId,
  RecorderStopReason,
  RecordingRecorderState
} from "../domain/recorder-session";

export type { RecorderEvent } from "../domain/recorder-event";
export type {
  RecorderRuntimeState,
  RecorderSessionId,
  RecorderState,
  RecorderStopReason
} from "../domain/recorder-session";

export interface StartRecorderRequest {
  readonly sessionId: RecorderSessionId;
  readonly tabId: number;
  readonly url: string;
}

export interface StopRecorderRequest {
  readonly tabId: number;
  readonly reason: RecorderStopReason;
}

export interface GetRecorderStateRequest {
  readonly tabId: number;
}

/**
 * Browser-independent recording boundary used by the application layer.
 *
 * Implementations may communicate with a content script, but Chrome and DOM
 * objects are not allowed to cross this interface.
 */
export interface Recorder {
  start(request: StartRecorderRequest): Promise<RecordingRecorderState>;
  stop(request: StopRecorderRequest): Promise<RecorderRuntimeState>;
  getState(request: GetRecorderStateRequest): Promise<RecorderRuntimeState>;
}
