import { describe, expect, it } from "vitest";

import { InMemoryExecutionLog } from "../../src/adapters/logging/in-memory-execution-log";
import type { StepLogEntry } from "../../src/core/domain/step-log-entry";

describe("InMemoryExecutionLog", () => {
  it("keeps only the configured number of newest entries", async () => {
    const log = new InMemoryExecutionLog({ maxEntries: 2 });

    await log.append(createEntry("log-1", "session-1", 11));
    await log.append(createEntry("log-2", "session-1", 11));
    await log.append(createEntry("log-3", "session-2", 22));

    expect((await log.list()).map((entry) => entry.id)).toEqual([
      "log-2",
      "log-3"
    ]);
  });

  it("filters and clears entries by runtime context", async () => {
    const log = new InMemoryExecutionLog();
    await log.append(createEntry("log-1", "session-1", 11));
    await log.append(createEntry("log-2", "session-2", 22));

    expect(await log.list({ tabId: 22 })).toEqual([
      expect.objectContaining({ id: "log-2" })
    ]);

    await log.clear({ sessionId: "session-1" });
    expect(await log.list()).toEqual([
      expect.objectContaining({ id: "log-2" })
    ]);
    await log.clear();
    expect(await log.list()).toEqual([]);
  });

  it("returns frozen entry and collection snapshots", async () => {
    const log = new InMemoryExecutionLog();
    await log.append(
      createEntry("log-1", "session-1", 11, {
        error: {
          code: "step-failed",
          name: "AutomationEngineError",
          message: "Failed",
          action: "reload",
          reason: "Failed",
          target: {
            primary: { type: "css", value: "body" },
            fallbacks: []
          }
        }
      })
    );

    const entries = await log.list();
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(entries[0])).toBe(true);
    expect(Object.isFrozen(entries[0].error)).toBe(true);
    expect(Object.isFrozen(entries[0].error?.target)).toBe(true);
    expect(Object.isFrozen(entries[0].error?.target?.primary)).toBe(true);
  });

  it("rejects an invalid capacity", () => {
    expect(() => new InMemoryExecutionLog({ maxEntries: 0 })).toThrow(
      "maxEntries must be a positive integer"
    );
  });
});

function createEntry(
  id: string,
  sessionId: string,
  tabId: number,
  overrides: Partial<StepLogEntry> = {}
): StepLogEntry {
  return {
    id,
    recordedAt: "2026-09-27T12:00:00.000Z",
    durationMs: 10,
    sessionId,
    presetId: "preset-1",
    tabId,
    stepId: "step-1",
    stepIndex: 0,
    stepNumber: 1,
    stepType: "reload",
    status: "succeeded",
    ...overrides
  };
}
