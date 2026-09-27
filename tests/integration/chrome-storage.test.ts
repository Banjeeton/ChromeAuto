import { describe, expect, it } from "vitest";

import {
  ChromePresetRepository,
  type ChromeStorageArea
} from "../../src/adapters/storage/chrome-storage";
import type { PresetV1 } from "../../src/core/domain/preset";
import { PresetRepositoryConflictError } from "../../src/core/ports/preset-repository";

describe("Chrome storage adapter", () => {
  it("stores, updates and removes preset v1 objects", async () => {
    const storage = new MemoryChromeStorage();
    const repository = new ChromePresetRepository(storage);
    const preset = createPreset();

    await repository.save(preset);
    preset.name = "Changed outside storage";

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        id: "preset-1",
        name: "Example automation",
        site: expect.objectContaining({ hostname: "example.com" })
      })
    ]);
    await expect(repository.getById("preset-1")).resolves.toMatchObject({
      id: "preset-1"
    });
    await expect(repository.remove("preset-1")).resolves.toBe(true);
    await expect(repository.list()).resolves.toEqual([]);
    await expect(repository.remove("missing")).resolves.toBe(false);
  });

  it("normalizes hostnames and enforces one preset per hostname", async () => {
    const repository = new ChromePresetRepository(new MemoryChromeStorage());
    await repository.save(createPreset({ site: {
      hostname: "EXAMPLE.COM",
      protocols: ["https"]
    } }));

    await expect(
      repository.save(
        createPreset({
          id: "preset-2",
          site: { hostname: "example.com", protocols: ["http"] }
        })
      )
    ).rejects.toBeInstanceOf(PresetRepositoryConflictError);
    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        site: expect.objectContaining({ hostname: "example.com" })
      })
    ]);
  });
});

class MemoryChromeStorage implements ChromeStorageArea {
  readonly values: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.values ? { [key]: structuredClone(this.values[key]) } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
  }
}

function createPreset(overrides: Partial<PresetV1> = {}): PresetV1 {
  return {
    schemaVersion: 1,
    id: "preset-1",
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
      steps: []
    },
    siteSettings: {
      enabled: true,
      repeat: { enabled: false, intervalMinutes: 1 }
    },
    ...overrides
  };
}
