import {
  DEFAULT_NATURAL_PACING_SETTINGS,
  type NaturalPacingSettings,
  validateNaturalPacingSettings
} from "../../core/domain/natural-pacing";
import type { NaturalPacingRepository } from "../../core/ports/natural-pacing-repository";
import { NATURAL_PACING_STORAGE_KEY } from "../../shared/constants";
import type { ChromeStorageArea } from "./chrome-storage";

interface StoredNaturalPacingSettings {
  readonly version: 1;
  readonly presets: Readonly<Record<string, NaturalPacingSettings>>;
}

export class ChromeNaturalPacingRepository implements NaturalPacingRepository {
  readonly #storage: ChromeStorageArea;
  #pendingMutation: Promise<void> = Promise.resolve();

  constructor(storage: ChromeStorageArea) {
    this.#storage = storage;
  }

  async get(presetId: string): Promise<NaturalPacingSettings> {
    await this.#pendingMutation;
    const stored = await this.#read();
    return structuredClone(
      stored.presets[presetId] ?? DEFAULT_NATURAL_PACING_SETTINGS
    );
  }

  async save(presetId: string, settings: NaturalPacingSettings): Promise<void> {
    const issues = validateNaturalPacingSettings(settings);
    if (issues.length > 0) throw new Error(issues[0]);
    await this.#enqueue(async () => {
      const stored = await this.#read();
      await this.#write({
        version: 1,
        presets: { ...stored.presets, [presetId]: structuredClone(settings) }
      });
    });
  }

  async remove(presetId: string): Promise<void> {
    await this.#enqueue(async () => {
      const stored = await this.#read();
      if (!(presetId in stored.presets)) return;
      const presets = { ...stored.presets };
      delete presets[presetId];
      await this.#write({ version: 1, presets });
    });
  }

  async #read(): Promise<StoredNaturalPacingSettings> {
    const stored = await this.#storage.get(NATURAL_PACING_STORAGE_KEY);
    const candidate = stored[NATURAL_PACING_STORAGE_KEY];
    if (!isObject(candidate) || candidate.version !== 1 || !isObject(candidate.presets)) {
      return { version: 1, presets: {} };
    }
    const presets: Record<string, NaturalPacingSettings> = {};
    for (const [presetId, value] of Object.entries(candidate.presets)) {
      if (isSettings(value) && validateNaturalPacingSettings(value).length === 0) {
        presets[presetId] = structuredClone(value);
      }
    }
    return { version: 1, presets };
  }

  async #write(value: StoredNaturalPacingSettings): Promise<void> {
    await this.#storage.set({ [NATURAL_PACING_STORAGE_KEY]: structuredClone(value) });
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.#pendingMutation.then(operation, operation);
    this.#pendingMutation = result.catch(() => undefined);
    return result;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSettings(value: unknown): value is NaturalPacingSettings {
  return (
    isObject(value) &&
    typeof value.enabled === "boolean" &&
    typeof value.minimumDelaySeconds === "number" &&
    typeof value.maximumDelaySeconds === "number"
  );
}
