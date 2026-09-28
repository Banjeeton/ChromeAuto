import { RecorderError, isRecorderError } from "../domain/recorder-error";
import type {
  RecorderRuntimeState,
  RecordingRecorderState
} from "../domain/recorder-session";
import type { RecorderContentBridge } from "../ports/recorder-content-bridge";
import type { RecorderDocumentProvider } from "../ports/recorder-document-provider";
import type {
  GetRecorderStateRequest,
  Recorder,
  StartRecorderRequest,
  StopRecorderRequest
} from "../ports/recorder";
import type {
  RecorderSessionRecord,
  RecorderSessionRegistry
} from "../ports/recorder-session-registry";

export interface RecorderExecutionGuard {
  isAutomationActive(tabId: number): Promise<boolean>;
}

export interface AutomationRecorderOptions {
  readonly clock?: () => string;
}

/** Owns the one-recorder-session-per-tab invariant. */
export class AutomationRecorder implements Recorder {
  readonly #pendingByTab = new Map<number, Promise<void>>();
  readonly #clock: () => string;

  constructor(
    readonly registry: RecorderSessionRegistry,
    readonly contentBridge: RecorderContentBridge,
    readonly documents: RecorderDocumentProvider,
    readonly executionGuard: RecorderExecutionGuard,
    options: AutomationRecorderOptions = {}
  ) {
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  async start(request: StartRecorderRequest): Promise<RecordingRecorderState> {
    return await this.#exclusive(request.tabId, async () => {
      const current = await this.registry.getByTabId(request.tabId);
      if (current?.session.state === "recording") {
        return current.session;
      }
      if (current?.session.state === "stopping") {
        throw new RecorderError(
          "session-conflict",
          `Recorder session in tab ${request.tabId} is still stopping.`,
          { context: { tabId: request.tabId } }
        );
      }
      if (await this.executionGuard.isAutomationActive(request.tabId)) {
        throw new RecorderError(
          "session-conflict",
          "Stop the automation in this tab before starting recording.",
          { context: { tabId: request.tabId, url: request.url } }
        );
      }

      const requestedUrl = parseSupportedUrl(request.url);
      if (requestedUrl === undefined) {
        throw unsupportedUrlError(request.tabId, request.url);
      }
      const document = await this.documents.getMainDocument(request.tabId);
      const documentUrl = parseSupportedUrl(document.url);
      if (
        documentUrl === undefined ||
        documentUrl.hostname !== requestedUrl.hostname ||
        documentUrl.protocol !== requestedUrl.protocol
      ) {
        throw new RecorderError(
          "context-changed",
          "The active tab changed before recording could start.",
          { context: { tabId: request.tabId, url: document.url } }
        );
      }

      const state: RecordingRecorderState = {
        sessionId: request.sessionId,
        tabId: request.tabId,
        context: {
          url: document.url,
          hostname: documentUrl.hostname,
          protocol: documentUrl.protocol === "https:" ? "https" : "http"
        },
        startedAt: this.#clock(),
        recordedEventCount: 0,
        state: "recording"
      };
      const record: RecorderSessionRecord = {
        session: state,
        documentId: document.documentId,
        currentUrl: document.url,
        recordedEvents: [],
        draftSteps: []
      };
      await this.registry.save(record);

      try {
        await this.contentBridge.startCapture({
          sessionId: state.sessionId,
          tabId: state.tabId,
          documentId: document.documentId,
          url: document.url
        });
      } catch (error) {
        const failure = isRecorderError(error)
          ? error
          : new RecorderError(
              "recorder-unavailable",
              "Unable to start recorder capture in the active tab.",
              { context: { tabId: request.tabId }, cause: error }
            );
        await this.registry.save({
          ...record,
          session: {
            sessionId: state.sessionId,
            tabId: state.tabId,
            context: state.context,
            startedAt: state.startedAt,
            recordedEventCount: 0,
            state: "failed",
            failedAt: this.#clock(),
            failure: { code: failure.code, message: failure.message }
          }
        });
        throw failure;
      }
      return state;
    });
  }

  async stop(request: StopRecorderRequest): Promise<RecorderRuntimeState> {
    return await this.#exclusive(request.tabId, async () => {
      const current = await this.registry.getByTabId(request.tabId);
      if (current === undefined) {
        return { state: "idle", tabId: request.tabId };
      }
      if (
        current.session.state === "stopped" ||
        current.session.state === "failed"
      ) {
        return current.session;
      }

      const stopping: RecorderSessionRecord = {
        ...current,
        session: {
          sessionId: current.session.sessionId,
          tabId: current.session.tabId,
          context: current.session.context,
          startedAt: current.session.startedAt,
          recordedEventCount: current.session.recordedEventCount,
          state: "stopping",
          stopReason: request.reason
        }
      };
      await this.registry.save(stopping);
      try {
        await this.contentBridge.stopCapture(request.tabId);
      } catch {
        // The page may disappear while Stop is being delivered.
      }

      const stopped: RecorderSessionRecord = {
        ...stopping,
        session: {
          sessionId: stopping.session.sessionId,
          tabId: stopping.session.tabId,
          context: stopping.session.context,
          startedAt: stopping.session.startedAt,
          recordedEventCount: stopping.session.recordedEventCount,
          state: "stopped",
          stopReason: request.reason,
          stoppedAt: this.#clock()
        }
      };
      await this.registry.save(stopped);
      return stopped.session;
    });
  }

  async getState(
    request: GetRecorderStateRequest
  ): Promise<RecorderRuntimeState> {
    const record = await this.registry.getByTabId(request.tabId);
    return record?.session ?? { state: "idle", tabId: request.tabId };
  }

  #exclusive<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
    const previous = this.#pendingByTab.get(tabId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const settled = result.then(
      () => undefined,
      () => undefined
    );
    this.#pendingByTab.set(tabId, settled);
    void settled.finally(() => {
      if (this.#pendingByTab.get(tabId) === settled) {
        this.#pendingByTab.delete(tabId);
      }
    });
    return result;
  }
}

function parseSupportedUrl(rawUrl: string): URL | undefined {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function unsupportedUrlError(tabId: number, url: string): RecorderError {
  return new RecorderError(
    "unsupported-url",
    "Recording is only available on HTTP or HTTPS pages.",
    { context: { tabId, url } }
  );
}
