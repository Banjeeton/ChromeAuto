import type { PresetV1 } from "../domain/preset";

export interface PresetRepository {
  list(): Promise<readonly PresetV1[]>;
  getById(presetId: string): Promise<PresetV1 | undefined>;
  save(preset: PresetV1): Promise<void>;
  saveIfUnchanged(
    preset: PresetV1,
    expectedUpdatedAt: string | null
  ): Promise<boolean>;
  saveReplacingActiveHostname(
    preset: PresetV1,
    expectedActivePresetIds: readonly string[]
  ): Promise<void>;
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
  readonly code: "quota-exceeded" | "storage-write-failed";

  constructor(cause: unknown) {
    const quotaExceeded = isStorageQuotaError(cause);
    super(
      "PresetRepositoryWriteError",
      "write",
      quotaExceeded
        ? "Chrome storage quota was exceeded. Delete unused presets or reduce large custom-code steps, then try again. Existing presets were not changed."
        : "Unable to write automation presets to storage. Existing presets were not changed.",
      cause
    );
    this.code = quotaExceeded ? "quota-exceeded" : "storage-write-failed";
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

function isStorageQuotaError(error: unknown): boolean {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message.toLowerCase());
    current = current.cause;
  }
  const message = messages.join(" ");
  return (
    message.includes("quota") ||
    message.includes("max_write") ||
    message.includes("bytes_per_item")
  );
}
