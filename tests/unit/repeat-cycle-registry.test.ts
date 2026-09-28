import { describe, expect, it } from "vitest";

import {
  ChromeRepeatCycleRegistry,
  type ChromeSessionStorageArea
} from "../../src/adapters/storage/chrome-repeat-cycle-registry";
import type { RepeatCycleRuntimeState } from "../../src/core/domain/repeat-cycle";
import { RepeatCycleRegistryAccessError } from "../../src/core/ports/repeat-cycle-registry";
import {
  PRESET_STORAGE_KEY,
  REPEAT_CYCLE_STORAGE_KEY
} from "../../src/shared/constants";

const PRESET_ID = "550e8400-e29b-41d4-a716-446655440000";
const SECOND_PRESET_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("ChromeRepeatCycleRegistry", () => {
  it("saves tab, preset, state and the next run time", async () => {
    const storage = new MemorySessionStorage();
    const registry = new ChromeRepeatCycleRegistry(storage);
    const state = waitingState(12, PRESET_ID, 1_800_000_000_000);

    await registry.save(state);

    await expect(registry.getByTabId(12)).resolves.toEqual(state);
    await expect(registry.list()).resolves.toEqual([state]);
    expect(storage.values[REPEAT_CYCLE_STORAGE_KEY]).toEqual([state]);
  });

  it("serializes concurrent updates without overwriting other tabs", async () => {
    const registry = new ChromeRepeatCycleRegistry(new MemorySessionStorage());

    await Promise.all([
      registry.save(waitingState(1, PRESET_ID, 1_000)),
      registry.save({ tabId: 2, presetId: PRESET_ID, state: "running" }),
      registry.save({ tabId: 3, presetId: SECOND_PRESET_ID, state: "failed" })
    ]);

    await expect(registry.list()).resolves.toEqual([
      waitingState(1, PRESET_ID, 1_000),
      { tabId: 2, presetId: PRESET_ID, state: "running" },
      { tabId: 3, presetId: SECOND_PRESET_ID, state: "failed" }
    ]);
  });

  it("replaces the state for one tab without changing other tabs", async () => {
    const registry = new ChromeRepeatCycleRegistry(new MemorySessionStorage());
    await registry.save({ tabId: 4, presetId: PRESET_ID, state: "running" });
    await registry.save({
      tabId: 5,
      presetId: SECOND_PRESET_ID,
      state: "running"
    });

    await registry.save(waitingState(4, PRESET_ID, 9_000));

    await expect(registry.list()).resolves.toEqual([
      waitingState(4, PRESET_ID, 9_000),
      { tabId: 5, presetId: SECOND_PRESET_ID, state: "running" }
    ]);
  });

  it("keeps runtime state separate from portable preset storage", async () => {
    const storage = new MemorySessionStorage();
    const registry = new ChromeRepeatCycleRegistry(storage);

    await registry.save({ tabId: 6, presetId: PRESET_ID, state: "idle" });

    expect(REPEAT_CYCLE_STORAGE_KEY).not.toBe(PRESET_STORAGE_KEY);
    expect(storage.values).toHaveProperty(REPEAT_CYCLE_STORAGE_KEY);
    expect(storage.values).not.toHaveProperty(PRESET_STORAGE_KEY);
  });

  it("removes states that no longer match a valid tab and preset pair", async () => {
    const registry = new ChromeRepeatCycleRegistry(new MemorySessionStorage());
    await registry.save(waitingState(7, PRESET_ID, 7_000));
    await registry.save({
      tabId: 8,
      presetId: SECOND_PRESET_ID,
      state: "stopped"
    });

    await expect(
      registry.removeStale([{ tabId: 7, presetId: PRESET_ID }])
    ).resolves.toBe(1);
    await expect(registry.list()).resolves.toEqual([
      waitingState(7, PRESET_ID, 7_000)
    ]);
    await expect(
      registry.removeStale([{ tabId: 7, presetId: SECOND_PRESET_ID }])
    ).resolves.toBe(1);
    await expect(registry.list()).resolves.toEqual([]);
  });

  it("repairs malformed collections and duplicate tab entries", async () => {
    const storage = new MemorySessionStorage();
    storage.values[REPEAT_CYCLE_STORAGE_KEY] = [
      waitingState(9, PRESET_ID, 9_000),
      { tabId: "invalid", presetId: PRESET_ID, state: "running" },
      { tabId: 10, presetId: PRESET_ID, state: "waiting" },
      { tabId: 9, presetId: PRESET_ID, state: "running" },
      { tabId: 11, presetId: PRESET_ID, state: "unknown" }
    ];
    const registry = new ChromeRepeatCycleRegistry(storage);

    await expect(registry.list()).resolves.toEqual([
      { tabId: 9, presetId: PRESET_ID, state: "running" }
    ]);
    expect(storage.values[REPEAT_CYCLE_STORAGE_KEY]).toEqual([
      { tabId: 9, presetId: PRESET_ID, state: "running" }
    ]);
  });

  it("clears a non-array corrupted value without throwing", async () => {
    const storage = new MemorySessionStorage();
    storage.values[REPEAT_CYCLE_STORAGE_KEY] = { broken: true };
    const registry = new ChromeRepeatCycleRegistry(storage);

    await expect(registry.list()).resolves.toEqual([]);
    expect(storage.values[REPEAT_CYCLE_STORAGE_KEY]).toEqual([]);
  });

  it("rejects invalid states without changing stored data", async () => {
    const storage = new MemorySessionStorage();
    const registry = new ChromeRepeatCycleRegistry(storage);

    await expect(
      registry.save({
        tabId: 12,
        presetId: PRESET_ID,
        state: "waiting"
      })
    ).rejects.toThrow("waiting nextRunAt");
    expect(storage.values).toEqual({});
  });

  it("returns detached immutable snapshots", async () => {
    const registry = new ChromeRepeatCycleRegistry(new MemorySessionStorage());
    await registry.save(waitingState(13, PRESET_ID, 13_000));

    const states = await registry.list();
    const state = await registry.getByTabId(13);

    expect(Object.isFrozen(states)).toBe(true);
    expect(Object.isFrozen(states[0])).toBe(true);
    expect(Object.isFrozen(state)).toBe(true);
  });

  it("supports removing one tab and clearing all runtime states", async () => {
    const registry = new ChromeRepeatCycleRegistry(new MemorySessionStorage());
    await registry.save({ tabId: 14, presetId: PRESET_ID, state: "running" });
    await registry.save({ tabId: 15, presetId: PRESET_ID, state: "stopped" });

    await expect(registry.removeByTabId(14)).resolves.toBe(true);
    await expect(registry.removeByTabId(14)).resolves.toBe(false);
    await expect(registry.clear()).resolves.toBe(1);
    await expect(registry.clear()).resolves.toBe(0);
  });

  it("wraps storage access failures", async () => {
    const cause = new Error("session storage unavailable");
    const storage = new MemorySessionStorage();
    storage.getError = cause;

    await expect(
      new ChromeRepeatCycleRegistry(storage).list()
    ).rejects.toMatchObject({
      name: "RepeatCycleRegistryAccessError",
      operation: "read",
      cause
    } satisfies Partial<RepeatCycleRegistryAccessError>);
  });
});

class MemorySessionStorage implements ChromeSessionStorageArea {
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

function waitingState(
  tabId: number,
  presetId: string,
  nextRunAt: number
): RepeatCycleRuntimeState {
  return { tabId, presetId, state: "waiting", nextRunAt };
}
