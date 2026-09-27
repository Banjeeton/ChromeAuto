import type { PresetV1 } from "../../core/domain/preset";
import {
  type PresetRepository,
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

  constructor(
    storage: ChromeStorageArea,
    storageKey = PRESET_STORAGE_KEY
  ) {
    this.#storage = storage;
    this.#storageKey = storageKey;
  }

  async list(): Promise<readonly PresetV1[]> {
    const stored = await this.#storage.get(this.#storageKey);
    const value = stored[this.#storageKey];
    if (value === undefined) {
      return Object.freeze([]);
    }
    if (!Array.isArray(value) || !value.every(isPresetV1)) {
      throw new Error("Stored automation presets are not valid preset v1 objects");
    }
    return Object.freeze(structuredClone(value));
  }

  async getById(presetId: string): Promise<PresetV1 | undefined> {
    const preset = (await this.list()).find((item) => item.id === presetId);
    return preset === undefined ? undefined : structuredClone(preset);
  }

  async save(preset: PresetV1): Promise<void> {
    const normalized = structuredClone(preset);
    normalized.site.hostname = normalized.site.hostname.toLowerCase();
    const presets = [...(await this.list())];
    const conflicting = presets.filter(
      (item) =>
        item.id !== normalized.id &&
        item.site.hostname === normalized.site.hostname
    );
    if (conflicting.length > 0) {
      throw new PresetRepositoryConflictError(
        normalized.site.hostname,
        conflicting.map((item) => item.id)
      );
    }

    const existingIndex = presets.findIndex((item) => item.id === normalized.id);
    if (existingIndex === -1) {
      presets.push(normalized);
    } else {
      presets[existingIndex] = normalized;
    }
    await this.#storage.set({ [this.#storageKey]: presets });
  }

  async remove(presetId: string): Promise<boolean> {
    const presets = [...(await this.list())];
    const remaining = presets.filter((preset) => preset.id !== presetId);
    if (remaining.length === presets.length) {
      return false;
    }
    await this.#storage.set({ [this.#storageKey]: remaining });
    return true;
  }
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
    typeof candidate.site === "object" &&
    candidate.site !== null &&
    typeof candidate.site.hostname === "string" &&
    Array.isArray(candidate.site.protocols) &&
    typeof candidate.automation === "object" &&
    candidate.automation !== null &&
    Array.isArray(candidate.automation.steps) &&
    typeof candidate.siteSettings === "object" &&
    candidate.siteSettings !== null
  );
}
