import { describe, expect, it } from "vitest";

import {
  ChromeRecorderSessionRegistry,
  type ChromeRecorderSessionStorageArea
} from "../../src/adapters/storage/chrome-recorder-session-registry";
import type { RecorderSessionRecord } from "../../src/core/ports/recorder-session-registry";
import { RecorderSessionRegistryAccessError } from "../../src/core/ports/recorder-session-registry";
import {
  PRESET_STORAGE_KEY,
  RECORDER_SESSION_STORAGE_KEY,
  REPEAT_CYCLE_STORAGE_KEY
} from "../../src/shared/constants";

describe("ChromeRecorderSessionRegistry", () => {
  it("stores the source context, state and draft steps for one tab", async () => {
    const storage = new MemorySessionStorage();
    const registry = new ChromeRecorderSessionRegistry(storage);
    const record = recordingRecord(12, "recorder-12");

    await registry.save(record);

    await expect(registry.getByTabId(12)).resolves.toEqual(record);
    await expect(registry.list()).resolves.toEqual([record]);
    expect(storage.values[RECORDER_SESSION_STORAGE_KEY]).toEqual([record]);
    expect(storage.values).not.toHaveProperty(PRESET_STORAGE_KEY);
    expect(storage.values).not.toHaveProperty(REPEAT_CYCLE_STORAGE_KEY);
  });

  it("serializes concurrent sessions without overwriting other tabs", async () => {
    const registry = new ChromeRecorderSessionRegistry(
      new MemorySessionStorage()
    );

    await Promise.all([
      registry.save(recordingRecord(1, "recorder-1")),
      registry.save(recordingRecord(2, "recorder-2")),
      registry.save(recordingRecord(3, "recorder-3"))
    ]);

    const records = await registry.list();
    expect(records.map((record) => record.session.tabId)).toEqual([1, 2, 3]);
    expect(records.map((record) => record.session.sessionId)).toEqual([
      "recorder-1",
      "recorder-2",
      "recorder-3"
    ]);
  });

  it("replaces one tab without changing the other sessions", async () => {
    const registry = new ChromeRecorderSessionRegistry(
      new MemorySessionStorage()
    );
    await registry.save(recordingRecord(4, "recorder-old"));
    const other = recordingRecord(5, "recorder-5");
    await registry.save(other);
    const replacement = recordingRecord(4, "recorder-new", 2);

    await registry.save(replacement);

    await expect(registry.list()).resolves.toEqual([replacement, other]);
  });

  it("restores an active session after the service worker is recreated", async () => {
    const storage = new MemorySessionStorage();
    const firstWorker = new ChromeRecorderSessionRegistry(storage);
    const record = recordingRecord(6, "recorder-6");
    await firstWorker.save(record);

    const recreatedWorker = new ChromeRecorderSessionRegistry(storage);

    await expect(recreatedWorker.getByTabId(6)).resolves.toEqual(record);
  });

  it("marks only the closed tab as stopped and preserves its draft", async () => {
    const registry = new ChromeRecorderSessionRegistry(
      new MemorySessionStorage()
    );
    const first = recordingRecord(7, "recorder-7");
    const second = recordingRecord(8, "recorder-8");
    await registry.save(first);
    await registry.save(second);

    const closed = await registry.markTabClosed(
      7,
      "2026-09-28T18:05:00.000Z"
    );

    expect(closed).toEqual({
      ...first,
      session: {
        ...first.session,
        state: "stopped",
        stopReason: "tab-closed",
        stoppedAt: "2026-09-28T18:05:00.000Z"
      }
    });
    await expect(registry.getByTabId(8)).resolves.toEqual(second);
    await expect(
      registry.markTabClosed(99, "2026-09-28T18:05:00.000Z")
    ).resolves.toBeUndefined();
  });

  it("removes stale session identities without deleting valid sessions", async () => {
    const registry = new ChromeRecorderSessionRegistry(
      new MemorySessionStorage()
    );
    await registry.save(recordingRecord(9, "recorder-9"));
    const valid = recordingRecord(10, "recorder-10");
    await registry.save(valid);

    await expect(
      registry.removeStale([{ tabId: 10, sessionId: "recorder-10" }])
    ).resolves.toBe(1);
    await expect(registry.list()).resolves.toEqual([valid]);
    await expect(
      registry.removeStale([{ tabId: 10, sessionId: "replaced-session" }])
    ).resolves.toBe(1);
    await expect(registry.list()).resolves.toEqual([]);
  });

  it("repairs malformed collections and duplicate tab entries", async () => {
    const storage = new MemorySessionStorage();
    const older = recordingRecord(11, "recorder-old");
    const newest = recordingRecord(11, "recorder-new", 2);
    storage.values[RECORDER_SESSION_STORAGE_KEY] = [
      older,
      { session: { tabId: "invalid" }, draftSteps: [] },
      newest,
      {
        ...recordingRecord(12, "recorder-invalid-step"),
        draftSteps: [{ id: "broken", type: "click" }]
      },
      { session: { ...recordingRecord(13, "idle").session, state: "idle" }, draftSteps: [] }
    ];
    const registry = new ChromeRecorderSessionRegistry(storage);

    await expect(registry.list()).resolves.toEqual([newest]);
    expect(storage.values[RECORDER_SESSION_STORAGE_KEY]).toEqual([newest]);
  });

  it("clears a non-array corrupted value without throwing", async () => {
    const storage = new MemorySessionStorage();
    storage.values[RECORDER_SESSION_STORAGE_KEY] = { broken: true };
    const registry = new ChromeRecorderSessionRegistry(storage);

    await expect(registry.list()).resolves.toEqual([]);
    expect(storage.values[RECORDER_SESSION_STORAGE_KEY]).toEqual([]);
  });

  it("rejects invalid records without changing stored data", async () => {
    const storage = new MemorySessionStorage();
    const registry = new ChromeRecorderSessionRegistry(storage);
    const invalid = {
      ...recordingRecord(14, "recorder-14"),
      draftSteps: [{ id: "broken", type: "click" }]
    } as unknown as RecorderSessionRecord;

    await expect(registry.save(invalid)).rejects.toThrow(
      "valid session state and preset v1 draft steps"
    );
    expect(storage.values).toEqual({});
  });

  it("returns deeply frozen snapshots detached from caller data", async () => {
    const registry = new ChromeRecorderSessionRegistry(
      new MemorySessionStorage()
    );
    const source = recordingRecord(15, "recorder-15");
    await registry.save(source);

    const records = await registry.list();
    const record = await registry.getByTabId(15);

    expect(Object.isFrozen(records)).toBe(true);
    expect(Object.isFrozen(records[0])).toBe(true);
    expect(Object.isFrozen(records[0].session.context)).toBe(true);
    expect(Object.isFrozen(records[0].recordedEvents)).toBe(true);
    expect(Object.isFrozen(records[0].recordedEvents[0])).toBe(true);
    expect(Object.isFrozen(records[0].draftSteps)).toBe(true);
    expect(Object.isFrozen(records[0].draftSteps[0])).toBe(true);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("supports removing one tab and clearing all sessions", async () => {
    const registry = new ChromeRecorderSessionRegistry(
      new MemorySessionStorage()
    );
    await registry.save(recordingRecord(16, "recorder-16"));
    await registry.save(recordingRecord(17, "recorder-17"));

    await expect(registry.removeByTabId(16)).resolves.toBe(true);
    await expect(registry.removeByTabId(16)).resolves.toBe(false);
    await expect(registry.clear()).resolves.toBe(1);
    await expect(registry.clear()).resolves.toBe(0);
  });

  it("wraps storage read and write failures", async () => {
    const readCause = new Error("session storage read failed");
    const readStorage = new MemorySessionStorage();
    readStorage.getError = readCause;

    await expect(
      new ChromeRecorderSessionRegistry(readStorage).list()
    ).rejects.toMatchObject({
      name: "RecorderSessionRegistryAccessError",
      operation: "read",
      cause: readCause
    } satisfies Partial<RecorderSessionRegistryAccessError>);

    const writeCause = new Error("session storage write failed");
    const writeStorage = new MemorySessionStorage();
    writeStorage.setError = writeCause;

    await expect(
      new ChromeRecorderSessionRegistry(writeStorage).save(
        recordingRecord(18, "recorder-18")
      )
    ).rejects.toMatchObject({
      name: "RecorderSessionRegistryAccessError",
      operation: "write",
      cause: writeCause
    } satisfies Partial<RecorderSessionRegistryAccessError>);
  });
});

class MemorySessionStorage implements ChromeRecorderSessionStorageArea {
  readonly values: Record<string, unknown> = {};
  getError?: Error;
  setError?: Error;

  async get(key: string): Promise<Record<string, unknown>> {
    if (this.getError !== undefined) {
      throw this.getError;
    }
    return key in this.values ? { [key]: structuredClone(this.values[key]) } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    if (this.setError !== undefined) {
      throw this.setError;
    }
    Object.assign(this.values, structuredClone(items));
  }
}

function recordingRecord(
  tabId: number,
  sessionId: string,
  stepCount = 1
): RecorderSessionRecord {
  return {
    session: {
      sessionId,
      tabId,
      context: {
        url: `https://example.com/form?tab=${tabId}`,
        hostname: "example.com",
        protocol: "https"
      },
      startedAt: "2026-09-28T18:00:00.000Z",
      recordedEventCount: stepCount,
      state: "recording"
    },
    documentId: `document-${tabId}`,
    currentUrl: `https://example.com/form?tab=${tabId}`,
    recordedEvents: Array.from({ length: stepCount }, (_, index) => ({
      version: 1 as const,
      eventId: `event-${tabId}-${index + 1}`,
      sessionId,
      tabId,
      documentId: `document-${tabId}`,
      occurredAt: `2026-09-28T18:00:0${index}.000Z`,
      url: `https://example.com/form?tab=${tabId}`,
      kind: "click" as const,
      target: {
        locators: [
          { type: "css" as const, value: "button[type='submit']" }
        ]
      },
      payload: { button: "left" as const, clickCount: 1, modifiers: [] }
    })),
    draftSteps: Array.from({ length: stepCount }, (_, index) => ({
      id: `click-${tabId}-${index + 1}`,
      type: "click" as const,
      name: `Click ${index + 1}`,
      enabled: true,
      target: {
        primary: { type: "css" as const, value: "button[type='submit']" },
        fallbacks: []
      },
      button: "left" as const,
      clickCount: 1
    }))
  };
}
