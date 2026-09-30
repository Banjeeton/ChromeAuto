import type { PresetV1 } from "../../core/domain/preset";
import {
  assertValidPreset,
  validatePreset
} from "../../core/domain/preset-validator";
import {
  PRESET_QUARANTINE_STORAGE_KEY,
  PRESET_STORAGE_KEY
} from "../../shared/constants";
import {
  type PresetRepository,
  PresetRepositoryDataError,
  PresetRepositoryReadError,
  PresetRepositoryWriteError,
  PresetRepositoryConflictError
} from "../../core/ports/preset-repository";

export interface ChromeStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface QuarantinedPresetRecord {
  readonly reason:
    | "invalid-collection"
    | "invalid-preset"
    | "duplicate-preset-id"
    | "duplicate-active-hostname";
  readonly capturedAt: string;
  readonly value: unknown;
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
    await this.#save(preset, undefined);
  }

  async saveIfUnchanged(
    preset: PresetV1,
    expectedUpdatedAt: string | null
  ): Promise<boolean> {
    return this.#save(preset, expectedUpdatedAt);
  }

  async saveReplacingActiveHostname(
    preset: PresetV1,
    expectedActivePresetIds: readonly string[]
  ): Promise<void> {
    const normalized = normalizePreset(preset);
    await this.#enqueueMutation(async () => {
      const presets = await this.#readPresets();
      if (presets.some((item) => item.id === normalized.id)) {
        throw new PresetRepositoryDataError(
          "duplicate_preset_id",
          `Preset id ${normalized.id} already exists.`,
          [normalized.id]
        );
      }

      const conflicting = presets.filter(
        (item) =>
          item.siteSettings.enabled &&
          item.site.hostname.toLowerCase() === normalized.site.hostname
      );
      const actualIds = conflicting.map(({ id }) => id).sort();
      const expectedIds = [...new Set(expectedActivePresetIds)].sort();
      if (!sameStrings(actualIds, expectedIds)) {
        throw new PresetRepositoryConflictError(
          normalized.site.hostname,
          actualIds
        );
      }

      const conflictIds = new Set(actualIds);
      const replaced = presets.map((item) => {
        if (!conflictIds.has(item.id)) {
          return item;
        }
        const disabled: PresetV1 = {
          ...item,
          updatedAt: nextUpdatedAt(item.updatedAt, normalized.updatedAt),
          siteSettings: { ...item.siteSettings, enabled: false }
        };
        assertValidPreset(disabled);
        return disabled;
      });
      replaced.push(normalized);
      await this.#writePresets(replaced);
    });
  }

  async #save(
    preset: PresetV1,
    expectedUpdatedAt: string | null | undefined
  ): Promise<boolean> {
    const normalized = normalizePreset(preset);

    return this.#enqueueMutation(async () => {
      const presets = await this.#readPresets();
      const existingIndex = presets.findIndex(
        (item) => item.id === normalized.id
      );
      if (
        expectedUpdatedAt !== undefined &&
        (expectedUpdatedAt === null
          ? existingIndex !== -1
          : existingIndex === -1 ||
            presets[existingIndex].updatedAt !== expectedUpdatedAt)
      ) {
        return false;
      }

      const conflicting = presets.filter(
        (item) =>
          item.id !== normalized.id &&
          normalized.siteSettings.enabled &&
          item.siteSettings.enabled &&
          item.site.hostname.toLowerCase() === normalized.site.hostname
      );
      if (conflicting.length > 0) {
        throw new PresetRepositoryConflictError(
          normalized.site.hostname,
          conflicting.map((item) => item.id)
        );
      }

      if (existingIndex === -1) {
        presets.push(normalized);
      } else {
        presets[existingIndex] = normalized;
      }
      await this.#writePresets(presets);
      return true;
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

    const decoded = decodePresetCollection(stored[this.#storageKey]);
    if (decoded.needsRepair) {
      try {
        await this.#storage.set({
          [this.#storageKey]: structuredClone(decoded.presets),
          [PRESET_QUARANTINE_STORAGE_KEY]: structuredClone(
            decoded.quarantined.slice(-20)
          )
        });
      } catch (error) {
        throw new PresetRepositoryWriteError(error);
      }
    }
    return decoded.presets;
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

function normalizePreset(preset: PresetV1): PresetV1 {
  const normalized = structuredClone(preset);
  normalized.site.hostname = normalized.site.hostname.toLowerCase();
  assertValidPreset(normalized);
  return normalized;
}

interface DecodedPresetCollection {
  readonly presets: PresetV1[];
  readonly quarantined: QuarantinedPresetRecord[];
  readonly needsRepair: boolean;
}

function decodePresetCollection(value: unknown): DecodedPresetCollection {
  if (value === undefined) {
    return { presets: [], quarantined: [], needsRepair: false };
  }
  if (!Array.isArray(value)) {
    return {
      presets: [],
      quarantined: [quarantine("invalid-collection", value)],
      needsRepair: true
    };
  }

  const quarantined: QuarantinedPresetRecord[] = [];
  const valid: PresetV1[] = [];
  for (const candidate of value) {
    if (validatePreset(candidate).length > 0) {
      quarantined.push(quarantine("invalid-preset", candidate));
      continue;
    }
    valid.push(structuredClone(candidate as PresetV1));
  }

  const byId = new Map<string, PresetV1>();
  for (const preset of valid) {
    const existing = byId.get(preset.id);
    if (existing === undefined) {
      byId.set(preset.id, preset);
      continue;
    }
    const [winner, loser] = newestPreset(existing, preset);
    byId.set(preset.id, winner);
    quarantined.push(quarantine("duplicate-preset-id", loser));
  }

  const accepted: PresetV1[] = [];
  const activeIndexByHostname = new Map<string, number>();
  for (const preset of byId.values()) {
    if (!preset.siteSettings.enabled) {
      accepted.push(preset);
      continue;
    }
    const hostname = preset.site.hostname.toLowerCase();
    const existingIndex = activeIndexByHostname.get(hostname);
    if (existingIndex === undefined) {
      activeIndexByHostname.set(hostname, accepted.length);
      accepted.push(preset);
      continue;
    }
    const existing = accepted[existingIndex];
    const [winner, loser] = newestPreset(existing, preset);
    accepted[existingIndex] = winner;
    quarantined.push(quarantine("duplicate-active-hostname", loser));
  }

  return {
    presets: accepted,
    quarantined,
    needsRepair: quarantined.length > 0
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function nextUpdatedAt(previous: string, proposed: string): string {
  const next = Math.max(Date.parse(previous) + 1, Date.parse(proposed));
  return new Date(next).toISOString();
}

function newestPreset(left: PresetV1, right: PresetV1): [PresetV1, PresetV1] {
  return Date.parse(right.updatedAt) > Date.parse(left.updatedAt)
    ? [right, left]
    : [left, right];
}

function quarantine(
  reason: QuarantinedPresetRecord["reason"],
  value: unknown
): QuarantinedPresetRecord {
  return {
    reason,
    capturedAt: new Date().toISOString(),
    value: structuredClone(value)
  };
}
