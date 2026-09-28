import type { AutomationStep } from "../domain/automation-step";
import { RecorderError } from "../domain/recorder-error";
import type { RecorderProtocol, RecorderState } from "../domain/recorder-session";
import {
  PresetValidationError,
  type PresetValidationIssue,
  validatePreset
} from "../domain/preset-validator";
import type { RecorderSessionRegistry } from "../ports/recorder-session-registry";
import type { RecorderSessionRecord } from "../ports/recorder-session-registry";

export interface RecorderDraftView {
  readonly tabId: number;
  readonly sessionId: string;
  readonly state: RecorderState;
  readonly hostname: string;
  readonly protocol: RecorderProtocol;
  readonly steps: readonly AutomationStep[];
}

export interface SaveRecorderDraftRequest {
  readonly tabId: number;
  readonly sessionId: string;
  readonly steps: unknown;
}

/** Edits recorder drafts without writing to the portable preset repository. */
export class RecorderDraftController {
  constructor(readonly registry: RecorderSessionRegistry) {}

  async get(tabId: number): Promise<RecorderDraftView | undefined> {
    const record = await this.registry.getByTabId(tabId);
    return record === undefined ? undefined : toView(record);
  }

  async save(request: SaveRecorderDraftRequest): Promise<RecorderDraftView> {
    const record = await this.#requireEditableRecord(
      request.tabId,
      request.sessionId
    );
    const issues = validateRecorderDraftSteps(
      request.steps,
      record.session.context.hostname,
      record.session.context.protocol
    );
    if (issues.length > 0) {
      throw new PresetValidationError(issues);
    }

    const updated = {
      ...record,
      draftSteps: structuredClone(request.steps) as AutomationStep[]
    };
    await this.registry.save(updated);
    return toView(updated);
  }

  async discard(tabId: number, sessionId: string): Promise<boolean> {
    await this.#requireEditableRecord(tabId, sessionId);
    return await this.registry.removeByTabId(tabId);
  }

  async #requireEditableRecord(tabId: number, sessionId: string) {
    const record = await this.registry.getByTabId(tabId);
    if (record === undefined || record.session.sessionId !== sessionId) {
      throw new RecorderError(
        "session-not-found",
        "The recorded draft no longer exists for this tab.",
        { context: { tabId, sessionId } }
      );
    }
    if (
      record.session.state !== "stopped" &&
      record.session.state !== "failed"
    ) {
      throw new RecorderError(
        "session-conflict",
        "Stop recording before editing or discarding its draft.",
        { context: { tabId, sessionId } }
      );
    }
    return record;
  }
}

export function validateRecorderDraftSteps(
  steps: unknown,
  hostname: string,
  protocol: RecorderProtocol
): PresetValidationIssue[] {
  return validatePreset({
    schemaVersion: 1,
    id: "00000000-0000-4000-8000-000000000000",
    name: "Recorded automation draft",
    createdAt: "2000-01-01T00:00:00.000Z",
    updatedAt: "2000-01-01T00:00:00.000Z",
    site: { hostname, protocols: [protocol] },
    automation: {
      defaults: {
        timeoutMs: 10_000,
        postActionDelayMs: 0,
        humanInput: { enabled: false, minDelayMs: 40, maxDelayMs: 120 }
      },
      steps
    },
    siteSettings: {
      enabled: true,
      repeat: { enabled: false, intervalMinutes: 1 }
    }
  });
}

function toView(record: RecorderSessionRecord): RecorderDraftView {
  return Object.freeze({
    tabId: record.session.tabId,
    sessionId: record.session.sessionId,
    state: record.session.state,
    hostname: record.session.context.hostname,
    protocol: record.session.context.protocol,
    steps: Object.freeze(structuredClone(record.draftSteps))
  });
}
