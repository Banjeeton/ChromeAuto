import { describe, expect, it, vi } from "vitest";

import {
  ChromeAlarmScheduler,
  type ChromeAlarmRecord,
  type ChromeAlarmsApi
} from "../../src/adapters/chrome/alarm-scheduler";
import { InMemoryExecutionLog } from "../../src/adapters/logging/in-memory-execution-log";
import { InMemoryRepeatCycleLog } from "../../src/adapters/logging/in-memory-repeat-cycle-log";
import {
  ChromeRepeatCycleRegistry,
  type ChromeSessionStorageArea
} from "../../src/adapters/storage/chrome-repeat-cycle-registry";
import {
  ChromePresetRepository,
  type ChromeStorageArea
} from "../../src/adapters/storage/chrome-storage";
import { AutomationRunner } from "../../src/core/application/automation-runner";
import { AutomationRuntimeController } from "../../src/core/application/automation-runtime-controller";
import { ManualRunController } from "../../src/core/application/manual-run-controller";
import { RepeatCycleController } from "../../src/core/application/repeat-cycle-controller";
import { RepeatCycleRecoveryController } from "../../src/core/application/repeat-cycle-recovery-controller";
import { TabSessionManager } from "../../src/core/application/tab-session-manager";
import type { PresetV1 } from "../../src/core/domain/preset";
import type { AutomationEngine } from "../../src/core/ports/automation-engine";

const PRESET_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("Automation Scheduling MVP integration", () => {
  it("runs manually, waits, and executes the next alarm pass", async () => {
    const shared = createSharedState();
    const harness = createHarness(shared);
    await harness.presets.save(createPreset());

    await expect(
      harness.manualRun.run(1, "https://example.com/fixture")
    ).resolves.toMatchObject({ tabId: 1, executedSteps: 1 });
    const firstTimer = (await harness.scheduler.list())[0];
    expect(firstTimer).toEqual({
      tabId: 1,
      presetId: PRESET_ID,
      scheduledFor: shared.clock.value + 60_000
    });

    shared.clock.value = firstTimer.scheduledFor + 500;
    await expect(harness.recovery.handleAlarm(firstTimer)).resolves.toMatchObject({
      tabId: 1,
      executedSteps: 1
    });

    expect(harness.engine.executeStep).toHaveBeenCalledTimes(2);
    await expect(harness.registry.getByTabId(1)).resolves.toEqual({
      tabId: 1,
      presetId: PRESET_ID,
      state: "waiting",
      nextRunAt: shared.clock.value + 60_000
    });
    expect((await harness.cycleLog.list({ tabId: 1 })).map((entry) => entry.event))
      .toEqual([
        "started",
        "completed",
        "scheduled",
        "started",
        "completed",
        "scheduled"
      ]);
  });

  it("keeps two tabs independent across Stop, close, and Stop All", async () => {
    const shared = createSharedState();
    const harness = createHarness(shared);
    await harness.presets.save(createPreset());
    await harness.manualRun.run(1, "https://example.com/one");
    await harness.manualRun.run(2, "https://example.com/two");

    await expect(harness.runtime.stopByTabId(1)).resolves.toMatchObject({
      stopped: true,
      tabId: 1
    });
    await expect(harness.registry.getByTabId(1)).resolves.toMatchObject({
      state: "stopped"
    });
    await expect(harness.registry.getByTabId(2)).resolves.toMatchObject({
      state: "waiting"
    });
    expect(await harness.scheduler.list()).toHaveLength(1);

    await expect(harness.recovery.handleTabRemoved(2)).resolves.toBe(true);
    await expect(harness.registry.getByTabId(2)).resolves.toMatchObject({
      state: "stopped"
    });
    expect(await harness.scheduler.list()).toEqual([]);

    await harness.manualRun.run(1, "https://example.com/one");
    await harness.manualRun.run(2, "https://example.com/two");
    await expect(harness.runtime.stopAll()).resolves.toMatchObject({
      stoppedCount: 2
    });
    expect(await harness.scheduler.list()).toEqual([]);
    await expect(harness.registry.getByTabId(1)).resolves.toMatchObject({
      state: "stopped"
    });
    await expect(harness.registry.getByTabId(2)).resolves.toMatchObject({
      state: "stopped"
    });
    await expect(harness.cycleLog.list()).resolves.toContainEqual(
      expect.objectContaining({
        tabId: 2,
        event: "stopped",
        reason: "tab-closed"
      })
    );
  });

  it("stops the cycle on a step error and records the failing step", async () => {
    const shared = createSharedState();
    const harness = createHarness(shared);
    await harness.presets.save(createPreset());
    await harness.manualRun.run(3, "https://example.com/error");
    await harness.manualRun.run(2, "https://example.com/two");
    const timer = (await harness.scheduler.list()).find(
      (candidate) => candidate.tabId === 3
    );
    if (timer === undefined) {
      throw new Error("Expected the failing tab timer.");
    }
    harness.engineFailure.value = new Error("Fixture step failed");

    await expect(harness.recovery.handleAlarm(timer)).rejects.toMatchObject({
      code: "step-failed",
      context: { stepId: "wait-step", stepIndex: 0 }
    });

    await expect(harness.registry.getByTabId(3)).resolves.toMatchObject({
      state: "failed"
    });
    expect(await harness.scheduler.list()).toEqual([
      expect.objectContaining({ tabId: 2, presetId: PRESET_ID })
    ]);
    await expect(harness.registry.getByTabId(2)).resolves.toMatchObject({
      state: "waiting"
    });
    await expect(harness.cycleLog.list({ tabId: 3 })).resolves.toContainEqual(
      expect.objectContaining({
        event: "failed",
        stepId: "wait-step",
        stepNumber: 1,
        error: "Fixture step failed"
      })
    );
  });

  it("recognizes and continues an alarm after service worker recreation", async () => {
    const shared = createSharedState();
    const firstWorker = createHarness(shared);
    await firstWorker.presets.save(createPreset());
    await firstWorker.manualRun.run(4, "https://example.com/restart");
    const timer = (await firstWorker.scheduler.list())[0];

    const recreatedWorker = createHarness(shared);
    await expect(recreatedWorker.recovery.recover()).resolves.toEqual({
      recognized: 1,
      restoredTimers: 0,
      removedTimers: 0,
      removedStates: 0
    });
    await expect(
      recreatedWorker.recovery.handleAlarm(timer)
    ).resolves.toMatchObject({ tabId: 4, executedSteps: 1 });

    expect(recreatedWorker.engine.executeStep).toHaveBeenCalledOnce();
    await expect(recreatedWorker.registry.getByTabId(4)).resolves.toMatchObject({
      state: "waiting",
      nextRunAt: shared.clock.value + 60_000
    });
    expect(await recreatedWorker.scheduler.list()).toHaveLength(1);
  });
});

function createSharedState() {
  return {
    alarms: new MemoryChromeAlarms(),
    localStorage: new MemoryChromeStorage(),
    sessionStorage: new MemoryChromeStorage(),
    clock: { value: Date.parse("2026-09-28T12:00:00.000Z") },
    tabs: new Map<number, string>([
      [1, "https://example.com/fixture"],
      [2, "https://example.com/two"],
      [3, "https://example.com/error"],
      [4, "https://example.com/restart"]
    ])
  };
}

function createHarness(shared: ReturnType<typeof createSharedState>) {
  const presets = new ChromePresetRepository(shared.localStorage);
  const registry = new ChromeRepeatCycleRegistry(shared.sessionStorage);
  const scheduler = new ChromeAlarmScheduler(shared.alarms);
  const engineFailure: { value?: Error } = {};
  let sessionIndex = 0;
  const engine: AutomationEngine & {
    executeStep: ReturnType<typeof vi.fn>;
  } = {
    start: vi.fn(async (request) => ({
      sessionId: request.sessionId,
      target: request.target
    })),
    executeStep: vi.fn(async (request) => {
      if (engineFailure.value !== undefined) {
        const error = engineFailure.value;
        engineFailure.value = undefined;
        throw error;
      }
      return {
        sessionId: request.sessionId,
        stepId: request.step.id,
        stepIndex: request.stepIndex
      };
    }),
    complete: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    stopAll: vi.fn(async () => undefined)
  };
  const sessions = new TabSessionManager(engine, {
    createSessionId: () => `scheduling-session-${++sessionIndex}`
  });
  const runner = new AutomationRunner(
    engine,
    sessions,
    new InMemoryExecutionLog(),
    { createLogEntryId: () => `step-log-${sessionIndex}` }
  );
  const cycleLog = new InMemoryRepeatCycleLog();
  let cycleLogIndex = 0;
  const repeatCycles = new RepeatCycleController(runner, scheduler, registry, {
    clock: () => shared.clock.value,
    createLogEntryId: () => `cycle-log-${++cycleLogIndex}`,
    log: cycleLog
  });
  const manualRun = new ManualRunController(
    presets,
    runner,
    sessions,
    repeatCycles,
    registry
  );
  const recovery = new RepeatCycleRecoveryController(
    repeatCycles,
    scheduler,
    registry,
    presets,
    { getUrl: async (tabId) => shared.tabs.get(tabId) }
  );
  const runtime = new AutomationRuntimeController(sessions, repeatCycles);

  return {
    cycleLog,
    engine,
    engineFailure,
    manualRun,
    presets,
    recovery,
    registry,
    runtime,
    scheduler
  };
}

class MemoryChromeStorage
  implements ChromeStorageArea, ChromeSessionStorageArea
{
  readonly values: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.values
      ? { [key]: structuredClone(this.values[key]) }
      : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
  }
}

class MemoryChromeAlarms implements ChromeAlarmsApi {
  readonly alarms = new Map<string, ChromeAlarmRecord>();

  async create(
    name: string,
    alarmInfo: { readonly when: number }
  ): Promise<void> {
    this.alarms.set(name, { name, scheduledTime: alarmInfo.when });
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

function createPreset(): PresetV1 {
  return {
    schemaVersion: 1,
    id: PRESET_ID,
    name: "Scheduling integration",
    createdAt: "2026-09-28T12:00:00.000Z",
    updatedAt: "2026-09-28T12:00:00.000Z",
    site: { hostname: "example.com", protocols: ["https"] },
    automation: {
      defaults: {
        timeoutMs: 5_000,
        postActionDelayMs: 0,
        humanInput: { enabled: false, minDelayMs: 40, maxDelayMs: 120 }
      },
      steps: [
        {
          id: "wait-step",
          name: "Wait step",
          type: "wait",
          enabled: true,
          condition: { type: "timeout", durationMs: 1 }
        }
      ]
    },
    siteSettings: {
      enabled: true,
      repeat: { enabled: true, intervalMinutes: 1 }
    }
  };
}
