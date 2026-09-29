import type {
  RecorderLogEntry,
  RecorderLogQuery
} from "../domain/recorder-log-entry";

export interface RecorderLog {
  append(entry: RecorderLogEntry): Promise<void>;
  list(query?: RecorderLogQuery): Promise<readonly RecorderLogEntry[]>;
  clear(query?: RecorderLogQuery): Promise<void>;
}
