import type {
  RecorderLogEntry,
  RecorderLogQuery
} from "../../core/domain/recorder-log-entry";
import type { RecorderLog } from "../../core/ports/recorder-log";

export class InMemoryRecorderLog implements RecorderLog {
  readonly #maxEntries: number;
  #entries: RecorderLogEntry[] = [];

  constructor(maxEntries = 500) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive integer");
    }
    this.#maxEntries = maxEntries;
  }

  async append(entry: RecorderLogEntry): Promise<void> {
    this.#entries.push(Object.freeze(structuredClone(entry)));
    if (this.#entries.length > this.#maxEntries) {
      this.#entries.splice(0, this.#entries.length - this.#maxEntries);
    }
  }

  async list(query: RecorderLogQuery = {}): Promise<readonly RecorderLogEntry[]> {
    return Object.freeze(
      this.#entries.filter(
        (entry) =>
          (query.tabId === undefined || entry.tabId === query.tabId) &&
          (query.sessionId === undefined || entry.sessionId === query.sessionId)
      )
    );
  }

  async clear(query?: RecorderLogQuery): Promise<void> {
    if (query === undefined) {
      this.#entries = [];
      return;
    }
    this.#entries = this.#entries.filter(
      (entry) =>
        !(
          (query.tabId === undefined || entry.tabId === query.tabId) &&
          (query.sessionId === undefined || entry.sessionId === query.sessionId)
        )
    );
  }
}
