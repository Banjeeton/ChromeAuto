import { describe, expect, it, vi } from "vitest";

import {
  RepeatCycleAlreadyRunningError,
  RepeatCycleController
} from "../../src/core/application/repeat-cycle-controller";
import type {
  AutomationRunResult,
  RunAutomationRequest
} from "../../src/core/application/automation-runner";
import { AutomationEngineError } from "../../src/core/domain/automation-engine-error";
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

describe("RepeatCycleController", () => {
  it("creates a cycle after a manual run and waits from completion time", async () => {
    const harness = createHarness({ now: 10_000 });
    const preset = createPreset();

    await expect(harness.controller.runManual(preset, 42)).resolves.toEqual(
      runResult(42)
    );

    expect(harness.runner.run).toHaveBeenCalledWith({
      presetId: PRESET_ID,
      tabId: 42,
      automation: preset.automation
    });
    expect(harness.registry.history).toEqual([
      { tabId: 42, presetId: PRESET_ID, state: "running" },
      {
        tabId: 42,
        presetId: PRESET_ID,
        state: "waiting",
        nextRunAt: 130_000
      }
    ]);
    expect(harness.scheduler.scheduled).toEqual([
      { tabId: 42, presetId: PRESET_ID, scheduledFor: 130_000 }
    ]);
  });

  it("runs a waiting cycle and schedules its next one-shot timer", async () => {
    const harness = createHarness({ now: 20_000 });
    const preset = createPreset({ intervalMinutes: 1 });
    await harness.registry.save({
      tabId: 7,
      presetId: PRESET_ID,
      state: "waiting",
      nextRunAt: 15_000
    });
    harness.registry.history.length = 0;

    await expect(
      harness.controller.runScheduled(preset, 7, 15_000)
    ).resolves.toEqual(runResult(7));

    expect(harness.runner.run).toHaveBeenCalledOnce();
    expect(harness.scheduler.scheduled).toEqual([
      { tabId: 7, presetId: PRESET_ID, scheduledFor: 80_000 }
    ]);
    expect(harness.registry.history).toEqual([
      { tabId: 7, presetId: PRESET_ID, state: "running" },
      {
        tabId: 7,
        presetId: PRESET_ID,
        state: "waiting",
        nextRunAt: 80_000
      }
    ]);
  });

  it("ignores stale timer events", async () => {
    const harness = createHarness();
    const preset = createPreset();
    await harness.registry.save({
      tabId: 8,
      presetId: PRESET_ID,
      state: "waiting",
      nextRunAt: 50_000
    });

    await expect(
      harness.controller.runScheduled(preset, 8, 40_000)
    ).resolves.toBeUndefined();

    expect(harness.runner.run).not.toHaveBeenCalled();
    expect(harness.scheduler.scheduled).toEqual([]);
  });

  it("does not allow overlapping passes in one tab", async () => {
    let resolveRun: ((result: AutomationRunResult) => void) | undefined;
    const harness = createHarness({
      run: () =>
        new Promise((resolve) => {
          resolveRun = resolve;
        })
    });
    const preset = createPreset();
    const firstRun = harness.controller.runManual(preset, 9);
    await vi.waitFor(() => expect(harness.runner.run).toHaveBeenCalledOnce());

    await expect(harness.controller.runManual(preset, 9)).rejects.toBeInstanceOf(
      RepeatCycleAlreadyRunningError
    );
    expect(harness.runner.run).toHaveBeenCalledOnce();

    resolveRun?.(runResult(9));
    await expect(firstRun).resolves.toEqual(runResult(9));
  });

  it("marks the cycle failed and does not schedule after an execution error", async () => {
    const failure = new AutomationEngineError(
      "step-failed",
      "The automation step failed"
    );
    const harness = createHarness({ run: async () => Promise.reject(failure) });

    await expect(
      harness.controller.runManual(createPreset(), 10)
    ).rejects.toBe(failure);

    expect(harness.scheduler.scheduled).toEqual([]);
    await expect(harness.registry.getByTabId(10)).resolves.toEqual({
      tabId: 10,
      presetId: PRESET_ID,
      state: "failed"
    });
  });

  it("marks an automation.stop result as stopped instead of failed", async () => {
    const stopped = new AutomationEngineError(
      "session-stopped",
      "Stopped from custom code"
    );
    const harness = createHarness({ run: async () => Promise.reject(stopped) });

    await expect(
      harness.controller.runManual(createPreset(), 11)
    ).rejects.toBe(stopped);

    expect(harness.scheduler.scheduled).toEqual([]);
    await expect(harness.registry.getByTabId(11)).resolves.toMatchObject({
      state: "stopped"
    });
  });

  it("cancels a created timer if persisting the waiting state fails", async () => {
    const harness = createHarness();
    harness.registry.failWaitingSave = true;

    await expect(
      harness.controller.runManual(createPreset(), 12)
    ).rejects.toThrow("waiting state write failed");

    expect(harness.scheduler.scheduled).toEqual([]);
    expect(harness.scheduler.cancelled).toContainEqual({
      tabId: 12,
      presetId: PRESET_ID
    });
  });
});

function createHarness(options: {
  now?: number;
  run?: (request: RunAutomationRequest) => Promise<AutomationRunResult>;
} = {}) {
  const scheduler = new MemoryCycleScheduler();
  const registry = new MemoryRepeatCycleRegistry();
  const runner = {
    run: vi.fn(
      options.run ??
        (async (request: RunAutomationRequest) => runResult(request.tabId))
    )
  };
  const controller = new RepeatCycleController(runner, scheduler, registry, {
    clock: () => options.now ?? 1_000
  });
  return { controller, registry, runner, scheduler };
}

class MemoryCycleScheduler implements CycleScheduler {
  readonly scheduled: ScheduleCycleTimerRequest[] = [];
  readonly cancelled: RepeatCycleIdentity[] = [];

  async schedule(request: ScheduleCycleTimerRequest): Promise<void> {
    this.scheduled.push(structuredClone(request));
  }

  async get(
    identity: RepeatCycleIdentity
  ): Promise<ScheduledCycleTimer | undefined> {
    return this.scheduled.find(
      (timer) =>
        timer.tabId === identity.tabId && timer.presetId === identity.presetId
    );
  }

  async cancel(identity: RepeatCycleIdentity): Promise<boolean> {
    this.cancelled.push(structuredClone(identity));
    const index = this.scheduled.findIndex(
      (timer) =>
        timer.tabId === identity.tabId && timer.presetId === identity.presetId
    );
    if (index === -1) {
      return false;
    }
    this.scheduled.splice(index, 1);
    return true;
  }
}

class MemoryRepeatCycleRegistry implements RepeatCycleRegistry {
  readonly states = new Map<number, RepeatCycleRuntimeState>();
  readonly history: RepeatCycleRuntimeState[] = [];
  failWaitingSave = false;

  async list(): Promise<readonly RepeatCycleRuntimeState[]> {
    return [...this.states.values()];
  }

  async getByTabId(
    tabId: number
  ): Promise<RepeatCycleRuntimeState | undefined> {
    return this.states.get(tabId);
  }

  async save(state: RepeatCycleRuntimeState): Promise<void> {
    if (state.state === "waiting" && this.failWaitingSave) {
      throw new Error("waiting state write failed");
    }
    const detached = structuredClone(state);
    this.states.set(state.tabId, detached);
    this.history.push(detached);
  }

  async removeByTabId(tabId: number): Promise<boolean> {
    return this.states.delete(tabId);
  }

  async removeStale(
    validCycles: readonly RepeatCycleIdentity[]
  ): Promise<number> {
    const valid = new Set(
      validCycles.map((identity) => `${identity.tabId}:${identity.presetId}`)
    );
    let removed = 0;
    for (const [tabId, state] of this.states) {
      if (!valid.has(`${tabId}:${state.presetId}`)) {
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

function createPreset(options: { intervalMinutes?: number } = {}): PresetV1 {
  return {
    schemaVersion: 1,
    id: PRESET_ID,
    name: "Repeating automation",
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
          id: "wait",
          type: "wait",
          enabled: true,
          condition: { type: "timeout", durationMs: 1 }
        }
      ]
    },
    siteSettings: {
      enabled: true,
      repeat: {
        enabled: true,
        intervalMinutes: options.intervalMinutes ?? 2
      }
    }
  };
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
