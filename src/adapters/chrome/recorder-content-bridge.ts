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

export interface ChromeRecorderContentBridgeOptions {
  readonly sendMessage?: (
    tabId: number,
    message: RecorderContentMessage
  ) => Promise<RecorderContentResponse | undefined>;
  readonly injectContentScript?: (tabId: number) => Promise<void>;
  readonly delay?: (milliseconds: number) => Promise<void>;
  readonly retryAttempts?: number;
  readonly retryDelayMs?: number;
}

/** Delivers recorder lifecycle commands to the content script in one tab. */
export class ChromeRecorderContentBridge implements RecorderContentBridge {
  readonly #sendMessage: NonNullable<
    ChromeRecorderContentBridgeOptions["sendMessage"]
  >;
  readonly #injectContentScript: NonNullable<
    ChromeRecorderContentBridgeOptions["injectContentScript"]
  >;
  readonly #delay: NonNullable<ChromeRecorderContentBridgeOptions["delay"]>;
  readonly #retryAttempts: number;
  readonly #retryDelayMs: number;

  constructor(options: ChromeRecorderContentBridgeOptions = {}) {
    this.#sendMessage =
      options.sendMessage ??
      ((tabId, message) =>
        chrome.tabs.sendMessage<
          RecorderContentMessage,
          RecorderContentResponse
        >(tabId, message));
    this.#injectContentScript =
      options.injectContentScript ??
      (async (tabId) => {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content/content-script-loader.js"]
        });
      });
    this.#delay =
      options.delay ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#retryAttempts = options.retryAttempts ?? 5;
    this.#retryDelayMs = options.retryDelayMs ?? 50;
    if (!Number.isInteger(this.#retryAttempts) || this.#retryAttempts < 1) {
      throw new RangeError("retryAttempts must be a positive integer");
    }
    if (!Number.isFinite(this.#retryDelayMs) || this.#retryDelayMs < 0) {
      throw new RangeError("retryDelayMs must be a non-negative number");
    }
  }

  async startCapture(request: StartRecorderCaptureRequest): Promise<void> {
    const message: RecorderContentMessage = {
      type: RECORDER_CONTENT_MESSAGE,
      action: "start",
      ...request
    };
    const response = await this.#sendWithInstallation(request.tabId, message);
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
      const response = await this.#sendMessage(tabId, message);
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

  async #sendWithInstallation(
    tabId: number,
    message: RecorderContentMessage
  ): Promise<Extract<RecorderContentResponse, { readonly ok: true }>> {
    try {
      return await this.#send(tabId, message);
    } catch (error) {
      if (!isMissingContentScriptError(error)) {
        throw error;
      }
    }

    try {
      await this.#injectContentScript(tabId);
    } catch (error) {
      throw new RecorderError(
        "recorder-unavailable",
        `Unable to install recorder capture in tab ${tabId}.`,
        { context: { tabId }, cause: error }
      );
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < this.#retryAttempts; attempt += 1) {
      await this.#delay(this.#retryDelayMs);
      try {
        return await this.#send(tabId, message);
      } catch (error) {
        lastError = error;
        if (!isMissingContentScriptError(error)) {
          throw error;
        }
      }
    }

    throw new RecorderError(
      "recorder-unavailable",
      `Recorder content script did not become ready in tab ${tabId}.`,
      { context: { tabId }, cause: lastError }
    );
  }

  #unexpectedResponse(tabId: number, action: string): RecorderError {
    return new RecorderError(
      "recorder-unavailable",
      `Content script returned an unexpected response for recorder ${action}.`,
      { context: { tabId } }
    );
  }
}

function isMissingContentScriptError(error: unknown): boolean {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  const combined = messages.join(" ");
  return (
    combined.includes("Receiving end does not exist") ||
    combined.includes("Could not establish connection") ||
    combined.includes("Content script did not respond")
  );
}
