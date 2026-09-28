import { describe, expect, it, vi } from "vitest";

import { RepeatCycleRecoveryController } from "../../src/core/application/repeat-cycle-recovery-controller";
import type { AutomationRunResult } from "../../src/core/application/automation-runner";
import type { PresetV1 } from "../../src/core/domain/preset";
import type {
  RepeatCycleIdentity,
  RepeatCycleRuntimeState
} from "../../src/core/domain/repeat-cycle";
import type {
  CycleScheduler,
  ScheduledCycleTimer,
  ScheduleCycleTimerRequest
} from "../../src/core/ports/cycle-scheduler";
import type { RepeatCycleRegistry } from "../../src/core/ports/repeat-cycle-registry";

const PRESET_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("RepeatCycleRecoveryController", () => {
  it("recognizes an existing timer after worker recreation without duplicating it", async () => {
    const harness = createHarness();
    harness.registry.states.set(7, waitingState(7, 50_000));
    harness.scheduler.timers.push(timer(7, 50_000));

    const first = await harness.controller.recover();
    const second = await harness.controller.recover();

    expect(first).toEqual({
      recognized: 1,
      restoredTimers: 0,
      removedTimers: 0,
      removedStates: 0
    });
    expect(second).toEqual(first);
    expect(harness.scheduler.timers).toEqual([timer(7, 50_000)]);
    expect(harness.scheduler.scheduleCalls).toEqual([]);
    expect(harness.registry.states.get(7)).toEqual(waitingState(7, 50_000));
  });

  it("removes orphaned and mismatched timers plus invalid runtime state", async () => {
    const harness = createHarness();
    harness.scheduler.timers.push(timer(1, 10_000));
    harness.scheduler.timers.push(timer(3, 30_000));
    harness.registry.states.set(2, waitingState(2, 20_000));
    harness.registry.states.set(3, waitingState(3, 31_000));

    await expect(harness.controller.recover()).resolves.toEqual({
      recognized: 0,
      restoredTimers: 0,
      removedTimers: 2,
      removedStates: 2
    });
    expect(harness.scheduler.timers).toEqual([]);
    expect(harness.registry.states.size).toBe(0);
  });

  it("restores a missing alarm once for a valid waiting cycle", async () => {
    const harness = createHarness();
    harness.tabs.set(14, "https://example.com/page");
    harness.registry.states.set(14, waitingState(14, 14_000));

    await expect(harness.controller.recover()).resolves.toMatchObject({
      recognized: 1,
      restoredTimers: 1,
      removedStates: 0
    });
    await expect(harness.controller.recover()).resolves.toMatchObject({
      recognized: 1,
      restoredTimers: 0,
      removedStates: 0
    });
    expect(harness.scheduler.scheduleCalls).toEqual([timer(14, 14_000)]);
  });

  it("removes timers whose preset is invalid, disabled or no longer matches the tab", async () => {
    const invalid = createPreset();
    invalid.automation.steps = [];
    const disabled = createPreset({ id: "disabled", hostname: "disabled.test" });
    disabled.siteSettings.repeat.enabled = false;
    const moved = createPreset({ id: "moved", hostname: "moved.test" });
    const harness = createHarness({ presets: [invalid, disabled, moved] });
    harness.tabs.set(8, "https://example.com/page");
    harness.tabs.set(9, "https://disabled.test/page");
    harness.tabs.set(10, "https://other.test/page");

    for (const [tabId, preset, scheduledFor] of [
      [8, invalid, 8_000],
      [9, disabled, 9_000],
      [10, moved, 10_000]
    ] as const) {
      harness.registry.states.set(
        tabId,
        waitingState(tabId, scheduledFor, preset.id)
      );
      harness.scheduler.timers.push(timer(tabId, scheduledFor, preset.id));
    }

    await expect(harness.controller.recover()).resolves.toMatchObject({
      recognized: 0,
      removedTimers: 3,
      removedStates: 3
    });
  });

  it("reloads and validates the current preset before handling an alarm", async () => {
    const preset = createPreset();
    const harness = createHarness({ presets: [preset] });
    harness.registry.states.set(11, waitingState(11, 11_000));
    harness.scheduler.timers.push(timer(11, 11_000));
    preset.automation.steps = [];

    await expect(
      harness.controller.handleAlarm(timer(11, 11_000))
    ).resolves.toBeUndefined();

    expect(harness.presets.getById).toHaveBeenCalledWith(PRESET_ID);
    expect(harness.runner.runScheduled).not.toHaveBeenCalled();
    expect(harness.registry.states.has(11)).toBe(false);
    expect(harness.scheduler.timers).toEqual([]);
  });

  it("restores a valid alarm once and ignores duplicate delivery", async () => {
    const harness = createHarness();
    harness.registry.states.set(12, waitingState(12, 12_000));
    harness.scheduler.timers.push(timer(12, 12_000));
    harness.runner.runScheduled.mockImplementation(async (preset, tabId) => {
      await harness.registry.save({
        tabId,
        presetId: preset.id,
        state: "running"
      });
      return runResult(tabId);
    });

    await expect(
      harness.controller.handleAlarm(timer(12, 12_000))
    ).resolves.toEqual(runResult(12));
    await expect(
      harness.controller.handleAlarm(timer(12, 12_000))
    ).resolves.toBeUndefined();

    expect(harness.runner.runScheduled).toHaveBeenCalledOnce();
  });

  it("ignores a stale alarm event without cancelling the current timer", async () => {
    const harness = createHarness();
    harness.registry.states.set(13, waitingState(13, 14_000));
    harness.scheduler.timers.push(timer(13, 14_000));

    await expect(
      harness.controller.handleAlarm(timer(13, 13_000))
    ).resolves.toBeUndefined();

    expect(harness.runner.runScheduled).not.toHaveBeenCalled();
    expect(harness.scheduler.timers).toEqual([timer(13, 14_000)]);
  });
});

function createHarness(options: { presets?: PresetV1[] } = {}) {
  const scheduler = new MemoryCycleScheduler();
  const registry = new MemoryRepeatCycleRegistry();
  const storedPresets = options.presets ?? [createPreset()];
  const presets = {
    list: vi.fn(async () => structuredClone(storedPresets)),
    getById: vi.fn(async (presetId: string) => {
      const preset = storedPresets.find((item) => item.id === presetId);
      return preset === undefined ? undefined : structuredClone(preset);
    })
  };
  const tabs = new Map<number, string>([
    [7, "https://example.com"],
    [12, "https://example.com"],
    [13, "https://example.com"]
  ]);
  const runner = {
    runScheduled: vi.fn<
      (
        preset: PresetV1,
        tabId: number,
        scheduledFor: number
      ) => Promise<AutomationRunResult | undefined>
    >()
  };
  const controller = new RepeatCycleRecoveryController(
    runner,
    scheduler,
    registry,
    presets,
    { getUrl: async (tabId) => tabs.get(tabId) }
  );
  return { controller, presets, registry, runner, scheduler, tabs };
}

class MemoryCycleScheduler implements CycleScheduler {
  readonly timers: ScheduleCycleTimerRequest[] = [];
  readonly scheduleCalls: ScheduleCycleTimerRequest[] = [];

  async schedule(request: ScheduleCycleTimerRequest): Promise<void> {
    this.scheduleCalls.push(structuredClone(request));
    const currentIndex = this.timers.findIndex((item) => same(item, request));
    if (currentIndex >= 0) {
      this.timers.splice(currentIndex, 1);
    }
    this.timers.push(structuredClone(request));
  }

  async get(
    identity: RepeatCycleIdentity
  ): Promise<ScheduledCycleTimer | undefined> {
    return this.timers.find((item) => same(item, identity));
  }

  async list(): Promise<readonly ScheduledCycleTimer[]> {
    return structuredClone(this.timers);
  }

  async cancel(identity: RepeatCycleIdentity): Promise<boolean> {
    const index = this.timers.findIndex((item) => same(item, identity));
    if (index < 0) {
      return false;
    }
    this.timers.splice(index, 1);
    return true;
  }
}

class MemoryRepeatCycleRegistry implements RepeatCycleRegistry {
  readonly states = new Map<number, RepeatCycleRuntimeState>();

  async list(): Promise<readonly RepeatCycleRuntimeState[]> {
    return structuredClone([...this.states.values()]);
  }

  async getByTabId(
    tabId: number
  ): Promise<RepeatCycleRuntimeState | undefined> {
    return structuredClone(this.states.get(tabId));
  }

  async save(state: RepeatCycleRuntimeState): Promise<void> {
    this.states.set(state.tabId, structuredClone(state));
  }

  async removeByTabId(tabId: number): Promise<boolean> {
    return this.states.delete(tabId);
  }

  async removeStale(
    validCycles: readonly RepeatCycleIdentity[]
  ): Promise<number> {
    const valid = new Set(validCycles.map(identityKey));
    let removed = 0;
    for (const [tabId, state] of this.states) {
      if (!valid.has(identityKey(state))) {
        this.states.delete(tabId);
        removed += 1;
      }
    }
    return removed;
  }

  async clear(): Promise<number> {
    const count = this.states.size;
    this.states.clear();
    return count;
  }
}

function createPreset(options: { id?: string; hostname?: string } = {}): PresetV1 {
  return {
    schemaVersion: 1,
    id: options.id ?? PRESET_ID,
    name: "Repeat recovery",
    createdAt: "2026-09-28T12:00:00.000Z",
    updatedAt: "2026-09-28T12:00:00.000Z",
    site: {
      hostname: options.hostname ?? "example.com",
      protocols: ["https"]
    },
    automation: {
      defaults: {
        timeoutMs: 5_000,
        postActionDelayMs: 0,
        humanInput: { enabled: false, minDelayMs: 40, maxDelayMs: 120 }
      },
      steps: [
        {
          id: "wait",
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

function waitingState(
  tabId: number,
  nextRunAt: number,
  presetId = PRESET_ID
): RepeatCycleRuntimeState {
  return { tabId, presetId, state: "waiting", nextRunAt };
}

function timer(
  tabId: number,
  scheduledFor: number,
  presetId = PRESET_ID
): ScheduledCycleTimer {
  return { tabId, presetId, scheduledFor };
}

function same(left: RepeatCycleIdentity, right: RepeatCycleIdentity): boolean {
  return left.tabId === right.tabId && left.presetId === right.presetId;
}

function identityKey(identity: RepeatCycleIdentity): string {
  return `${identity.tabId}:${identity.presetId}`;
}

function runResult(tabId: number): AutomationRunResult {
  return {
    sessionId: `session-${tabId}`,
    presetId: PRESET_ID,
    tabId,
    executedSteps: 1,
    skippedSteps: 0
  };
}
