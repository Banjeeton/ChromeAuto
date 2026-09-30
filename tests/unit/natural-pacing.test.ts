import { describe, expect, it, vi } from "vitest";

import { InMemoryExecutionLog } from "../../src/adapters/logging/in-memory-execution-log";
import { InMemoryNaturalPacingLog } from "../../src/adapters/logging/in-memory-natural-pacing-log";
import { ChromeNaturalPacingRepository } from "../../src/adapters/storage/chrome-natural-pacing-repository";
import type { ChromeStorageArea } from "../../src/adapters/storage/chrome-storage";
import { AutomationRunner } from "../../src/core/application/automation-runner";
import { TabSessionManager } from "../../src/core/application/tab-session-manager";
import {
  DEFAULT_NATURAL_PACING_SETTINGS,
  randomNaturalPacingDelayMs,
  validateNaturalPacingSettings
} from "../../src/core/domain/natural-pacing";
import type { AutomationDefinition } from "../../src/core/domain/automation";
import type { AutomationEngine } from "../../src/core/ports/automation-engine";

describe("Natural pacing", () => {
  it("validates ranges and generates a delay inside the inclusive range", () => {
    expect(validateNaturalPacingSettings({
      enabled: true,
      minimumDelaySeconds: 3,
      maximumDelaySeconds: 2
    })).toContain("Minimum delay cannot exceed maximum delay.");
    expect(randomNaturalPacingDelayMs({
      enabled: true,
      minimumDelaySeconds: 1,
      maximumDelaySeconds: 2
    }, () => 0)).toBe(1_000);
    expect(randomNaturalPacingDelayMs({
      enabled: true,
      minimumDelaySeconds: 1,
      maximumDelaySeconds: 2
    }, () => 1)).toBe(2_000);
  });

  it("stores settings by preset and removes them independently", async () => {
    const repository = new ChromeNaturalPacingRepository(new MemoryStorage());
    await expect(repository.get("new-preset")).resolves.toEqual(
      DEFAULT_NATURAL_PACING_SETTINGS
    );
    await repository.save("preset-a", {
      enabled: true,
      minimumDelaySeconds: 0.5,
      maximumDelaySeconds: 1.5
    });
    await repository.save("preset-b", {
      enabled: true,
      minimumDelaySeconds: 2,
      maximumDelaySeconds: 2
    });
    await repository.remove("preset-a");
    await expect(repository.get("preset-a")).resolves.toEqual(
      DEFAULT_NATURAL_PACING_SETTINGS
    );
    await expect(repository.get("preset-b")).resolves.toMatchObject({
      enabled: true,
      minimumDelaySeconds: 2
    });
  });

  it("pauses between enabled steps, skips explicit post-action delay and the final step", async () => {
    const engine = createEngine();
    const sessions = new TabSessionManager(engine, { createSessionId: () => "session-1" });
    const pacingLog = new InMemoryNaturalPacingLog();
    const delay = vi.fn(async () => undefined);
    const runner = new AutomationRunner(engine, sessions, new InMemoryExecutionLog(), {
      naturalPacingRepository: enabledRepository(),
      naturalPacingLog: pacingLog,
      random: () => 0.5,
      delay,
      createLogEntryId: (() => { let id = 0; return () => `log-${++id}`; })()
    });
    const automation = automationWithSteps([
      reloadStep("first"),
      { ...reloadStep("explicit-zero"), postActionDelayMs: 0 },
      reloadStep("last")
    ]);

    await runner.run({ presetId: "preset-1", tabId: 42, automation });

    expect(delay).toHaveBeenCalledTimes(1);
    expect(delay).toHaveBeenCalledWith(2_000, expect.any(AbortSignal));
    expect((await pacingLog.list()).map(({ event }) => event)).toEqual([
      "started",
      "completed"
    ]);
    expect(vi.mocked(engine.executeStep).mock.calls[0]?.[0].defaults.humanInput.enabled).toBe(true);
  });

  it("interrupts an active random pause when the tab session is stopped", async () => {
    const engine = createEngine();
    const sessions = new TabSessionManager(engine, { createSessionId: () => "session-stop" });
    let started!: () => void;
    const pauseStarted = new Promise<void>((resolve) => { started = resolve; });
    const runner = new AutomationRunner(engine, sessions, new InMemoryExecutionLog(), {
      naturalPacingRepository: enabledRepository(),
      delay: (_duration, signal) => new Promise((_, reject) => {
        started();
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
    });
    const running = runner.run({
      presetId: "preset-1",
      tabId: 42,
      automation: automationWithSteps([reloadStep("first"), reloadStep("last")])
    });
    await pauseStarted;
    await sessions.stopByTabId(42);
    await expect(running).rejects.toMatchObject({ code: "session-stopped" });
    expect(engine.executeStep).toHaveBeenCalledTimes(1);
  });
});

function enabledRepository() {
  return {
    get: vi.fn(async () => ({ enabled: true, minimumDelaySeconds: 1, maximumDelaySeconds: 3 })),
    save: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined)
  };
}

function automationWithSteps(steps: AutomationDefinition["steps"]): AutomationDefinition {
  return {
    defaults: {
      timeoutMs: 5_000,
      postActionDelayMs: 0,
      humanInput: { enabled: false, minDelayMs: 40, maxDelayMs: 120 }
    },
    steps
  };
}

function reloadStep(id: string) {
  return { id, type: "reload" as const, enabled: true, waitUntil: "load" as const };
}

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

class MemoryStorage implements ChromeStorageArea {
  readonly values: Record<string, unknown> = {};
  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.values ? { [key]: structuredClone(this.values[key]) } : {};
  }
  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
  }
}
