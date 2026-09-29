import { RecorderError } from "../../core/domain/recorder-error";
import type {
  RecorderDocumentContext,
  RecorderDocumentProvider
} from "../../core/ports/recorder-document-provider";

/** Resolves the current top-level document without exposing Chrome types. */
export class ChromeRecorderDocumentProvider
  implements RecorderDocumentProvider
{
  async getMainDocument(tabId: number): Promise<RecorderDocumentContext> {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      const mainFrame = frames?.find(({ frameId }) => frameId === 0);
      if (
        mainFrame === undefined ||
        mainFrame.documentId.trim().length === 0
      ) {
        throw new Error("Chrome did not expose the main document.");
      }
      return {
        documentId: mainFrame.documentId,
        url: mainFrame.url
      };
    } catch (error) {
      throw new RecorderError(
        "recorder-unavailable",
        `Unable to inspect the current document in tab ${tabId}.`,
        { context: { tabId }, cause: error }
      );
    }
  }
}
