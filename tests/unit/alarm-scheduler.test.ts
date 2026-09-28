import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ChromeAlarmScheduler,
  createCycleAlarmName,
  parseCycleAlarmName,
  type ChromeAlarmRecord,
  type ChromeAlarmsApi
} from "../../src/adapters/chrome/alarm-scheduler";
import {
  CycleSchedulerError,
  type CycleScheduler,
  type CycleTimerIdentity,
  type ScheduledCycleTimer,
  type ScheduleCycleTimerRequest
} from "../../src/core/ports/cycle-scheduler";

const PRESET_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("CycleScheduler port", () => {
  it("defines a browser-independent one-shot timer boundary", () => {
    expectTypeOf<CycleScheduler["schedule"]>().toEqualTypeOf<
      (request: ScheduleCycleTimerRequest) => Promise<void>
    >();
    expectTypeOf<CycleScheduler["get"]>().toEqualTypeOf<
      (
        identity: CycleTimerIdentity
      ) => Promise<ScheduledCycleTimer | undefined>
    >();
    expectTypeOf<CycleScheduler["list"]>().toEqualTypeOf<
      () => Promise<readonly ScheduledCycleTimer[]>
    >();
    expectTypeOf<CycleScheduler["cancel"]>().toEqualTypeOf<
      (identity: CycleTimerIdentity) => Promise<boolean>
    >();
  });
});

describe("ChromeAlarmScheduler", () => {
  it("creates a named one-shot alarm for a tab and preset", async () => {
    const alarms = new MemoryChromeAlarms();
    const scheduler = new ChromeAlarmScheduler(alarms);

    await scheduler.schedule({
      tabId: 42,
      presetId: PRESET_ID,
      scheduledFor: 1_800_000_000_000
    });

    expect(alarms.createCalls).toEqual([
      {
        name: createCycleAlarmName({ tabId: 42, presetId: PRESET_ID }),
        alarmInfo: { when: 1_800_000_000_000 }
      }
    ]);
    expect(alarms.createCalls[0].alarmInfo).not.toHaveProperty(
      "periodInMinutes"
    );
  });

  it("returns the scheduled timer using domain-only fields", async () => {
    const alarms = new MemoryChromeAlarms();
    const scheduler = new ChromeAlarmScheduler(alarms);
    const identity = { tabId: 7, presetId: PRESET_ID };
    await scheduler.schedule({ ...identity, scheduledFor: 2_000 });

    const timer = await scheduler.get(identity);

    expect(timer).toEqual({ ...identity, scheduledFor: 2_000 });
    expect(Object.isFrozen(timer)).toBe(true);
    await expect(
      scheduler.get({ tabId: 8, presetId: PRESET_ID })
    ).resolves.toBeUndefined();
  });

  it("cancels only the timer belonging to the exact identity", async () => {
    const alarms = new MemoryChromeAlarms();
    const scheduler = new ChromeAlarmScheduler(alarms);
    const first = { tabId: 1, presetId: PRESET_ID };
    const second = { tabId: 2, presetId: PRESET_ID };
    await scheduler.schedule({ ...first, scheduledFor: 1_000 });
    await scheduler.schedule({ ...second, scheduledFor: 2_000 });

    await expect(scheduler.cancel(first)).resolves.toBe(true);
    await expect(scheduler.get(first)).resolves.toBeUndefined();
    await expect(scheduler.get(second)).resolves.toEqual({
      ...second,
      scheduledFor: 2_000
    });
    await expect(scheduler.cancel(first)).resolves.toBe(false);
  });

  it("lists only alarms owned by the repeat-cycle scheduler", async () => {
    const alarms = new MemoryChromeAlarms();
    const scheduler = new ChromeAlarmScheduler(alarms);
    await scheduler.schedule({
      tabId: 1,
      presetId: PRESET_ID,
      scheduledFor: 1_000
    });
    alarms.alarms.set("unrelated-alarm", {
      name: "unrelated-alarm",
      scheduledTime: 500
    });

    await expect(scheduler.list()).resolves.toEqual([
      { tabId: 1, presetId: PRESET_ID, scheduledFor: 1_000 }
    ]);
  });

  it("uses distinct reversible alarm names for every tab and preset pair", () => {
    const identities = [
      { tabId: 3, presetId: PRESET_ID },
      { tabId: 4, presetId: PRESET_ID },
      { tabId: 3, presetId: "preset:with/special characters" }
    ];
    const names = identities.map(createCycleAlarmName);

    expect(new Set(names)).toHaveLength(identities.length);
    expect(names.map(parseCycleAlarmName)).toEqual(identities);
    expect(parseCycleAlarmName("unrelated-alarm")).toBeUndefined();
    expect(
      parseCycleAlarmName("automation.repeat.v1:not-a-tab:preset")
    ).toBeUndefined();
  });

  it("rejects invalid timer values before calling Chrome", async () => {
    const alarms = new MemoryChromeAlarms();
    const scheduler = new ChromeAlarmScheduler(alarms);

    await expect(
      scheduler.schedule({ tabId: -1, presetId: PRESET_ID, scheduledFor: 1 })
    ).rejects.toThrow("tabId must be a non-negative integer");
    await expect(
      scheduler.schedule({ tabId: 1, presetId: " ", scheduledFor: 1 })
    ).rejects.toThrow("presetId must be a non-empty string");
    await expect(
      scheduler.schedule({
        tabId: 1,
        presetId: PRESET_ID,
        scheduledFor: Number.NaN
      })
    ).rejects.toThrow("scheduledFor must be a non-negative Unix time");
    expect(alarms.createCalls).toEqual([]);
  });

  it("wraps Chrome failures with operation and timer identity", async () => {
    const cause = new Error("chrome.alarms.create failed");
    const alarms = new MemoryChromeAlarms();
    alarms.createError = cause;
    const scheduler = new ChromeAlarmScheduler(alarms);

    await expect(
      scheduler.schedule({
        tabId: 9,
        presetId: PRESET_ID,
        scheduledFor: 1_000
      })
    ).rejects.toMatchObject({
      name: "CycleSchedulerError",
      operation: "schedule",
      identity: { tabId: 9, presetId: PRESET_ID },
      cause
    } satisfies Partial<CycleSchedulerError>);
  });
});

class MemoryChromeAlarms implements ChromeAlarmsApi {
  readonly alarms = new Map<string, ChromeAlarmRecord>();
  readonly createCalls: Array<{
    name: string;
    alarmInfo: { readonly when: number };
  }> = [];
  createError?: Error;

  async create(
    name: string,
    alarmInfo: { readonly when: number }
  ): Promise<void> {
    this.createCalls.push({ name, alarmInfo });
    if (this.createError !== undefined) {
      throw this.createError;
    }
    this.alarms.set(name, {
      name,
      scheduledTime: alarmInfo.when
    });
  }

  async get(name: string): Promise<ChromeAlarmRecord | undefined> {
    return this.alarms.get(name);
  }

  async getAll(): Promise<readonly ChromeAlarmRecord[]> {
    return [...this.alarms.values()];
  }

  async clear(name: string): Promise<boolean> {
    return this.alarms.delete(name);
  }
}
