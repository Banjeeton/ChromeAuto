import type {
  RepeatCycleLogEntry,
  RepeatCycleLogQuery
} from "../domain/repeat-cycle-log-entry";

export interface RepeatCycleLog {
  append(entry: RepeatCycleLogEntry): Promise<void>;
  list(query?: RepeatCycleLogQuery): Promise<readonly RepeatCycleLogEntry[]>;
  clear(query?: RepeatCycleLogQuery): Promise<void>;
}
