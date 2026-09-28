import { RecorderContentController } from "./recorder-content-controller";
import { RecorderDomCapture } from "./recorder-dom-capture";
import type {
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
    .catch((error: unknown) => {
      console.error("Unable to deliver a recorded action to background.", error);
    });
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
