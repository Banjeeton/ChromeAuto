import type { PresetV1 } from "../../core/domain/preset";
import { assertValidPreset } from "../../core/domain/preset-validator";
import {
  type PresetRepository,
  PresetRepositoryDataError,
  PresetRepositoryReadError,
  PresetRepositoryWriteError,
  PresetRepositoryConflictError
} from "../../core/ports/preset-repository";

export const PRESET_STORAGE_KEY = "automation.presets.v1";

export interface ChromeStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Stores portable preset v1 objects without introducing a database layer. */
export class ChromePresetRepository implements PresetRepository {
  readonly #storage: ChromeStorageArea;
  readonly #storageKey: string;
  #pendingMutation: Promise<void> = Promise.resolve();

  constructor(
    storage: ChromeStorageArea,
    storageKey = PRESET_STORAGE_KEY
  ) {
    this.#storage = storage;
    this.#storageKey = storageKey;
  }

  async list(): Promise<readonly PresetV1[]> {
    await this.#pendingMutation;
    return Object.freeze(structuredClone(await this.#readPresets()));
  }

  async getById(presetId: string): Promise<PresetV1 | undefined> {
    const preset = (await this.list()).find((item) => item.id === presetId);
    return preset === undefined ? undefined : structuredClone(preset);
  }

  async save(preset: PresetV1): Promise<void> {
    const normalized = structuredClone(preset);
    normalized.site.hostname = normalized.site.hostname.toLowerCase();
    assertValidPreset(normalized);

    return this.#enqueueMutation(async () => {
      const presets = await this.#readPresets();
      const conflicting = presets.filter(
        (item) =>
          item.id !== normalized.id &&
          item.site.hostname.toLowerCase() === normalized.site.hostname
      );
      if (conflicting.length > 0) {
        throw new PresetRepositoryConflictError(
          normalized.site.hostname,
          conflicting.map((item) => item.id)
        );
      }

      const existingIndex = presets.findIndex(
        (item) => item.id === normalized.id
      );
      if (existingIndex === -1) {
        presets.push(normalized);
      } else {
        presets[existingIndex] = normalized;
      }
      await this.#writePresets(presets);
    });
  }

  async remove(presetId: string): Promise<boolean> {
    return this.#enqueueMutation(async () => {
      const presets = await this.#readPresets();
      const remaining = presets.filter((preset) => preset.id !== presetId);
      if (remaining.length === presets.length) {
        return false;
      }
      await this.#writePresets(remaining);
      return true;
    });
  }

  async #readPresets(): Promise<PresetV1[]> {
    let stored: Record<string, unknown>;
    try {
      stored = await this.#storage.get(this.#storageKey);
    } catch (error) {
      throw new PresetRepositoryReadError(error);
    }

    return decodePresetCollection(stored[this.#storageKey]);
  }

  async #writePresets(presets: readonly PresetV1[]): Promise<void> {
    try {
      await this.#storage.set({
        [this.#storageKey]: structuredClone(presets)
      });
    } catch (error) {
      throw new PresetRepositoryWriteError(error);
    }
  }

  #enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pendingMutation.then(operation, operation);
    this.#pendingMutation = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

function decodePresetCollection(value: unknown): PresetV1[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every(isPresetV1)) {
    throw new PresetRepositoryDataError(
      "invalid_collection",
      "Stored automation presets are not valid preset v1 objects."
    );
  }

  const presets = structuredClone(value);
  const duplicateIds = findDuplicates(presets.map((preset) => preset.id));
  if (duplicateIds.length > 0) {
    throw new PresetRepositoryDataError(
      "duplicate_preset_id",
      `Stored automation presets contain duplicate ids: ${duplicateIds.join(", ")}.`,
      duplicateIds
    );
  }

  const hostnames = presets.map((preset) =>
    preset.site.hostname.toLowerCase()
  );
  const duplicateHostnames = findDuplicates(hostnames);
  if (duplicateHostnames.length > 0) {
    throw new PresetRepositoryDataError(
      "duplicate_hostname",
      `Stored automation presets contain duplicate hostnames: ${duplicateHostnames.join(", ")}.`,
      duplicateHostnames
    );
  }

  return presets;
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}

function isPresetV1(value: unknown): value is PresetV1 {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<PresetV1>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    (candidate.description === undefined ||
      typeof candidate.description === "string") &&
    typeof candidate.site === "object" &&
    candidate.site !== null &&
    typeof candidate.site.hostname === "string" &&
    Array.isArray(candidate.site.protocols) &&
    candidate.site.protocols.every(
      (protocol) => protocol === "http" || protocol === "https"
    ) &&
    typeof candidate.automation === "object" &&
    candidate.automation !== null &&
    Array.isArray(candidate.automation.steps) &&
    typeof candidate.siteSettings === "object" &&
    candidate.siteSettings !== null
  );
}
