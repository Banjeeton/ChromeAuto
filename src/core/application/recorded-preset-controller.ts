import { createPresetV1 } from "./preset-editor";
import type { AutomationStep } from "../domain/automation-step";
import type { PresetV1 } from "../domain/preset";
import { RecorderError } from "../domain/recorder-error";
import { assertRunnablePreset } from "../domain/preset-validator";
import {
  PresetRepositoryConflictError,
  type PresetRepository
} from "../ports/preset-repository";
import type { RecorderSessionRegistry } from "../ports/recorder-session-registry";

export interface SaveRecordedPresetRequest {
  readonly tabId: number;
  readonly sessionId: string;
  readonly name: string;
  readonly description?: string;
  readonly steps: readonly AutomationStep[];
  readonly confirmedActivePresetIds?: readonly string[];
}

export type SaveRecordedPresetResult =
  | { readonly status: "saved"; readonly preset: PresetV1 }
  | {
      readonly status: "confirmation-required";
      readonly hostname: string;
      readonly activePresets: readonly {
        readonly id: string;
        readonly name: string;
      }[];
    };

export interface RecordedPresetControllerOptions {
  readonly createId?: () => string;
  readonly now?: () => Date;
}

/** Converts a stopped recorder draft into a portable preset v1. */
export class RecordedPresetController {
  readonly #createId: () => string;
  readonly #now: () => Date;

  constructor(
    readonly recorderSessions: RecorderSessionRegistry,
    readonly presets: PresetRepository,
    options: RecordedPresetControllerOptions = {}
  ) {
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#now = options.now ?? (() => new Date());
  }

  async save(
    request: SaveRecordedPresetRequest
  ): Promise<SaveRecordedPresetResult> {
    const record = await this.recorderSessions.getByTabId(request.tabId);
    if (record === undefined || record.session.sessionId !== request.sessionId) {
      throw new RecorderError(
        "session-not-found",
        "The recorded draft no longer exists for this tab.",
        { context: { tabId: request.tabId, sessionId: request.sessionId } }
      );
    }
    if (
      record.session.state !== "stopped" &&
      record.session.state !== "failed"
    ) {
      throw new RecorderError(
        "session-conflict",
        "Stop recording before saving it as a preset.",
        { context: { tabId: request.tabId, sessionId: request.sessionId } }
      );
    }

    const existing = await this.presets.list();
    const existingIds = new Set(existing.map(({ id }) => id));
    const preset = this.#createValidatedPreset(request, record, existingIds);
    const activeConflicts = existing.filter(
      (preset) =>
        preset.siteSettings.enabled &&
        preset.site.hostname.toLowerCase() ===
          record.session.context.hostname.toLowerCase()
    );
    const conflictIds = activeConflicts.map(({ id }) => id).sort();
    const confirmedIds = [...new Set(request.confirmedActivePresetIds ?? [])]
      .sort();
    if (conflictIds.length > 0 && !sameStrings(conflictIds, confirmedIds)) {
      return {
        status: "confirmation-required",
        hostname: record.session.context.hostname,
        activePresets: activeConflicts.map(({ id, name }) => ({ id, name }))
      };
    }

    try {
      if (conflictIds.length > 0) {
        await this.presets.saveReplacingActiveHostname(preset, conflictIds);
      } else {
        const created = await this.presets.saveIfUnchanged(preset, null);
        if (!created) {
          throw new Error(
            "A preset with the generated id was created concurrently. Try again."
          );
        }
      }
    } catch (error) {
      if (!(error instanceof PresetRepositoryConflictError)) {
        throw error;
      }
      const latestConflicts = (await this.presets.list()).filter(
        (candidate) =>
          candidate.siteSettings.enabled &&
          candidate.site.hostname.toLowerCase() ===
            record.session.context.hostname.toLowerCase()
      );
      return {
        status: "confirmation-required",
        hostname: record.session.context.hostname,
        activePresets: latestConflicts.map(({ id, name }) => ({ id, name }))
      };
    }

    const latest = await this.recorderSessions.getByTabId(request.tabId);
    if (latest?.session.sessionId === request.sessionId) {
      await this.recorderSessions.removeByTabId(request.tabId);
    }
    return { status: "saved", preset: structuredClone(preset) };
  }

  #createValidatedPreset(
    request: SaveRecordedPresetRequest,
    record: NonNullable<
      Awaited<ReturnType<RecorderSessionRegistry["getByTabId"]>>
    >,
    existingIds: ReadonlySet<string>
  ): PresetV1 {
    let id: string | undefined;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = this.#createId();
      if (!existingIds.has(candidate)) {
        id = candidate;
        break;
      }
    }
    if (id === undefined) {
      throw new Error("Unable to generate a unique preset id.");
    }

    const description = request.description?.trim();
    const preset = createPresetV1(
      {
        name: request.name.trim(),
        ...(description === undefined || description.length === 0
          ? {}
          : { description }),
        site: {
          hostname: record.session.context.hostname.toLowerCase(),
          protocols: [record.session.context.protocol]
        },
        automation: {
          defaults: {
            timeoutMs: 10_000,
            postActionDelayMs: 0,
            humanInput: {
              enabled: false,
              minDelayMs: 40,
              maxDelayMs: 120
            }
          },
          steps: [...structuredClone(request.steps)]
        },
        siteSettings: {
          enabled: true,
          repeat: { enabled: false, intervalMinutes: 1 }
        }
      },
      { createId: () => id, now: this.#now }
    );
    assertRunnablePreset(preset);
    return preset;
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
