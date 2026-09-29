import type { RecorderDomCapture } from "./recorder-dom-capture";
import type {
  RecorderContentMessage,
  RecorderContentResponse
} from "../shared/types/recorder-runtime";

export class RecorderContentController {
  readonly #capture: RecorderDomCapture;

  constructor(capture: RecorderDomCapture) {
    this.#capture = capture;
  }

  handle(message: unknown): RecorderContentResponse | undefined {
    if (!isRecorderContentMessage(message)) {
      return undefined;
    }

    try {
      return { ok: true, result: this.#handleCommand(message) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  #handleCommand(message: RecorderContentMessage) {
    switch (message.action) {
      case "start": {
        const result = this.#capture.start({
          sessionId: message.sessionId,
          tabId: message.tabId,
          documentId: message.documentId,
          url: message.url
        });
        return { kind: "started" as const, ...result };
      }
      case "stop":
        return { kind: "stopped" as const, ...this.#capture.stop() };
      case "status":
        return { kind: "status" as const, ...this.#capture.status() };
    }
  }
}

function isRecorderContentMessage(
  value: unknown
): value is RecorderContentMessage {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    value.type !== "automation/recorder-content" ||
    !("action" in value)
  ) {
    return false;
  }
  if (value.action === "stop" || value.action === "status") {
    return true;
  }
  return (
    value.action === "start" &&
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    value.sessionId.trim().length > 0 &&
    "tabId" in value &&
    Number.isInteger(value.tabId) &&
    (value.tabId as number) >= 0 &&
    "documentId" in value &&
    typeof value.documentId === "string" &&
    value.documentId.trim().length > 0 &&
    "url" in value &&
    typeof value.url === "string" &&
    value.url.length > 0
  );
}
