import type { PresetV1 } from "../domain/preset";

export interface PresetRepository {
  list(): Promise<readonly PresetV1[]>;
  getById(presetId: string): Promise<PresetV1 | undefined>;
  save(preset: PresetV1): Promise<void>;
  remove(presetId: string): Promise<boolean>;
}

export class PresetRepositoryConflictError extends Error {
  readonly hostname: string;
  readonly presetIds: readonly string[];

  constructor(hostname: string, presetIds: readonly string[]) {
    super(
      `Hostname ${hostname} is already assigned to preset ${presetIds.join(", ")}`
    );
    this.name = "PresetRepositoryConflictError";
    this.hostname = hostname;
    this.presetIds = Object.freeze([...presetIds]);
  }
}
