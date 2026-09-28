import { describe, expect, it } from "vitest";

import {
  ChromePresetRepository,
  type ChromeStorageArea
} from "../../src/adapters/storage/chrome-storage";
import type { PresetV1 } from "../../src/core/domain/preset";
import validPresetJson from "../fixtures/presets/valid-full.json";

describe("preset repository", () => {
  it("creates, reads, updates and deletes detached preset values", async () => {
    const storage = new MemoryStorage();
    const repository = new ChromePresetRepository(storage);
    const original = createPreset();

    await repository.save(original);
    original.name = "Changed outside repository";
    await expect(repository.getById(original.id)).resolves.toMatchObject({
      name: validPresetJson.name
    });

    const updated = createPreset();
    updated.name = "Updated preset";
    await repository.save(updated);
    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ id: updated.id, name: "Updated preset" })
    ]);

    await expect(repository.remove(updated.id)).resolves.toBe(true);
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("validates before writing and keeps the stored collection unchanged", async () => {
    const storage = new MemoryStorage();
    const repository = new ChromePresetRepository(storage);
    const stored = createPreset();
    await repository.save(stored);
    const writesBeforeFailure = storage.writeCount;
    const invalid = createPreset();
    invalid.name = "";

    await expect(repository.save(invalid)).rejects.toMatchObject({
      name: "PresetValidationError",
      issues: [expect.objectContaining({ path: "/name" })]
    });
    expect(storage.writeCount).toBe(writesBeforeFailure);
    await expect(repository.list()).resolves.toEqual([stored]);
  });
});

function createPreset(): PresetV1 {
  return structuredClone(validPresetJson) as PresetV1;
}

class MemoryStorage implements ChromeStorageArea {
  readonly values: Record<string, unknown> = {};
  writeCount = 0;

  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.values
      ? { [key]: structuredClone(this.values[key]) }
      : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.writeCount += 1;
    Object.assign(this.values, structuredClone(items));
  }
}
