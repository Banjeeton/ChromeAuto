import type {
  NaturalPacingLogEntry,
  NaturalPacingLogQuery
} from "../domain/natural-pacing-log-entry";

export interface NaturalPacingLog {
  append(entry: NaturalPacingLogEntry): Promise<void>;
  list(query?: NaturalPacingLogQuery): Promise<readonly NaturalPacingLogEntry[]>;
  clear(query?: NaturalPacingLogQuery): Promise<void>;
}
