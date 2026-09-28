import type { PresetV1 } from "../../core/domain/preset";
import {
  assertValidPreset,
  type PresetValidationIssue
} from "../../core/domain/preset-validator";
import type { PresetRepository } from "../../core/ports/preset-repository";

export class PresetJsonSyntaxError extends Error {
  readonly path = "/";
  readonly issues: readonly PresetValidationIssue[];

  constructor(cause: unknown) {
    const issue: PresetValidationIssue = {
      code: "schema_json_syntax",
      path: "/",
      message: "The file is not valid JSON."
    };
    super(`Preset validation failed at ${issue.path}: ${issue.message}`, {
      cause
    });
    this.name = "PresetJsonSyntaxError";
    this.issues = Object.freeze([issue]);
  }
}

export function parsePresetJson(source: string): PresetV1 {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new PresetJsonSyntaxError(error);
  }

  assertValidPreset(value);
  return structuredClone(value);
}

export async function importPresetJson(
  source: string,
  repository: PresetRepository
): Promise<PresetV1> {
  const preset = parsePresetJson(source);
  await repository.save(preset);
  return structuredClone(preset);
}

export type SafePresetImportResult =
  | { readonly status: "imported"; readonly preset: PresetV1 }
  | {
      readonly status: "confirmation-required";
      readonly incomingPreset: PresetV1;
      readonly existingPreset: PresetV1;
    };

export async function importPresetJsonSafely(
  source: string,
  repository: PresetRepository,
  overwriteExistingUpdatedAt?: string
): Promise<SafePresetImportResult> {
  const incomingPreset = parsePresetJson(source);
  const existingPreset = await repository.getById(incomingPreset.id);

  if (
    existingPreset !== undefined &&
    overwriteExistingUpdatedAt !== existingPreset.updatedAt
  ) {
    return {
      status: "confirmation-required",
      incomingPreset,
      existingPreset
    };
  }

  const saved = await repository.saveIfUnchanged(
    incomingPreset,
    existingPreset?.updatedAt ?? null
  );
  if (saved) {
    return { status: "imported", preset: structuredClone(incomingPreset) };
  }

  const latestPreset = await repository.getById(incomingPreset.id);
  if (latestPreset !== undefined) {
    return {
      status: "confirmation-required",
      incomingPreset,
      existingPreset: latestPreset
    };
  }

  const created = await repository.saveIfUnchanged(incomingPreset, null);
  if (created) {
    return { status: "imported", preset: structuredClone(incomingPreset) };
  }

  const concurrentlyCreatedPreset = await repository.getById(incomingPreset.id);
  if (concurrentlyCreatedPreset === undefined) {
    throw new Error("Preset storage changed repeatedly during import. Try again.");
  }
  return {
    status: "confirmation-required",
    incomingPreset,
    existingPreset: concurrentlyCreatedPreset
  };
}

export function exportPresetJson(preset: PresetV1): string {
  assertValidPreset(preset);
  return `${JSON.stringify(preset, null, 2)}\n`;
}
