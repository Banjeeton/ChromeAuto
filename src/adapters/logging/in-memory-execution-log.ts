import type {
  StepLogEntry,
  StepLogQuery
} from "../../core/domain/step-log-entry";
import type { ExecutionLog } from "../../core/ports/execution-log";

export interface InMemoryExecutionLogOptions {
  readonly maxEntries?: number;
}

export class InMemoryExecutionLog implements ExecutionLog {
  readonly #maxEntries: number;
  #entries: StepLogEntry[] = [];

  constructor(options: InMemoryExecutionLogOptions = {}) {
    const maxEntries = options.maxEntries ?? 500;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive integer");
    }
    this.#maxEntries = maxEntries;
  }

  async append(entry: StepLogEntry): Promise<void> {
    this.#entries.push(freezeEntry(entry));
    if (this.#entries.length > this.#maxEntries) {
      this.#entries.splice(0, this.#entries.length - this.#maxEntries);
    }
  }

  async list(query: StepLogQuery = {}): Promise<readonly StepLogEntry[]> {
    return Object.freeze(
      this.#entries.filter((entry) => matchesQuery(entry, query))
    );
  }

  async clear(query?: StepLogQuery): Promise<void> {
    if (query === undefined) {
      this.#entries = [];
      return;
    }
    this.#entries = this.#entries.filter(
      (entry) => !matchesQuery(entry, query)
    );
  }
}

function matchesQuery(entry: StepLogEntry, query: StepLogQuery): boolean {
  return (
    (query.sessionId === undefined || entry.sessionId === query.sessionId) &&
    (query.presetId === undefined || entry.presetId === query.presetId) &&
    (query.tabId === undefined || entry.tabId === query.tabId)
  );
}

function freezeEntry(entry: StepLogEntry): StepLogEntry {
  return deepFreeze(structuredClone(entry));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}
