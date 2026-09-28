import { RecorderError } from "../../core/domain/recorder-error";
import type {
  RecorderContentBridge,
  StartRecorderCaptureRequest
} from "../../core/ports/recorder-content-bridge";
import {
  RECORDER_CONTENT_MESSAGE,
  type RecorderContentMessage,
  type RecorderContentResponse
} from "../../shared/types/recorder-runtime";

/** Delivers recorder lifecycle commands to the content script in one tab. */
export class ChromeRecorderContentBridge implements RecorderContentBridge {
  async startCapture(request: StartRecorderCaptureRequest): Promise<void> {
    const message: RecorderContentMessage = {
      type: RECORDER_CONTENT_MESSAGE,
      action: "start",
      ...request
    };
    const response = await this.#send(request.tabId, message);
    if (response.result.kind !== "started") {
      throw this.#unexpectedResponse(request.tabId, "start");
    }
  }

  async stopCapture(tabId: number): Promise<void> {
    const response = await this.#send(tabId, {
      type: RECORDER_CONTENT_MESSAGE,
      action: "stop"
    });
    if (response.result.kind !== "stopped") {
      throw this.#unexpectedResponse(tabId, "stop");
    }
  }

  async #send(
    tabId: number,
    message: RecorderContentMessage
  ): Promise<Extract<RecorderContentResponse, { readonly ok: true }>> {
    try {
      const response = await chrome.tabs.sendMessage<
        RecorderContentMessage,
        RecorderContentResponse
      >(tabId, message);
      if (response === undefined || !response.ok) {
        throw new Error(response?.error ?? "Content script did not respond.");
      }
      return response;
    } catch (error) {
      throw new RecorderError(
        "recorder-unavailable",
        `Unable to ${message.action} recorder capture in tab ${tabId}.`,
        { context: { tabId }, cause: error }
      );
    }
  }

  #unexpectedResponse(tabId: number, action: string): RecorderError {
    return new RecorderError(
      "recorder-unavailable",
      `Content script returned an unexpected response for recorder ${action}.`,
      { context: { tabId } }
    );
  }
}
