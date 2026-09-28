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

export function exportPresetJson(preset: PresetV1): string {
  assertValidPreset(preset);
  return `${JSON.stringify(preset, null, 2)}\n`;
}
