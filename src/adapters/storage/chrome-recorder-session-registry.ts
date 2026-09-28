import type { AutomationStep } from "../../core/domain/automation-step";
import type { RecorderEvent } from "../../core/domain/recorder-event";
import { RECORDER_ERROR_CODES } from "../../core/domain/recorder-error";
import type {
  RecorderSessionIdentity,
  RecorderSessionState,
  RecorderStopReason
} from "../../core/domain/recorder-session";
import { validatePreset } from "../../core/domain/preset-validator";
import {
  type RecorderSessionRecord,
  type RecorderSessionRegistry,
  RecorderSessionRegistryAccessError
} from "../../core/ports/recorder-session-registry";
import { RECORDER_SESSION_STORAGE_KEY } from "../../shared/constants";
import {
  RECORDER_EVENT_MESSAGE,
  isRecorderEventMessage
} from "../../shared/types/recorder-runtime";

export interface ChromeRecorderSessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Stores non-portable recorder sessions separately from preset storage. */
export class ChromeRecorderSessionRegistry
  implements RecorderSessionRegistry
{
  readonly #storage: ChromeRecorderSessionStorageArea;
  readonly #storageKey: string;
  #pendingOperation: Promise<void> = Promise.resolve();

  constructor(
    storage: ChromeRecorderSessionStorageArea = chrome.storage.session,
    storageKey = RECORDER_SESSION_STORAGE_KEY
  ) {
    this.#storage = storage;
    this.#storageKey = storageKey;
  }

  async list(): Promise<readonly RecorderSessionRecord[]> {
    return await this.#runExclusive(async () => {
      const records = await this.#readAndRepair();
      return freezeRecords(records);
    });
  }

  async getByTabId(
    tabId: number
  ): Promise<RecorderSessionRecord | undefined> {
    assertTabId(tabId);
    return await this.#runExclusive(async () => {
      const record = (await this.#readAndRepair()).find(
        (candidate) => candidate.session.tabId === tabId
      );
      return record === undefined ? undefined : freezeRecord(record);
    });
  }

  async save(record: RecorderSessionRecord): Promise<void> {
    assertRecorderSessionRecord(record);
    const detached = structuredClone(record);

    await this.#runExclusive(async () => {
      const records = await this.#readAndRepair();
      const existingIndex = records.findIndex(
        (candidate) => candidate.session.tabId === detached.session.tabId
      );
      if (existingIndex === -1) {
        records.push(detached);
      } else {
        records[existingIndex] = detached;
      }
      await this.#write(records);
    });
  }

  async markTabClosed(
    tabId: number,
    stoppedAt: string
  ): Promise<RecorderSessionRecord | undefined> {
    assertTabId(tabId);
    assertIsoTimestamp(stoppedAt, "stoppedAt");

    return await this.#runExclusive(async () => {
      const records = await this.#readAndRepair();
      const index = records.findIndex(
        (candidate) => candidate.session.tabId === tabId
      );
      if (index === -1) {
        return undefined;
      }

      const current = records[index];
      if (
        current.session.state === "recording" ||
        current.session.state === "stopping"
      ) {
        records[index] = {
          session: {
            sessionId: current.session.sessionId,
            tabId: current.session.tabId,
            context: current.session.context,
            startedAt: current.session.startedAt,
            recordedEventCount: current.session.recordedEventCount,
            state: "stopped",
            stopReason: "tab-closed",
            stoppedAt
          },
          documentId: current.documentId,
          currentUrl: current.currentUrl,
          recordedEvents: current.recordedEvents,
          draftSteps: current.draftSteps
        };
        await this.#write(records);
      }

      return freezeRecord(records[index]);
    });
  }

  async removeByTabId(tabId: number): Promise<boolean> {
    assertTabId(tabId);
    return await this.#runExclusive(async () => {
      const records = await this.#readAndRepair();
      const remaining = records.filter(
        (record) => record.session.tabId !== tabId
      );
      if (remaining.length === records.length) {
        return false;
      }
      await this.#write(remaining);
      return true;
    });
  }

  async removeStale(
    validSessions: readonly RecorderSessionIdentity[]
  ): Promise<number> {
    validSessions.forEach(assertRecorderSessionIdentity);
    const validKeys = new Set(validSessions.map(recorderSessionIdentityKey));

    return await this.#runExclusive(async () => {
      const records = await this.#readAndRepair();
      const remaining = records.filter((record) =>
        validKeys.has(recorderSessionIdentityKey(record.session))
      );
      const removedCount = records.length - remaining.length;
      if (removedCount > 0) {
        await this.#write(remaining);
      }
      return removedCount;
    });
  }

  async clear(): Promise<number> {
    return await this.#runExclusive(async () => {
      const records = await this.#readAndRepair();
      if (records.length > 0) {
        await this.#write([]);
      }
      return records.length;
    });
  }

  async #readAndRepair(): Promise<RecorderSessionRecord[]> {
    let stored: Record<string, unknown>;
    try {
      stored = await this.#storage.get(this.#storageKey);
    } catch (error) {
      throw new RecorderSessionRegistryAccessError("read", error);
    }

    const decoded = decodeRecorderSessionCollection(stored[this.#storageKey]);
    if (decoded.needsRepair) {
      await this.#write(decoded.records);
    }
    return decoded.records;
  }

  async #write(records: readonly RecorderSessionRecord[]): Promise<void> {
    try {
      await this.#storage.set({
        [this.#storageKey]: structuredClone(records)
      });
    } catch (error) {
      throw new RecorderSessionRegistryAccessError("write", error);
    }
  }

  #runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pendingOperation.then(operation, operation);
    this.#pendingOperation = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

type DecodedRecorderSessions = {
  records: RecorderSessionRecord[];
  needsRepair: boolean;
};

function decodeRecorderSessionCollection(
  value: unknown
): DecodedRecorderSessions {
  if (value === undefined) {
    return { records: [], needsRepair: false };
  }
  if (!Array.isArray(value)) {
    return { records: [], needsRepair: true };
  }

  const byTabId = new Map<number, RecorderSessionRecord>();
  let needsRepair = false;
  for (const candidate of value) {
    if (!isRecorderSessionRecord(candidate)) {
      needsRepair = true;
      continue;
    }
    if (byTabId.has(candidate.session.tabId)) {
      needsRepair = true;
    }
    byTabId.set(candidate.session.tabId, structuredClone(candidate));
  }

  return { records: [...byTabId.values()], needsRepair };
}

function isRecorderSessionRecord(
  value: unknown
): value is RecorderSessionRecord {
  if (
    !hasOnlyKeys(value, [
      "session",
      "documentId",
      "currentUrl",
      "recordedEvents",
      "draftSteps"
    ])
  ) {
    return false;
  }
  return (
    isRecorderSessionState(value.session) &&
    isNonEmptyString(value.documentId) &&
    isRecorderUrl(value.currentUrl) &&
    isRecorderEvents(value.recordedEvents, value.session) &&
    isValidDraftSteps(value.draftSteps)
  );
}

function assertRecorderSessionRecord(record: RecorderSessionRecord): void {
  if (!isRecorderSessionRecord(record)) {
    throw new TypeError(
      "Recorder record must contain a valid session state and preset v1 draft steps."
    );
  }
}

function isRecorderSessionState(value: unknown): value is RecorderSessionState {
  if (!isObject(value) || typeof value.state !== "string") {
    return false;
  }

  const commonKeys = [
    "sessionId",
    "tabId",
    "context",
    "startedAt",
    "recordedEventCount",
    "state"
  ];
  if (
    typeof value.sessionId !== "string" ||
    value.sessionId.trim().length === 0 ||
    !isTabId(value.tabId) ||
    !isRecorderSourceContext(value.context) ||
    !isIsoTimestamp(value.startedAt) ||
    !isNonNegativeInteger(value.recordedEventCount)
  ) {
    return false;
  }

  switch (value.state) {
    case "recording":
      return hasOnlyKeys(value, commonKeys);
    case "stopping":
      return (
        hasOnlyKeys(value, [...commonKeys, "stopReason"]) &&
        isRecorderStopReason(value.stopReason)
      );
    case "stopped":
      return (
        hasOnlyKeys(value, [...commonKeys, "stopReason", "stoppedAt"]) &&
        isRecorderStopReason(value.stopReason) &&
        isIsoTimestamp(value.stoppedAt)
      );
    case "failed":
      return (
        hasOnlyKeys(value, [...commonKeys, "failedAt", "failure"]) &&
        isIsoTimestamp(value.failedAt) &&
        isRecorderFailure(value.failure)
      );
    default:
      return false;
  }
}

function isRecorderSourceContext(value: unknown): boolean {
  if (!hasOnlyKeys(value, ["url", "hostname", "protocol"])) {
    return false;
  }
  if (
    typeof value.url !== "string" ||
    typeof value.hostname !== "string" ||
    (value.protocol !== "http" && value.protocol !== "https")
  ) {
    return false;
  }

  try {
    const parsed = new URL(value.url);
    return (
      parsed.hostname === value.hostname &&
      parsed.protocol === `${value.protocol}:`
    );
  } catch {
    return false;
  }
}

function isRecorderFailure(value: unknown): boolean {
  return (
    hasOnlyKeys(value, ["code", "message"]) &&
    typeof value.code === "string" &&
    RECORDER_ERROR_CODES.some((code) => code === value.code) &&
    typeof value.message === "string" &&
    value.message.trim().length > 0
  );
}

function isValidDraftSteps(value: unknown): value is AutomationStep[] {
  if (!Array.isArray(value)) {
    return false;
  }

  return (
    validatePreset({
      schemaVersion: 1,
      id: "00000000-0000-4000-8000-000000000000",
      name: "Recorder draft validation",
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2000-01-01T00:00:00.000Z",
      site: { hostname: "example.com", protocols: ["https"] },
      automation: {
        defaults: {
          timeoutMs: 1,
          postActionDelayMs: 0,
          humanInput: { enabled: false, minDelayMs: 0, maxDelayMs: 0 }
        },
        steps: value
      },
      siteSettings: {
        enabled: true,
        repeat: { enabled: false, intervalMinutes: 1 }
      }
    }).length === 0
  );
}

function isRecorderEvents(
  value: unknown,
  session: RecorderSessionState
): value is RecorderEvent[] {
  if (!Array.isArray(value)) {
    return false;
  }

  const eventIds = new Set<string>();
  for (const event of value) {
    if (
      !isRecorderEventMessage({ type: RECORDER_EVENT_MESSAGE, event }) ||
      event.sessionId !== session.sessionId ||
      event.tabId !== session.tabId ||
      eventIds.has(event.eventId)
    ) {
      return false;
    }
    eventIds.add(event.eventId);
  }
  return session.recordedEventCount === value.length;
}

function isRecorderUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function assertRecorderSessionIdentity(
  identity: RecorderSessionIdentity
): void {
  assertTabId(identity.tabId);
  if (identity.sessionId.trim().length === 0) {
    throw new TypeError("sessionId must be a non-empty string.");
  }
}

function assertTabId(tabId: number): void {
  if (!isTabId(tabId)) {
    throw new RangeError("tabId must be a non-negative integer.");
  }
}

function assertIsoTimestamp(value: string, name: string): void {
  if (!isIsoTimestamp(value)) {
    throw new TypeError(`${name} must be a valid timestamp.`);
  }
}

function isRecorderStopReason(value: unknown): value is RecorderStopReason {
  return (
    value === "user" ||
    value === "tab-context-changed" ||
    value === "tab-closed"
  );
}

function isTabId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function recorderSessionIdentityKey(identity: RecorderSessionIdentity): string {
  return `${identity.tabId}\u0000${identity.sessionId}`;
}

function freezeRecords(
  records: readonly RecorderSessionRecord[]
): readonly RecorderSessionRecord[] {
  return deepFreeze(records.map((record) => structuredClone(record)));
}

function freezeRecord(record: RecorderSessionRecord): RecorderSessionRecord {
  return deepFreeze(structuredClone(record));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

function hasOnlyKeys(
  value: unknown,
  allowedKeys: readonly string[]
): value is Record<string, unknown> {
  return (
    isObject(value) &&
    Object.keys(value).every((key) => allowedKeys.includes(key)) &&
    allowedKeys.every((key) => key in value)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
