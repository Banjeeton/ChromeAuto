export interface StartRecorderCaptureRequest {
  readonly sessionId: string;
  readonly tabId: number;
  readonly documentId: string;
  readonly url: string;
}

export interface RecorderContentBridge {
  startCapture(request: StartRecorderCaptureRequest): Promise<void>;
  stopCapture(tabId: number): Promise<void>;
}
