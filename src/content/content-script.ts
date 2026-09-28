import { RecorderContentController } from "./recorder-content-controller";
import { RecorderDomCapture } from "./recorder-dom-capture";
import type {
  RecorderDiagnosticMessage,
  RecorderEventMessage,
  RecorderEventResponse
} from "../shared/types/recorder-runtime";

const capture = new RecorderDomCapture(document, (event) => {
  const message: RecorderEventMessage = {
    type: "automation/recorder-event",
    event
  };
  void chrome.runtime
    .sendMessage<RecorderEventMessage, RecorderEventResponse>(message)
    .then((response) => {
      if (response === undefined) {
        reportDiagnostic({
          type: "automation/recorder-diagnostic",
          tabId: event.tabId,
          sessionId: event.sessionId,
          action: "deliver-event",
          message: `Unable to deliver ${event.kind} action to background: Background did not respond.`,
          eventId: event.eventId,
          eventKind: event.kind
        });
      }
    })
    .catch((error: unknown) => {
      console.error("Unable to deliver a recorded action to background.", error);
      reportDiagnostic({
        type: "automation/recorder-diagnostic",
        tabId: event.tabId,
        sessionId: event.sessionId,
        action: "deliver-event",
        message: `Unable to deliver ${event.kind} action to background.`,
        details: technicalDetails(error),
        eventId: event.eventId,
        eventKind: event.kind
      });
    });
}, {
  onError: (error, context) => {
    reportDiagnostic({
      type: "automation/recorder-diagnostic",
      tabId: context.tabId,
      sessionId: context.sessionId,
      action: context.action,
      message: `Unable to ${context.action.replace("-", " ")}. The previous recorder draft was preserved.`,
      details: technicalDetails(error)
    });
  }
});
const controller = new RecorderContentController(capture);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const response = controller.handle(message);
  if (response === undefined) {
    return false;
  }
  sendResponse(response);
  return false;
});

function reportDiagnostic(message: RecorderDiagnosticMessage): void {
  void chrome.runtime.sendMessage(message).catch((error: unknown) => {
    console.error(message.message, error);
  });
}

function technicalDetails(error: unknown): string {
  return error instanceof Error
    ? error.stack ?? `${error.name}: ${error.message}`
    : String(error);
}
