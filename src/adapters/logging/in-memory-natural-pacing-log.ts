import type {
  NaturalPacingLogEntry,
  NaturalPacingLogQuery
} from "../../core/domain/natural-pacing-log-entry";
import type { NaturalPacingLog } from "../../core/ports/natural-pacing-log";

export class InMemoryNaturalPacingLog implements NaturalPacingLog {
  #entries: NaturalPacingLogEntry[] = [];

  async append(entry: NaturalPacingLogEntry): Promise<void> {
    this.#entries.push(Object.freeze(structuredClone(entry)));
  }

  async list(query: NaturalPacingLogQuery = {}): Promise<readonly NaturalPacingLogEntry[]> {
    return Object.freeze(
      this.#entries
        .filter(
          (entry) =>
            (query.tabId === undefined || entry.tabId === query.tabId) &&
            (query.sessionId === undefined || entry.sessionId === query.sessionId)
        )
        .map((entry) => structuredClone(entry))
    );
  }

  async clear(query: NaturalPacingLogQuery = {}): Promise<void> {
    this.#entries = this.#entries.filter(
      (entry) =>
        !(
          (query.tabId === undefined || entry.tabId === query.tabId) &&
          (query.sessionId === undefined || entry.sessionId === query.sessionId)
        )
    );
  }
}
