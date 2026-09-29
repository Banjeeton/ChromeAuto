import { describe, expect, it, vi } from "vitest";

import { InMemoryExecutionLog } from "../../src/adapters/logging/in-memory-execution-log";
import {
  ChromeRecorderSessionRegistry,
  type ChromeRecorderSessionStorageArea
} from "../../src/adapters/storage/chrome-recorder-session-registry";
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
import { RecordedPresetController } from "../../src/core/application/recorded-preset-controller";
import { TabSessionManager } from "../../src/core/application/tab-session-manager";
import type { AutomationEngine } from "../../src/core/ports/automation-engine";
import type { RecorderSessionRecord } from "../../src/core/ports/recorder-session-registry";

const RECORDED_PRESET_ID = "550e8400-e29b-41d4-a716-446655440050";
const EXISTING_PRESET_ID = "550e8400-e29b-41d4-a716-446655440051";

describe("recorded draft to portable preset integration", () => {
  it("creates, exports, imports and runs a portable preset", async () => {
    const recorderRegistry = new ChromeRecorderSessionRegistry(
      new MemoryStorage()
    );
    const presetRepository = new ChromePresetRepository(new MemoryStorage());
    await recorderRegistry.save(stoppedRecording());
    const controller = new RecordedPresetController(
      recorderRegistry,
      presetRepository,
      {
        createId: () => RECORDED_PRESET_ID,
        now: () => new Date("2026-09-29T16:00:00.000Z")
      }
    );

    const result = await controller.save({
      tabId: 17,
      sessionId: "recorder-17",
      name: "Recorded checkout",
      description: "Created from recorder draft",
      steps: stoppedRecording().draftSteps
    });

    expect(result).toMatchObject({
      status: "saved",
      preset: {
        id: RECORDED_PRESET_ID,
        name: "Recorded checkout",
        createdAt: "2026-09-29T16:00:00.000Z",
        updatedAt: "2026-09-29T16:00:00.000Z",
        site: { hostname: "example.com", protocols: ["https"] }
      }
    });
    if (result.status !== "saved") {
      throw new Error("Expected the recorded preset to be saved.");
    }
    await expect(recorderRegistry.getByTabId(17)).resolves.toBeUndefined();

    const exported = exportPresetJson(result.preset);
    const portable = JSON.parse(exported) as Record<string, unknown>;
    expect(portable).not.toHaveProperty("sessionId");
    expect(portable).not.toHaveProperty("tabId");
    expect(portable).not.toHaveProperty("recordedEvents");
    expect(portable).not.toHaveProperty("draftSteps");
    expect(exported).not.toContain('"sessionId"');
    expect(exported).not.toContain('"recordedEvents"');

    const importedRepository = new ChromePresetRepository(new MemoryStorage());
    await expect(
      importPresetJsonSafely(exported, importedRepository)
    ).resolves.toMatchObject({ status: "imported" });

    const engine = automationEngine();
    const sessions = new TabSessionManager(engine, {
      createSessionId: () => "run-recorded-preset"
    });
    const runner = new AutomationRunner(
      engine,
      sessions,
      new InMemoryExecutionLog()
    );
    const manualRun = new ManualRunController(
      importedRepository,
      runner,
      sessions
    );
    await expect(
      manualRun.run(17, "https://example.com/checkout")
    ).resolves.toMatchObject({
      presetId: RECORDED_PRESET_ID,
      tabId: 17,
      executedSteps: 1
    });
    expect(engine.executeStep).toHaveBeenCalledOnce();
  });

  it("requires confirmation without changing storage, then replaces atomically", async () => {
    const recorderRegistry = new ChromeRecorderSessionRegistry(
      new MemoryStorage()
    );
    const localStorage = new MemoryStorage();
    const presetRepository = new ChromePresetRepository(localStorage);
    await recorderRegistry.save(stoppedRecording());
    await presetRepository.save(existingPreset());
    const controller = new RecordedPresetController(
      recorderRegistry,
      presetRepository,
      {
        createId: () => RECORDED_PRESET_ID,
        now: () => new Date("2026-09-29T16:00:00.000Z")
      }
    );
    const request = {
      tabId: 17,
      sessionId: "recorder-17",
      name: "Recorded checkout",
      steps: stoppedRecording().draftSteps
    };
    const before = structuredClone(localStorage.values);

    const pending = await controller.save(request);

    expect(pending).toEqual({
      status: "confirmation-required",
      hostname: "example.com",
      activePresets: [{ id: EXISTING_PRESET_ID, name: "Existing checkout" }]
    });
    expect(localStorage.values).toEqual(before);
    await expect(recorderRegistry.getByTabId(17)).resolves.toBeDefined();

    const saved = await controller.save({
      ...request,
      confirmedActivePresetIds: [EXISTING_PRESET_ID]
    });

    expect(saved.status).toBe("saved");
    await expect(presetRepository.list()).resolves.toEqual([
      expect.objectContaining({
        id: EXISTING_PRESET_ID,
        siteSettings: expect.objectContaining({ enabled: false })
      }),
      expect.objectContaining({
        id: RECORDED_PRESET_ID,
        siteSettings: expect.objectContaining({ enabled: true })
      })
    ]);
  });

  it("rejects an invalid recorded preset before changing either repository", async () => {
    const recorderRegistry = new ChromeRecorderSessionRegistry(
      new MemoryStorage()
    );
    const localStorage = new MemoryStorage();
    const presetRepository = new ChromePresetRepository(localStorage);
    await recorderRegistry.save(stoppedRecording());
    const controller = new RecordedPresetController(
      recorderRegistry,
      presetRepository,
      { createId: () => RECORDED_PRESET_ID }
    );

    await expect(
      controller.save({
        tabId: 17,
        sessionId: "recorder-17",
        name: "",
        steps: []
      })
    ).rejects.toMatchObject({
      name: "PresetValidationError",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: expect.stringMatching(/^\/(name|automation)/) })
      ])
    });
    await expect(presetRepository.list()).resolves.toEqual([]);
    await expect(recorderRegistry.getByTabId(17)).resolves.toBeDefined();
  });

  it("retries id generation instead of overwriting an existing preset", async () => {
    const recorderRegistry = new ChromeRecorderSessionRegistry(
      new MemoryStorage()
    );
    const presetRepository = new ChromePresetRepository(new MemoryStorage());
    await recorderRegistry.save(stoppedRecording());
    await presetRepository.save({
      ...existingPreset(),
      site: { hostname: "other.example.com", protocols: ["https"] }
    });
    const ids = [EXISTING_PRESET_ID, RECORDED_PRESET_ID];
    const controller = new RecordedPresetController(
      recorderRegistry,
      presetRepository,
      { createId: () => ids.shift() ?? RECORDED_PRESET_ID }
    );

    const result = await controller.save({
      tabId: 17,
      sessionId: "recorder-17",
      name: "Unique recorded preset",
      steps: stoppedRecording().draftSteps
    });

    expect(result).toMatchObject({
      status: "saved",
      preset: { id: RECORDED_PRESET_ID }
    });
    await expect(presetRepository.list()).resolves.toHaveLength(2);
  });
});

function stoppedRecording(): RecorderSessionRecord {
  return {
    session: {
      sessionId: "recorder-17",
      tabId: 17,
      context: {
        url: "https://example.com/checkout",
        hostname: "example.com",
        protocol: "https"
      },
      startedAt: "2026-09-29T15:00:00.000Z",
      recordedEventCount: 1,
      state: "stopped",
      stopReason: "user",
      stoppedAt: "2026-09-29T15:05:00.000Z"
    },
    documentId: "document-17",
    currentUrl: "https://example.com/checkout",
    recordedEvents: [
      {
        version: 1,
        eventId: "click-checkout",
        sessionId: "recorder-17",
        tabId: 17,
        documentId: "document-17",
        occurredAt: "2026-09-29T15:01:00.000Z",
        url: "https://example.com/checkout",
        kind: "click",
        target: { locators: [{ type: "testId", value: "checkout" }] },
        payload: { button: "left", clickCount: 1, modifiers: [] }
      }
    ],
    draftSteps: [
      {
        id: "wait-checkout",
        type: "wait",
        enabled: true,
        condition: { type: "timeout", durationMs: 1 }
      }
    ]
  };
}

function existingPreset() {
  return {
    schemaVersion: 1 as const,
    id: EXISTING_PRESET_ID,
    name: "Existing checkout",
    createdAt: "2026-09-28T12:00:00.000Z",
    updatedAt: "2026-09-28T12:00:00.000Z",
    site: { hostname: "example.com", protocols: ["https" as const] },
    automation: {
      defaults: {
        timeoutMs: 10_000,
        postActionDelayMs: 0,
        humanInput: { enabled: false, minDelayMs: 40, maxDelayMs: 120 }
      },
      steps: [
        {
          id: "wait-existing",
          type: "wait" as const,
          enabled: true,
          condition: { type: "timeout" as const, durationMs: 1 }
        }
      ]
    },
    siteSettings: {
      enabled: true,
      repeat: { enabled: false, intervalMinutes: 1 }
    }
  };
}

function automationEngine(): AutomationEngine {
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

class MemoryStorage
  implements ChromeStorageArea, ChromeRecorderSessionStorageArea
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
