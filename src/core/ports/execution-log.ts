import type {
  StepLogEntry,
  StepLogQuery
} from "../domain/step-log-entry";

export interface ExecutionLog {
  append(entry: StepLogEntry): Promise<void>;
  list(query?: StepLogQuery): Promise<readonly StepLogEntry[]>;
  clear(query?: StepLogQuery): Promise<void>;
}
