import { describe, expect, it, vi } from "vitest";

import { InMemoryExecutionLog } from "../../src/adapters/logging/in-memory-execution-log";
import {
  ChromePresetRepository,
  type ChromeStorageArea
} from "../../src/adapters/storage/chrome-storage";
import {
  exportPresetJson,
  importPresetJsonSafely
} from "../../src/adapters/storage/preset-import-export";
import { AutomationRunner } from "../../src/core/application/automation-runner";
import { ManualRunController } from "../../src/core/application/manual-run-controller";
import {
  createPresetEditorDefaults,
  editableFieldsFromPreset,
  PresetEditorController
} from "../../src/core/application/preset-editor";
import { TabSessionManager } from "../../src/core/application/tab-session-manager";
import type { AutomationEngine } from "../../src/core/ports/automation-engine";

const PRESET_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("Preset Management MVP integration", () => {
  it("completes CRUD, export, import and a manual run through real application services", async () => {
    const repository = new ChromePresetRepository(new MemoryChromeStorage());
    let currentTime = new Date("2026-09-28T08:00:00.000Z");
    const editor = new PresetEditorController(repository, {
      createId: () => PRESET_ID,
      now: () => currentTime
    });
    const fields = createPresetEditorDefaults("example.com", "https");
    fields.name = "Checkout smoke test";
    fields.description = "Created by the Preset Management integration test.";
    fields.automation.steps = [
      {
        id: "wait-before-checkout",
        type: "wait",
        name: "Wait before checkout",
        enabled: true,
        condition: { type: "timeout", durationMs: 1 }
      }
    ];

    const created = await editor.create(fields);
    await expect(repository.getById(PRESET_ID)).resolves.toEqual(created);

    currentTime = new Date("2026-09-28T09:00:00.000Z");
    const editedFields = editableFieldsFromPreset(created);
    editedFields.name = "Updated checkout smoke test";
    editedFields.siteSettings.repeat = {
      enabled: true,
      intervalMinutes: 5
    };
    const updated = await editor.update(PRESET_ID, editedFields);

    expect(updated).toMatchObject({
      id: created.id,
      createdAt: created.createdAt,
      updatedAt: currentTime.toISOString(),
      name: "Updated checkout smoke test",
      siteSettings: {
        repeat: { enabled: true, intervalMinutes: 5 }
      }
    });

    const exportedJson = exportPresetJson(updated);
    expect(JSON.parse(exportedJson)).toEqual(updated);
    expect(JSON.parse(exportedJson)).not.toHaveProperty("runtimeState");

    await expect(editor.remove(PRESET_ID)).resolves.toEqual(updated);
    await expect(repository.list()).resolves.toEqual([]);

    await expect(
      importPresetJsonSafely(exportedJson, repository)
    ).resolves.toMatchObject({
      status: "imported",
      preset: { id: PRESET_ID, name: "Updated checkout smoke test" }
    });
    await expect(repository.getById(PRESET_ID)).resolves.toEqual(updated);

    const engine = createAutomationEngine();
    const sessions = new TabSessionManager(engine, {
      createSessionId: () => "preset-management-session"
    });
    const runner = new AutomationRunner(
      engine,
      sessions,
      new InMemoryExecutionLog(),
      { createLogEntryId: () => "preset-management-log" }
    );
    const manualRun = new ManualRunController(repository, runner, sessions);

    await expect(
      manualRun.status(42, "https://example.com/checkout")
    ).resolves.toMatchObject({
      state: "ready",
      presetId: PRESET_ID,
      hostname: "example.com",
      stepCount: 1
    });
    await expect(
      manualRun.run(42, "https://example.com/checkout")
    ).resolves.toMatchObject({
      presetId: PRESET_ID,
      tabId: 42,
      executedSteps: 1,
      skippedSteps: 0
    });
    expect(engine.start).toHaveBeenCalledOnce();
    expect(engine.executeStep).toHaveBeenCalledOnce();
    expect(engine.complete).toHaveBeenCalledOnce();
  });

  it("keeps stored data unchanged when an imported preset is invalid", async () => {
    const repository = new ChromePresetRepository(new MemoryChromeStorage());
    const editor = new PresetEditorController(repository, {
      createId: () => PRESET_ID,
      now: () => new Date("2026-09-28T08:00:00.000Z")
    });
    const fields = createPresetEditorDefaults("example.com", "https");
    fields.name = "Stored preset";
    const stored = await editor.create(fields);
    const invalid = JSON.stringify({
      ...stored,
      name: "",
      site: { hostname: "https://example.com", protocols: ["https"] }
    });

    await expect(
      importPresetJsonSafely(invalid, repository)
    ).rejects.toMatchObject({ name: "PresetValidationError" });
    await expect(repository.list()).resolves.toEqual([stored]);
  });
});

function createAutomationEngine(): AutomationEngine {
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
