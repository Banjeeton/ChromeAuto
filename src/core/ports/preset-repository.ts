import type { PresetV1 } from "../domain/preset";

export interface PresetRepository {
  list(): Promise<readonly PresetV1[]>;
  getById(presetId: string): Promise<PresetV1 | undefined>;
  save(preset: PresetV1): Promise<void>;
  saveIfUnchanged(
    preset: PresetV1,
    expectedUpdatedAt: string | null
  ): Promise<boolean>;
  remove(presetId: string): Promise<boolean>;
}

export type PresetRepositoryAccessOperation = "read" | "write";

export abstract class PresetRepositoryAccessError extends Error {
  readonly operation: PresetRepositoryAccessOperation;

  protected constructor(
    name: string,
    operation: PresetRepositoryAccessOperation,
    message: string,
    cause: unknown
  ) {
    super(message, { cause });
    this.name = name;
    this.operation = operation;
  }
}

export class PresetRepositoryReadError extends PresetRepositoryAccessError {
  constructor(cause: unknown) {
    super(
      "PresetRepositoryReadError",
      "read",
      "Unable to read automation presets from storage.",
      cause
    );
  }
}

export class PresetRepositoryWriteError extends PresetRepositoryAccessError {
  constructor(cause: unknown) {
    super(
      "PresetRepositoryWriteError",
      "write",
      "Unable to write automation presets to storage.",
      cause
    );
  }
}

export type PresetRepositoryDataErrorCode =
  | "invalid_collection"
  | "duplicate_preset_id"
  | "duplicate_active_hostname";

export class PresetRepositoryDataError extends Error {
  readonly code: PresetRepositoryDataErrorCode;
  readonly values: readonly string[];

  constructor(
    code: PresetRepositoryDataErrorCode,
    message: string,
    values: readonly string[] = []
  ) {
    super(message);
    this.name = "PresetRepositoryDataError";
    this.code = code;
    this.values = Object.freeze([...values]);
  }
}

export class PresetRepositoryConflictError extends Error {
  readonly hostname: string;
  readonly presetIds: readonly string[];

  constructor(hostname: string, presetIds: readonly string[]) {
    super(
      `Hostname ${hostname} is already assigned to active preset ${presetIds.join(", ")}`
    );
    this.name = "PresetRepositoryConflictError";
    this.hostname = hostname;
    this.presetIds = Object.freeze([...presetIds]);
  }
}
