import { describe, expect, it, vi } from "vitest";

import { InMemoryExecutionLog } from "../../src/adapters/logging/in-memory-execution-log";
import { ChromeNaturalPacingRepository } from "../../src/adapters/storage/chrome-natural-pacing-repository";
import type { ChromeStorageArea } from "../../src/adapters/storage/chrome-storage";
import { AutomationRunner } from "../../src/core/application/automation-runner";
import { RepeatCycleController } from "../../src/core/application/repeat-cycle-controller";
import { TabSessionManager } from "../../src/core/application/tab-session-manager";
import type { PresetV1 } from "../../src/core/domain/preset";
import type { RepeatCycleRuntimeState } from "../../src/core/domain/repeat-cycle";
import type { AutomationEngine } from "../../src/core/ports/automation-engine";
import type { CycleScheduler } from "../../src/core/ports/cycle-scheduler";
import type { RepeatCycleRegistry } from "../../src/core/ports/repeat-cycle-registry";
import validPresetJson from "../fixtures/presets/valid-full.json";

describe("Natural pacing runtime integration", () => {
  it("finishes the random pause before a repeat cycle schedules its next run", async () => {
    const preset = structuredClone(validPresetJson) as PresetV1;
    preset.siteSettings.repeat = { enabled: true, intervalMinutes: 2 };
    preset.automation.steps = [
      { id: "reload-one", type: "reload", enabled: true, waitUntil: "load" },
      { id: "reload-two", type: "reload", enabled: true, waitUntil: "load" }
    ];
    const settings = new ChromeNaturalPacingRepository(new MemoryStorage());
    await settings.save(preset.id, {
      enabled: true,
      minimumDelaySeconds: 1,
      maximumDelaySeconds: 1
    });

    const engine = createEngine();
    const sessions = new TabSessionManager(engine, {
      createSessionId: () => "natural-pacing-session"
    });
    let releasePause!: () => void;
    let reportPauseStarted!: () => void;
    const pauseStarted = new Promise<void>((resolve) => { reportPauseStarted = resolve; });
    const runner = new AutomationRunner(engine, sessions, new InMemoryExecutionLog(), {
      naturalPacingRepository: settings,
      delay: () => new Promise<void>((resolve) => {
        releasePause = resolve;
        reportPauseStarted();
      })
    });
    const scheduler = createScheduler();
    const registry = new MemoryRepeatRegistry();
    const cycles = new RepeatCycleController(runner, scheduler, registry, {
      clock: () => 1_800_000_000_000
    });

    const running = cycles.runManual(preset, 42);
    await pauseStarted;
    expect(scheduler.schedule).not.toHaveBeenCalled();

    releasePause();
    await running;

    expect(scheduler.schedule).toHaveBeenCalledWith({
      tabId: 42,
      presetId: preset.id,
      scheduledFor: 1_800_000_120_000
    });
    await expect(registry.getByTabId(42)).resolves.toMatchObject({
      state: "waiting",
      nextRunAt: 1_800_000_120_000
    });
  });
});

function createEngine(): AutomationEngine {
  return {
    start: vi.fn(async (request) => ({ sessionId: request.sessionId, target: request.target })),
    executeStep: vi.fn(async (request) => ({
      sessionId: request.sessionId,
      stepId: request.step.id,
      stepIndex: request.stepIndex
    })),
    complete: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    stopAll: vi.fn(async () => undefined)
  };
}

function createScheduler(): CycleScheduler {
  return {
    schedule: vi.fn(async () => undefined),
    get: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    cancel: vi.fn(async () => false)
  };
}

class MemoryRepeatRegistry implements RepeatCycleRegistry {
  #state?: RepeatCycleRuntimeState;
  async list() { return this.#state === undefined ? [] : [structuredClone(this.#state)]; }
  async getByTabId(tabId: number) {
    return this.#state?.tabId === tabId ? structuredClone(this.#state) : undefined;
  }
  async save(state: RepeatCycleRuntimeState) { this.#state = structuredClone(state); }
  async removeByTabId(tabId: number) {
    if (this.#state?.tabId !== tabId) return false;
    this.#state = undefined;
    return true;
  }
  async removeStale() { return 0; }
  async clear() {
    const count = this.#state === undefined ? 0 : 1;
    this.#state = undefined;
    return count;
  }
}

class MemoryStorage implements ChromeStorageArea {
  readonly values: Record<string, unknown> = {};
  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.values ? { [key]: structuredClone(this.values[key]) } : {};
  }
  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
  }
}
