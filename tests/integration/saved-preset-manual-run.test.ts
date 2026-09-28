import { describe, expect, it, vi } from "vitest";

import {
  ChromePresetRepository,
  type ChromeStorageArea
} from "../../src/adapters/storage/chrome-storage";
import { InMemoryExecutionLog } from "../../src/adapters/logging/in-memory-execution-log";
import { AutomationRunner } from "../../src/core/application/automation-runner";
import { ManualRunController } from "../../src/core/application/manual-run-controller";
import { TabSessionManager } from "../../src/core/application/tab-session-manager";
import type { PresetV1 } from "../../src/core/domain/preset";
import type {
  AutomationEngine,
  AutomationStepExecutionResult
} from "../../src/core/ports/automation-engine";

const MAIN_PRESET_ID = "550e8400-e29b-41d4-a716-446655440000";
const SHOP_PRESET_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("saved preset manual run integration", () => {
  it("does not start until requested and explains an unmatched hostname", async () => {
    const harness = await createHarness();

    await expect(
      harness.controller.status(11, "https://example.com/account")
    ).resolves.toMatchObject({
      state: "ready",
      presetId: MAIN_PRESET_ID,
      hostname: "example.com"
    });
    expect(harness.engine.start).not.toHaveBeenCalled();

    await expect(
      harness.controller.status(12, "https://www.example.com")
    ).resolves.toEqual({
      state: "unavailable",
      tabId: 12,
      hostname: "www.example.com",
      reason: "no-preset",
      message: "No automation is assigned to www.example.com."
    });
    expect(harness.engine.start).not.toHaveBeenCalled();
  });

  it("runs saved presets through one engine in independent tab sessions", async () => {
    const harness = await createHarness();
    const firstRun = harness.controller.run(
      11,
      "https://example.com/account"
    );
    const secondRun = harness.controller.run(
      22,
      "http://shop.example.com/orders"
    );

    await vi.waitFor(() => {
      expect(harness.sessions.list()).toHaveLength(2);
      expect(harness.sessions.list()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ presetId: MAIN_PRESET_ID, tabId: 11 }),
          expect.objectContaining({ presetId: SHOP_PRESET_ID, tabId: 22 })
        ])
      );
      expect(harness.releaseSteps).toHaveLength(2);
    });

    expect(harness.engine.executeStep).toHaveBeenCalledTimes(2);
    harness.releaseSteps.forEach((release) => release());

    await expect(Promise.all([firstRun, secondRun])).resolves.toEqual([
      expect.objectContaining({ presetId: MAIN_PRESET_ID, tabId: 11 }),
      expect.objectContaining({ presetId: SHOP_PRESET_ID, tabId: 22 })
    ]);
    expect(harness.sessions.list()).toEqual([]);
    expect(harness.engine.complete).toHaveBeenCalledTimes(2);
  });
});

async function createHarness(): Promise<{
  controller: ManualRunController;
  engine: AutomationEngine;
  sessions: TabSessionManager;
  releaseSteps: Array<() => void>;
}> {
  const repository = new ChromePresetRepository(new MemoryChromeStorage());
  await repository.save(createPreset());
  await repository.save(
    createPreset({
      id: SHOP_PRESET_ID,
      name: "Shop automation",
      site: { hostname: "shop.example.com", protocols: ["http", "https"] },
      automation: {
        ...createPreset().automation,
        steps: [
          {
            id: "shop-wait",
            type: "wait",
            enabled: true,
            condition: { type: "timeout", durationMs: 1 }
          }
        ]
      }
    })
  );

  const releaseSteps: Array<() => void> = [];
  const engine: AutomationEngine = {
    start: vi.fn(async (request) => ({
      sessionId: request.sessionId,
      target: request.target
    })),
    executeStep: vi.fn(
      (request) =>
        new Promise<AutomationStepExecutionResult>((resolve) => {
          releaseSteps.push(() =>
            resolve({
              sessionId: request.sessionId,
              stepId: request.step.id,
              stepIndex: request.stepIndex
            })
          );
        })
    ),
    complete: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    stopAll: vi.fn(async () => undefined)
  };
  let sessionNumber = 0;
  const sessions = new TabSessionManager(engine, {
    createSessionId: () => `session-${++sessionNumber}`
  });
  const runner = new AutomationRunner(
    engine,
    sessions,
    new InMemoryExecutionLog(),
    { createLogEntryId: () => crypto.randomUUID() }
  );

  return {
    controller: new ManualRunController(repository, runner, sessions),
    engine,
    sessions,
    releaseSteps
  };
}

class MemoryChromeStorage implements ChromeStorageArea {
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

function createPreset(overrides: Partial<PresetV1> = {}): PresetV1 {
  return {
    schemaVersion: 1,
    id: MAIN_PRESET_ID,
    name: "Main automation",
    createdAt: "2026-09-28T08:00:00.000Z",
    updatedAt: "2026-09-28T08:00:00.000Z",
    site: { hostname: "example.com", protocols: ["https"] },
    automation: {
      defaults: {
        timeoutMs: 5_000,
        postActionDelayMs: 0,
        humanInput: { enabled: false, minDelayMs: 40, maxDelayMs: 120 }
      },
      steps: [
        {
          id: "main-wait",
          type: "wait",
          enabled: true,
          condition: { type: "timeout", durationMs: 1 }
        }
      ]
    },
    siteSettings: {
      enabled: true,
      repeat: { enabled: false, intervalMinutes: 1 }
    },
    ...overrides
  };
}
