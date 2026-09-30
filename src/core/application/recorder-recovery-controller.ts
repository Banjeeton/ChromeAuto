import type { RecorderContentBridge } from "../ports/recorder-content-bridge";
import type { RecorderDocumentProvider } from "../ports/recorder-document-provider";
import type {
  RecorderSessionRecord,
  RecorderSessionRegistry
} from "../ports/recorder-session-registry";
import type { RecorderStopReason } from "../domain/recorder-session";

export interface RecorderRecoveryResult {
  readonly restored: number;
  readonly finalized: number;
  readonly stopped: number;
}

/** Reconciles persisted recorder sessions when Manifest V3 recreates background. */
export class RecorderRecoveryController {
  #recovery?: Promise<RecorderRecoveryResult>;

  constructor(
    readonly registry: RecorderSessionRegistry,
    readonly contentBridge: RecorderContentBridge,
    readonly documents: RecorderDocumentProvider,
    readonly clock: () => string = () => new Date().toISOString()
  ) {}

  recover(): Promise<RecorderRecoveryResult> {
    if (this.#recovery !== undefined) return this.#recovery;
    const recovery = this.#reconcile();
    this.#recovery = recovery;
    void recovery.then(
      () => this.#release(recovery),
      () => this.#release(recovery)
    );
    return recovery;
  }

  async #reconcile(): Promise<RecorderRecoveryResult> {
    const records = await this.registry.list();
    let restored = 0;
    let finalized = 0;
    let stopped = 0;

    for (const record of records) {
      if (record.session.state === "stopping") {
        await this.#finalizeStopping(record, record.session.stopReason);
        finalized += 1;
        continue;
      }
      if (record.session.state !== "recording") continue;

      let document;
      try {
        document = await this.documents.getMainDocument(record.session.tabId);
      } catch {
        await this.registry.markTabClosed(record.session.tabId, this.clock());
        stopped += 1;
        continue;
      }

      if (!sameRecorderSite(record, document.url)) {
        await this.#stopForContextChange(record, document.documentId, document.url);
        stopped += 1;
        continue;
      }

      const current: RecorderSessionRecord = {
        ...record,
        documentId: document.documentId,
        currentUrl: document.url
      };
      await this.registry.save(current);
      try {
        await this.contentBridge.startCapture({
          sessionId: current.session.sessionId,
          tabId: current.session.tabId,
          documentId: current.documentId,
          url: current.currentUrl
        });
        restored += 1;
      } catch {
        await this.registry.save({
          ...current,
          session: {
            sessionId: current.session.sessionId,
            tabId: current.session.tabId,
            context: current.session.context,
            startedAt: current.session.startedAt,
            recordedEventCount: current.session.recordedEventCount,
            state: "failed",
            failedAt: this.clock(),
            failure: {
              code: "recorder-unavailable",
              message: "Recorder capture could not be restored. Reload the page and start recording again."
            }
          }
        });
      }
    }

    return Object.freeze({ restored, finalized, stopped });
  }

  async #finalizeStopping(
    record: RecorderSessionRecord,
    stopReason: RecorderStopReason
  ): Promise<void> {
    try {
      await this.contentBridge.stopCapture(record.session.tabId);
    } catch {
      // The document can disappear while the worker is suspended.
    }
    await this.registry.save({
      ...record,
      session: {
        sessionId: record.session.sessionId,
        tabId: record.session.tabId,
        context: record.session.context,
        startedAt: record.session.startedAt,
        recordedEventCount: record.session.recordedEventCount,
        state: "stopped",
        stopReason,
        stoppedAt: this.clock()
      }
    });
  }

  async #stopForContextChange(
    record: RecorderSessionRecord,
    documentId: string,
    currentUrl: string
  ): Promise<void> {
    await this.registry.save({
      ...record,
      documentId,
      currentUrl,
      session: {
        sessionId: record.session.sessionId,
        tabId: record.session.tabId,
        context: record.session.context,
        startedAt: record.session.startedAt,
        recordedEventCount: record.session.recordedEventCount,
        state: "stopped",
        stopReason: "tab-context-changed",
        stoppedAt: this.clock()
      }
    });
  }

  #release(recovery: Promise<RecorderRecoveryResult>): void {
    if (this.#recovery === recovery) this.#recovery = undefined;
  }
}

function sameRecorderSite(record: RecorderSessionRecord, rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.hostname === record.session.context.hostname &&
      url.protocol === `${record.session.context.protocol}:`
    );
  } catch {
    return false;
  }
}
