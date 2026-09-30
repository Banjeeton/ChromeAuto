import type { NaturalPacingSettings } from "../domain/natural-pacing";

export interface NaturalPacingRepository {
  get(presetId: string): Promise<NaturalPacingSettings>;
  save(presetId: string, settings: NaturalPacingSettings): Promise<void>;
  remove(presetId: string): Promise<void>;
}
