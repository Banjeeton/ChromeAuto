import { describe, expect, it } from "vitest";

import {
  ChromePresetRepository,
  type ChromeStorageArea
} from "../../src/adapters/storage/chrome-storage";
import type { PresetV1 } from "../../src/core/domain/preset";
import {
  PresetRepositoryConflictError,
  PresetRepositoryDataError,
  PresetRepositoryReadError,
  PresetRepositoryWriteError
} from "../../src/core/ports/preset-repository";

const PRESET_ID = "550e8400-e29b-41d4-a716-446655440000";
const SECOND_PRESET_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("Chrome storage adapter", () => {
  it("stores, updates and removes preset v1 objects", async () => {
    const storage = new MemoryChromeStorage();
    const repository = new ChromePresetRepository(storage);
    const preset = createPreset();

    await repository.save(preset);
    preset.name = "Changed outside storage";

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        id: PRESET_ID,
        name: "Example automation",
        site: expect.objectContaining({ hostname: "example.com" })
      })
    ]);
    await expect(repository.getById(PRESET_ID)).resolves.toMatchObject({
      id: PRESET_ID
    });

    await repository.save(createPreset({ name: "Updated automation" }));
    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        id: PRESET_ID,
        name: "Updated automation"
      })
    ]);
    await expect(repository.remove(PRESET_ID)).resolves.toBe(true);
    await expect(repository.list()).resolves.toEqual([]);
    await expect(repository.remove("missing")).resolves.toBe(false);
  });

  it("persists presets across repository instances", async () => {
    const storage = new MemoryChromeStorage();
    await new ChromePresetRepository(storage).save(createPreset());

    await expect(
      new ChromePresetRepository(storage).getById(PRESET_ID)
    ).resolves.toMatchObject({
      id: PRESET_ID,
      name: "Example automation"
    });
  });

  it("serializes concurrent mutations without losing presets", async () => {
    const repository = new ChromePresetRepository(new MemoryChromeStorage());

    await Promise.all([
      repository.save(createPreset()),
      repository.save(
        createPreset({
          id: SECOND_PRESET_ID,
          site: { hostname: "shop.example.com", protocols: ["https"] }
        })
      )
    ]);

    await expect(repository.list()).resolves.toHaveLength(2);
  });

  it("normalizes hostnames and rejects two active presets per hostname", async () => {
    const repository = new ChromePresetRepository(new MemoryChromeStorage());
    await repository.save(createPreset({ site: {
      hostname: "EXAMPLE.COM",
      protocols: ["https"]
    } }));

    await expect(
      repository.save(
        createPreset({
          id: SECOND_PRESET_ID,
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

  it("allows inactive presets for the same hostname", async () => {
    const repository = new ChromePresetRepository(new MemoryChromeStorage());
    await repository.save(createPreset());
    await repository.save(
      createPreset({
        id: SECOND_PRESET_ID,
        name: "Inactive alternative",
        siteSettings: {
          enabled: false,
          repeat: { enabled: false, intervalMinutes: 1 }
        }
      })
    );

    await expect(repository.list()).resolves.toHaveLength(2);
    await expect(
      repository.save(
        createPreset({
          id: SECOND_PRESET_ID,
          name: "Now active",
          siteSettings: {
            enabled: true,
            repeat: { enabled: false, intervalMinutes: 1 }
          }
        })
      )
    ).rejects.toBeInstanceOf(PresetRepositoryConflictError);
    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ id: PRESET_ID, name: "Example automation" }),
      expect.objectContaining({
        id: SECOND_PRESET_ID,
        name: "Inactive alternative",
        siteSettings: expect.objectContaining({ enabled: false })
      })
    ]);
  });

  it("allows active presets for exact but different hostnames", async () => {
    const repository = new ChromePresetRepository(new MemoryChromeStorage());
    await Promise.all([
      repository.save(createPreset()),
      repository.save(
        createPreset({
          id: SECOND_PRESET_ID,
          site: { hostname: "www.example.com", protocols: ["http"] }
        })
      )
    ]);

    await expect(repository.list()).resolves.toHaveLength(2);
  });

  it("rejects stored collections with duplicate preset ids", async () => {
    const storage = new MemoryChromeStorage();
    storage.values["automation.presets.v1"] = [createPreset(), createPreset()];
    const repository = new ChromePresetRepository(storage);

    await expect(repository.list()).rejects.toMatchObject({
      name: "PresetRepositoryDataError",
      code: "duplicate_preset_id",
      values: [PRESET_ID]
    } satisfies Partial<PresetRepositoryDataError>);
  });

  it("rejects stored collections with duplicate active hostnames", async () => {
    const storage = new MemoryChromeStorage();
    storage.values["automation.presets.v1"] = [
      createPreset(),
      createPreset({ id: SECOND_PRESET_ID })
    ];
    const repository = new ChromePresetRepository(storage);

    await expect(repository.list()).rejects.toMatchObject({
      name: "PresetRepositoryDataError",
      code: "duplicate_active_hostname",
      values: ["example.com"]
    } satisfies Partial<PresetRepositoryDataError>);
  });

  it("returns detached values that cannot mutate storage", async () => {
    const repository = new ChromePresetRepository(new MemoryChromeStorage());
    await repository.save(createPreset());

    const listed = await repository.list();
    listed[0].name = "Changed outside repository";
    const loaded = await repository.getById(PRESET_ID);
    if (loaded !== undefined) {
      loaded.site.hostname = "changed.example.com";
    }

    await expect(repository.getById(PRESET_ID)).resolves.toMatchObject({
      name: "Example automation",
      site: { hostname: "example.com" }
    });
  });

  it("wraps storage read failures in a typed error", async () => {
    const cause = new Error("get failed");
    const storage = new MemoryChromeStorage();
    storage.getError = cause;

    await expect(
      new ChromePresetRepository(storage).list()
    ).rejects.toMatchObject({
      name: "PresetRepositoryReadError",
      operation: "read",
      cause
    } satisfies Partial<PresetRepositoryReadError>);
  });

  it("wraps storage write failures in a typed error", async () => {
    const cause = new Error("set failed");
    const storage = new MemoryChromeStorage();
    storage.setError = cause;

    await expect(
      new ChromePresetRepository(storage).save(createPreset())
    ).rejects.toMatchObject({
      name: "PresetRepositoryWriteError",
      operation: "write",
      cause
    } satisfies Partial<PresetRepositoryWriteError>);
  });

  it("rejects an invalid preset before writing to storage", async () => {
    const storage = new MemoryChromeStorage();
    const invalid = createPreset({ name: "" });

    await expect(
      new ChromePresetRepository(storage).save(invalid)
    ).rejects.toMatchObject({
      name: "PresetValidationError",
      issues: [
        expect.objectContaining({
          path: "/name"
        })
      ]
    });
    expect(storage.values).toEqual({});
  });
});

class MemoryChromeStorage implements ChromeStorageArea {
  readonly values: Record<string, unknown> = {};
  getError?: Error;
  setError?: Error;

  async get(key: string): Promise<Record<string, unknown>> {
    if (this.getError !== undefined) {
      throw this.getError;
    }
    return key in this.values ? { [key]: structuredClone(this.values[key]) } : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    if (this.setError !== undefined) {
      throw this.setError;
    }
    Object.assign(this.values, structuredClone(items));
  }
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
      steps: []
    },
    siteSettings: {
      enabled: true,
      repeat: { enabled: false, intervalMinutes: 1 }
    },
    ...overrides
  };
}
