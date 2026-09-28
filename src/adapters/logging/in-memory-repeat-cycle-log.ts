import type {
  RepeatCycleLogEntry,
  RepeatCycleLogQuery
} from "../../core/domain/repeat-cycle-log-entry";
import type { RepeatCycleLog } from "../../core/ports/repeat-cycle-log";

export class InMemoryRepeatCycleLog implements RepeatCycleLog {
  readonly #maxEntries: number;
  #entries: RepeatCycleLogEntry[] = [];

  constructor(maxEntries = 500) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive integer");
    }
    this.#maxEntries = maxEntries;
  }

  async append(entry: RepeatCycleLogEntry): Promise<void> {
    this.#entries.push(Object.freeze(structuredClone(entry)));
    if (this.#entries.length > this.#maxEntries) {
      this.#entries.splice(0, this.#entries.length - this.#maxEntries);
    }
  }

  async list(
    query: RepeatCycleLogQuery = {}
  ): Promise<readonly RepeatCycleLogEntry[]> {
    return Object.freeze(
      this.#entries.filter(
        (entry) =>
          (query.tabId === undefined || entry.tabId === query.tabId) &&
          (query.presetId === undefined || entry.presetId === query.presetId)
      )
    );
  }

  async clear(query?: RepeatCycleLogQuery): Promise<void> {
    if (query === undefined) {
      this.#entries = [];
      return;
    }
    this.#entries = this.#entries.filter(
      (entry) =>
        !(
          (query.tabId === undefined || entry.tabId === query.tabId) &&
          (query.presetId === undefined || entry.presetId === query.presetId)
        )
    );
  }
}
