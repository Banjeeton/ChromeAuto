import { describe, expect, it } from "vitest";

import { RepeatCycleStatusController } from "../../src/core/application/repeat-cycle-status-controller";
import type { PresetV1 } from "../../src/core/domain/preset";

describe("RepeatCycleStatusController", () => {
  it("exposes Running and Waiting with tab, interval and next run", async () => {
    const preset = createPreset();
    const controller = new RepeatCycleStatusController(
      {
        list: async () => [
          { tabId: 1, presetId: preset.id, state: "running" },
          {
            tabId: 2,
            presetId: preset.id,
            state: "waiting",
            nextRunAt: 1_800_000_000_000
          },
          { tabId: 3, presetId: preset.id, state: "stopped" }
        ]
      },
      { list: async () => [preset] }
    );

    await expect(controller.list()).resolves.toEqual([
      {
        tabId: 1,
        presetId: preset.id,
        presetName: preset.name,
        hostname: "example.com",
        state: "running",
        intervalMinutes: 5
      },
      {
        tabId: 2,
        presetId: preset.id,
        presetName: preset.name,
        hostname: "example.com",
        state: "waiting",
        intervalMinutes: 5,
        nextRunAt: 1_800_000_000_000
      }
    ]);
  });
});

function createPreset(): PresetV1 {
  return {
    schemaVersion: 1,
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "Repeat status test",
    createdAt: "2026-09-28T12:00:00.000Z",
    updatedAt: "2026-09-28T12:00:00.000Z",
    site: { hostname: "example.com", protocols: ["https"] },
    automation: {
      defaults: {
        timeoutMs: 5_000,
        postActionDelayMs: 0,
        humanInput: { enabled: false, minDelayMs: 40, maxDelayMs: 120 }
      },
      steps: []
    },
    siteSettings: {
      enabled: true,
      repeat: { enabled: true, intervalMinutes: 5 }
    }
  };
}
