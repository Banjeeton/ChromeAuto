import { describe, expect, it } from "vitest";

import {
  ChromePresetRepository,
  type ChromeStorageArea
} from "../../src/adapters/storage/chrome-storage";
import type { PresetV1 } from "../../src/core/domain/preset";
import {
  exportPresetJson,
  importPresetJsonSafely
} from "../../src/adapters/storage/preset-import-export";
import {
  PresetRepositoryConflictError,
  PresetRepositoryReadError,
  PresetRepositoryWriteError
} from "../../src/core/ports/preset-repository";
import {
  PRESET_QUARANTINE_STORAGE_KEY,
  PRESET_STORAGE_KEY
} from "../../src/shared/constants";

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

  it("atomically refuses stale or unexpected preset overwrites", async () => {
    const repository = new ChromePresetRepository(new MemoryChromeStorage());
    const original = createPreset();
    await repository.save(original);

    const changed = createPreset({
      name: "Imported automation",
      updatedAt: "2026-09-28T12:00:00.000Z"
    });
    await expect(
      repository.saveIfUnchanged(changed, null)
    ).resolves.toBe(false);
    await expect(
      repository.saveIfUnchanged(changed, "2026-09-26T12:00:00.000Z")
    ).resolves.toBe(false);
    await expect(repository.getById(PRESET_ID)).resolves.toMatchObject({
      name: "Example automation",
      updatedAt: original.updatedAt
    });

    await expect(
      repository.saveIfUnchanged(changed, original.updatedAt)
    ).resolves.toBe(true);
    await expect(repository.getById(PRESET_ID)).resolves.toMatchObject({
      name: "Imported automation",
      updatedAt: changed.updatedAt
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

  it("atomically replaces an active hostname assignment after confirmation", async () => {
    const storage = new MemoryChromeStorage();
    const repository = new ChromePresetRepository(storage);
    const current = createPreset();
    const replacement = createPreset({
      id: SECOND_PRESET_ID,
      name: "Recorded replacement",
      createdAt: "2026-09-29T12:00:00.000Z",
      updatedAt: "2026-09-29T12:00:00.000Z"
    });
    await repository.save(current);
    const writesBeforeReplacement = storage.setCalls;

    await expect(
      repository.saveReplacingActiveHostname(replacement, ["stale-id"])
    ).rejects.toBeInstanceOf(PresetRepositoryConflictError);
    await expect(repository.list()).resolves.toEqual([current]);

    await repository.saveReplacingActiveHostname(replacement, [PRESET_ID]);

    expect(storage.setCalls).toBe(writesBeforeReplacement + 1);
    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        id: PRESET_ID,
        siteSettings: expect.objectContaining({ enabled: false })
      }),
      expect.objectContaining({
        id: SECOND_PRESET_ID,
        name: "Recorded replacement",
        siteSettings: expect.objectContaining({ enabled: true })
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

  it("isolates duplicate preset ids and keeps the newest valid version", async () => {
    const storage = new MemoryChromeStorage();
    const newer = createPreset({
      name: "Newest",
      updatedAt: "2026-09-28T12:00:00.000Z"
    });
    storage.values[PRESET_STORAGE_KEY] = [createPreset(), newer];
    const repository = new ChromePresetRepository(storage);

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ id: PRESET_ID, name: "Newest" })
    ]);
    expect(storage.values[PRESET_QUARANTINE_STORAGE_KEY]).toEqual([
      expect.objectContaining({ reason: "duplicate-preset-id" })
    ]);
  });

  it("isolates duplicate active hostnames while preserving unrelated presets", async () => {
    const storage = new MemoryChromeStorage();
    const unrelated = createPreset({
      id: "550e8400-e29b-41d4-a716-446655440002",
      site: { hostname: "shop.example.com", protocols: ["https"] }
    });
    storage.values[PRESET_STORAGE_KEY] = [
      createPreset(),
      createPreset({
        id: SECOND_PRESET_ID,
        name: "New active assignment",
        updatedAt: "2026-09-28T12:00:00.000Z"
      }),
      unrelated
    ];
    const repository = new ChromePresetRepository(storage);

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ id: SECOND_PRESET_ID }),
      expect.objectContaining({ id: unrelated.id })
    ]);
    expect(storage.values[PRESET_QUARANTINE_STORAGE_KEY]).toEqual([
      expect.objectContaining({ reason: "duplicate-active-hostname" })
    ]);
  });

  it("quarantines malformed entries without hiding valid presets", async () => {
    const storage = new MemoryChromeStorage();
    storage.values[PRESET_STORAGE_KEY] = [
      createPreset(),
      { schemaVersion: 1, id: "broken", name: "Broken" }
    ];

    await expect(new ChromePresetRepository(storage).list()).resolves.toEqual([
      expect.objectContaining({ id: PRESET_ID })
    ]);
    expect(storage.values[PRESET_STORAGE_KEY]).toHaveLength(1);
    expect(storage.values[PRESET_QUARANTINE_STORAGE_KEY]).toEqual([
      expect.objectContaining({ reason: "invalid-preset" })
    ]);
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

    storage.setError = undefined;
    await expect(
      new ChromePresetRepository(storage).list()
    ).resolves.toEqual([]);
  });

  it("reports quota exhaustion and preserves the previous collection", async () => {
    const storage = new MemoryChromeStorage();
    const repository = new ChromePresetRepository(storage);
    const original = createPreset();
    await repository.save(original);
    storage.setError = new Error("QUOTA_BYTES quota exceeded");

    await expect(repository.save(createPreset({ name: "Too large" })))
      .rejects.toMatchObject({
        name: "PresetRepositoryWriteError",
        code: "quota-exceeded",
        message: expect.stringContaining("Existing presets were not changed")
      } satisfies Partial<PresetRepositoryWriteError>);

    storage.setError = undefined;
    await expect(repository.list()).resolves.toEqual([original]);
  });

  it("does not change stored data when an import is invalid", async () => {
    const storage = new MemoryChromeStorage();
    const repository = new ChromePresetRepository(storage);
    const original = createPreset();
    await repository.save(original);
    const invalid = createPreset({ name: "" });

    await expect(
      importPresetJsonSafely(JSON.stringify(invalid), repository)
    ).rejects.toMatchObject({ name: "PresetValidationError" });
    await expect(repository.list()).resolves.toEqual([original]);
  });

  it("round-trips a portable preset between independent installations", async () => {
    const sourceStorage = new MemoryChromeStorage();
    const targetStorage = new MemoryChromeStorage();
    const source = new ChromePresetRepository(sourceStorage);
    const target = new ChromePresetRepository(targetStorage);
    const preset = createPreset();
    await source.save(preset);

    const sourcePreset = await source.getById(preset.id);
    expect(sourcePreset).toBeDefined();
    const exported = exportPresetJson(sourcePreset!);
    await expect(importPresetJsonSafely(exported, target)).resolves.toMatchObject({
      status: "imported",
      preset
    });

    expect(Object.keys(JSON.parse(exported))).toEqual([
      "schemaVersion",
      "id",
      "name",
      "createdAt",
      "updatedAt",
      "site",
      "automation",
      "siteSettings"
    ]);
    expect(targetStorage.values).toEqual({ [PRESET_STORAGE_KEY]: [preset] });
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
  setCalls = 0;
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
    this.setCalls += 1;
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
