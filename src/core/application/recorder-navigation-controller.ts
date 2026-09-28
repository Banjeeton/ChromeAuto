import { RecordedStepMapper } from "./recorded-step-mapper";
import type { AutomationStep } from "../domain/automation-step";
import type {
  RecorderEvent,
  RecorderPageReadyEvent,
  RecorderReloadEvent
} from "../domain/recorder-event";
import type { RecorderContentBridge } from "../ports/recorder-content-bridge";
import type {
  RecorderSessionRecord,
  RecorderSessionRegistry
} from "../ports/recorder-session-registry";

export interface RecorderNavigationEvent {
  readonly tabId: number;
  readonly url: string;
  readonly documentId: string;
  readonly navigationId: string;
}

export interface RecorderNavigationCommittedEvent
  extends RecorderNavigationEvent {
  readonly transitionType: string;
}

export interface RecorderNavigationControllerOptions {
  readonly clock?: () => string;
  readonly createEventId?: () => string;
}

export type RecorderEventDisposition = "recorded" | "duplicate" | "ignored";

/**
 * Serializes recorder events and Chrome navigation signals per tab.
 * Runtime events stay in session storage and are mapped into portable steps.
 */
export class RecorderNavigationController {
  readonly #pendingByTab = new Map<number, Promise<void>>();
  readonly #clock: () => string;
  readonly #createEventId: () => string;

  constructor(
    readonly registry: RecorderSessionRegistry,
    readonly mapper: RecordedStepMapper,
    readonly contentBridge: RecorderContentBridge,
    options: RecorderNavigationControllerOptions = {}
  ) {
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#createEventId = options.createEventId ?? (() => crypto.randomUUID());
  }

  async record(event: RecorderEvent): Promise<RecorderEventDisposition> {
    return await this.#exclusive(event.tabId, async () => {
      const record = await this.registry.getByTabId(event.tabId);
      if (!acceptsContentEvent(record, event)) {
        return "ignored";
      }
      if (record.recordedEvents.some(({ eventId }) => eventId === event.eventId)) {
        return "duplicate";
      }
      await this.#append(record, event);
      return "recorded";
    });
  }

  async handleNavigationCommitted(
    event: RecorderNavigationCommittedEvent
  ): Promise<RecorderEventDisposition> {
    return await this.#exclusive(event.tabId, async () => {
      const record = await this.registry.getByTabId(event.tabId);
      if (record?.session.state !== "recording") {
        return "ignored";
      }
      if (!matchesSourceContext(record, event.url)) {
        await this.#stopForContextChange(record);
        return "recorded";
      }

      const moved: RecorderSessionRecord = {
        ...record,
        documentId: event.documentId,
        currentUrl: event.url
      };
      if (event.transitionType !== "reload") {
        await this.registry.save(moved);
        return "recorded";
      }

      const duplicate = moved.recordedEvents.some(
        (candidate) =>
          candidate.kind === "reload" &&
          candidate.payload.navigationId === event.navigationId
      );
      if (duplicate) {
        if (
          moved.documentId !== record.documentId ||
          moved.currentUrl !== record.currentUrl
        ) {
          await this.registry.save(moved);
        }
        return "duplicate";
      }

      const reload: RecorderReloadEvent = {
        ...this.#navigationEventBase(moved, event, "reload"),
        payload: {
          navigationId: event.navigationId,
          waitUntil: "domcontentloaded"
        }
      };
      await this.#append(moved, reload);
      return "recorded";
    });
  }

  async handlePageReady(
    event: RecorderNavigationEvent
  ): Promise<RecorderEventDisposition> {
    return await this.#exclusive(event.tabId, async () => {
      const record = await this.registry.getByTabId(event.tabId);
      if (record?.session.state !== "recording") {
        return "ignored";
      }
      if (!matchesSourceContext(record, event.url)) {
        await this.#stopForContextChange(record);
        return "recorded";
      }

      let current: RecorderSessionRecord = {
        ...record,
        documentId: event.documentId,
        currentUrl: event.url
      };
      const duplicate = current.recordedEvents.some(
        (candidate) =>
          candidate.kind === "pageReady" &&
          candidate.payload.navigationId === event.navigationId &&
          candidate.payload.state === "domcontentloaded"
      );
      if (!duplicate) {
        const pageReady: RecorderPageReadyEvent = {
          ...this.#navigationEventBase(current, event, "pageReady"),
          payload: {
            navigationId: event.navigationId,
            state: "domcontentloaded"
          }
        };
        current = await this.#append(current, pageReady);
      } else if (
        current.documentId !== record.documentId ||
        current.currentUrl !== record.currentUrl
      ) {
        await this.registry.save(current);
      }

      await this.contentBridge.startCapture({
        sessionId: current.session.sessionId,
        tabId: current.session.tabId,
        documentId: current.documentId,
        url: current.currentUrl
      });
      return duplicate ? "duplicate" : "recorded";
    });
  }

  async handleTabRemoved(tabId: number): Promise<void> {
    await this.#exclusive(tabId, async () => {
      await this.registry.markTabClosed(tabId, this.#clock());
    });
  }

  async #append(
    record: RecorderSessionRecord,
    event: RecorderEvent
  ): Promise<RecorderSessionRecord> {
    const recordedEvents = [...record.recordedEvents, event];
    const mapped = this.mapper.map(recordedEvents);
    const draftSteps = preserveExistingStepIds(record.draftSteps, mapped.steps);
    const updated: RecorderSessionRecord = {
      ...record,
      session: {
        ...record.session,
        recordedEventCount: recordedEvents.length
      },
      recordedEvents,
      draftSteps
    };
    await this.registry.save(updated);
    return updated;
  }

  async #stopForContextChange(record: RecorderSessionRecord): Promise<void> {
    const stopped: RecorderSessionRecord = {
      ...record,
      session: {
        sessionId: record.session.sessionId,
        tabId: record.session.tabId,
        context: record.session.context,
        startedAt: record.session.startedAt,
        recordedEventCount: record.session.recordedEventCount,
        state: "stopped",
        stopReason: "tab-context-changed",
        stoppedAt: this.#clock()
      }
    };
    await this.registry.save(stopped);
    try {
      await this.contentBridge.stopCapture(record.session.tabId);
    } catch {
      // Navigation may already have destroyed the old content script.
    }
  }

  #navigationEventBase<K extends "reload" | "pageReady">(
    record: RecorderSessionRecord,
    event: RecorderNavigationEvent,
    kind: K
  ) {
    return {
      version: 1 as const,
      eventId: this.#createEventId(),
      sessionId: record.session.sessionId,
      tabId: event.tabId,
      documentId: event.documentId,
      occurredAt: this.#clock(),
      url: event.url,
      kind
    };
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

function acceptsContentEvent(
  record: RecorderSessionRecord | undefined,
  event: RecorderEvent
): record is RecorderSessionRecord {
  return (
    record?.session.state === "recording" &&
    record.session.sessionId === event.sessionId &&
    record.session.tabId === event.tabId &&
    record.documentId === event.documentId &&
    matchesSourceContext(record, event.url)
  );
}

function matchesSourceContext(
  record: RecorderSessionRecord,
  rawUrl: string
): boolean {
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

function preserveExistingStepIds(
  existing: readonly AutomationStep[],
  mapped: readonly AutomationStep[]
): readonly AutomationStep[] {
  return mapped.map((step, index) => {
    const previous = existing[index];
    return previous === undefined ? step : { ...step, id: previous.id };
  });
}
