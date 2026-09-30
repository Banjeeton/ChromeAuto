import { describe, expect, it, vi } from "vitest";

import {
  ChromeRuntimeRequestJournal,
  type RuntimeRequestStorageArea
} from "../../src/adapters/storage/chrome-runtime-request-journal";

describe("ChromeRuntimeRequestJournal", () => {
  it("coalesces concurrent duplicate control commands", async () => {
    const journal = new ChromeRuntimeRequestJournal(new MemoryStorage());
    const operation = vi.fn(async () => ({ stopped: true }));

    const [first, duplicate] = await Promise.all([
      journal.execute("request-1", "stop", operation),
      journal.execute("request-1", "stop", operation)
    ]);

    expect(first).toEqual({ stopped: true });
    expect(duplicate).toEqual(first);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("returns a completed result after service-worker recreation", async () => {
    const storage = new MemoryStorage();
    const firstWorker = new ChromeRuntimeRequestJournal(storage);
    await firstWorker.execute("request-2", "record", async () => ({ state: "recording" }));

    const secondWorker = new ChromeRuntimeRequestJournal(storage);
    const duplicate = vi.fn(async () => ({ state: "duplicate" }));

    await expect(
      secondWorker.execute("request-2", "record", duplicate)
    ).resolves.toEqual({ state: "recording" });
    expect(duplicate).not.toHaveBeenCalled();
  });

  it("repairs corrupt persisted entries and bounds completed history", async () => {
    const storage = new MemoryStorage();
    storage.values.requests = [{ invalid: true }];
    const journal = new ChromeRuntimeRequestJournal(storage, "requests", 2);

    for (const id of ["one", "two", "three"]) {
      await journal.execute(id, "stop", async () => id);
    }

    expect(storage.values.requests).toMatchObject([
      { requestId: "two" },
      { requestId: "three" }
    ]);
  });
});

class MemoryStorage implements RuntimeRequestStorageArea {
  readonly values: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.values ? { [key]: structuredClone(this.values[key]) } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
  }
}
