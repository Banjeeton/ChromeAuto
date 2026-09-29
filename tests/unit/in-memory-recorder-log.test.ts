import { describe, expect, it } from "vitest";

import { InMemoryRecorderLog } from "../../src/adapters/logging/in-memory-recorder-log";
import type { RecorderLogEntry } from "../../src/core/domain/recorder-log-entry";

describe("InMemoryRecorderLog", () => {
  it("bounds entries and supports tab and session queries", async () => {
    const log = new InMemoryRecorderLog(2);
    await log.append(entry("one", 1, "session-1"));
    await log.append(entry("two", 2, "session-2"));
    await log.append(entry("three", 1, "session-3"));

    await expect(log.list()).resolves.toMatchObject([
      { id: "two" },
      { id: "three" }
    ]);
    await expect(log.list({ tabId: 1 })).resolves.toMatchObject([
      { id: "three" }
    ]);
    await expect(log.list({ sessionId: "session-2" })).resolves.toMatchObject([
      { id: "two" }
    ]);
  });

  it("clones details and clears only matching entries", async () => {
    const log = new InMemoryRecorderLog();
    const source = entry("one", 1, "session-1", {
      details: { name: "Error", message: "Original" }
    });
    await log.append(source);
    await log.append(entry("two", 2, "session-2"));

    (source.details as { message: string }).message = "Changed";
    await expect(log.list({ tabId: 1 })).resolves.toMatchObject([
      { details: { message: "Original" } }
    ]);

    await log.clear({ tabId: 1 });
    await expect(log.list()).resolves.toMatchObject([{ id: "two" }]);
  });
});

function entry(
  id: string,
  tabId: number,
  sessionId: string,
  overrides: Partial<RecorderLogEntry> = {}
): RecorderLogEntry {
  return {
    id,
    recordedAt: "2026-09-29T16:00:00.000Z",
    tabId,
    sessionId,
    event: "started",
    action: "start recording",
    message: "Recording started.",
    ...overrides
  };
}
