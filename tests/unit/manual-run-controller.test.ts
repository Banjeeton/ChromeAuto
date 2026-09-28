import { describe, expect, it, vi } from "vitest";

import { InMemoryExecutionLog } from "../../src/adapters/logging/in-memory-execution-log";
import { AutomationRunner } from "../../src/core/application/automation-runner";
import { ManualRunController } from "../../src/core/application/manual-run-controller";
import { TabSessionManager } from "../../src/core/application/tab-session-manager";
import type { PresetV1 } from "../../src/core/domain/preset";
import type { AutomationEngine } from "../../src/core/ports/automation-engine";
import type { PresetRepository } from "../../src/core/ports/preset-repository";

const PRESET_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("ManualRunController", () => {
  it("resolves and runs the enabled preset for the exact hostname", async () => {
    const engine = createEngine();
    const { controller } = createController([createPreset()], engine);

    await expect(
      controller.status(42, "https://example.com/account")
    ).resolves.toEqual({
      state: "ready",
      tabId: 42,
      hostname: "example.com",
      presetId: PRESET_ID,
      presetName: "Example automation",
      stepCount: 1
    });

    await expect(
      controller.run(42, "https://example.com/account")
    ).resolves.toMatchObject({
      presetId: PRESET_ID,
      tabId: 42,
      executedSteps: 1,
      skippedSteps: 0
    });
    expect(engine.executeStep).toHaveBeenCalledWith(
      expect.objectContaining({
        stepIndex: 0,
        step: expect.objectContaining({ id: "wait-ready" })
      })
    );
  });

  it("does not match another subdomain", async () => {
    const { controller } = createController([createPreset()]);

    await expect(
      controller.status(42, "https://shop.example.com")
    ).resolves.toMatchObject({
      state: "unavailable",
      hostname: "shop.example.com",
      reason: "no-preset"
    });
  });

  it("selects the enabled preset when an inactive alternative shares hostname", async () => {
    const disabled = createPreset({
      id: "550e8400-e29b-41d4-a716-446655440001",
      name: "Inactive alternative",
      siteSettings: {
        enabled: false,
        repeat: { enabled: false, intervalMinutes: 1 }
      }
    });
    const enabled = createPreset();
    const { controller } = createController([disabled, enabled]);

    await expect(
      controller.status(42, "https://example.com")
    ).resolves.toMatchObject({
      state: "ready",
      presetId: PRESET_ID,
      presetName: "Example automation"
    });
  });

  it("blocks disabled and empty presets before starting a session", async () => {
    const disabled = createPreset({
      siteSettings: {
        enabled: false,
        repeat: { enabled: false, intervalMinutes: 1 }
      }
    });
    const disabledController = createController([disabled]).controller;
    await expect(
      disabledController.status(42, "https://example.com")
    ).resolves.toMatchObject({
      state: "unavailable",
      reason: "preset-disabled"
    });

    const empty = createPreset({
      automation: {
        ...createPreset().automation,
        steps: []
      }
    });
    const emptyController = createController([empty]).controller;
    await expect(
      emptyController.status(42, "https://example.com")
    ).resolves.toMatchObject({
      state: "unavailable",
      reason: "invalid-preset"
    });
  });

  it("rejects Chrome internal pages", async () => {
    const { controller } = createController([createPreset()]);

    await expect(
      controller.status(42, "chrome://extensions")
    ).resolves.toMatchObject({
      state: "unavailable",
      reason: "unsupported-url"
    });
  });

  it("blocks a structurally invalid preset and reports the field path", async () => {
    const invalid = createPreset({ name: "" });
    const { controller } = createController([invalid]);

    await expect(
      controller.status(42, "https://example.com")
    ).resolves.toMatchObject({
      state: "unavailable",
      reason: "invalid-preset",
      message: expect.stringContaining("/name")
    });
  });
});

function createController(
  presets: PresetV1[],
  engine = createEngine()
): { controller: ManualRunController; sessions: TabSessionManager } {
  const repository = new MemoryPresetRepository(presets);
  const sessions = new TabSessionManager(engine, {
    createSessionId: () => "session-1"
  });
  const runner = new AutomationRunner(
    engine,
    sessions,
    new InMemoryExecutionLog(),
    { createLogEntryId: () => "log-1" }
  );
  return {
    controller: new ManualRunController(repository, runner, sessions),
    sessions
  };
}

function createEngine(): AutomationEngine {
  return {
    start: vi.fn(async (request) => ({
      sessionId: request.sessionId,
      target: request.target
    })),
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

function createPreset(overrides: Partial<PresetV1> = {}): PresetV1 {
  return {
    schemaVersion: 1,
    id: PRESET_ID,
    name: "Example automation",
    createdAt: "2026-09-27T12:00:00.000Z",
    updatedAt: "2026-09-27T12:00:00.000Z",
    site: { hostname: "example.com", protocols: ["https"] },
    automation: {
      defaults: {
        timeoutMs: 5_000,
        postActionDelayMs: 0,
        humanInput: { enabled: false, minDelayMs: 40, maxDelayMs: 120 }
      },
      steps: [
        {
          id: "wait-ready",
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

class MemoryPresetRepository implements PresetRepository {
  constructor(private readonly presets: PresetV1[]) {}

  async list(): Promise<readonly PresetV1[]> {
    return this.presets;
  }

  async getById(presetId: string): Promise<PresetV1 | undefined> {
    return this.presets.find((preset) => preset.id === presetId);
  }

  async save(preset: PresetV1): Promise<void> {
    this.presets.push(preset);
  }

  async saveIfUnchanged(preset: PresetV1): Promise<boolean> {
    this.presets.push(preset);
    return true;
  }

  async remove(presetId: string): Promise<boolean> {
    const index = this.presets.findIndex((preset) => preset.id === presetId);
    if (index === -1) {
      return false;
    }
    this.presets.splice(index, 1);
    return true;
  }
}
