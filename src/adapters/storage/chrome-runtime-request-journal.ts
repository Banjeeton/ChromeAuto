import { RUNTIME_REQUEST_STORAGE_KEY } from "../../shared/constants";

export interface RuntimeRequestStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface CompletedRequest {
  readonly requestId: string;
  readonly action: string;
  readonly completedAt: number;
  readonly result: unknown;
}

/**
 * Coalesces duplicate control commands and retains successful results across a
 * service-worker restart. Only small control responses should use this journal.
 */
export class ChromeRuntimeRequestJournal {
  readonly #inFlight = new Map<string, Promise<unknown>>();
  #storageOperation: Promise<void> = Promise.resolve();

  constructor(
    readonly storage: RuntimeRequestStorageArea = chrome.storage.session,
    readonly storageKey = RUNTIME_REQUEST_STORAGE_KEY,
    readonly maxEntries = 32
  ) {}

  async execute<T>(
    requestId: string,
    action: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const key = `${action}\u0000${requestId}`;
    const current = this.#inFlight.get(key);
    if (current !== undefined) return await current as T;

    const execution = this.#executePersisted(requestId, action, operation);
    this.#inFlight.set(key, execution);
    void execution.then(
      () => this.#release(key, execution),
      () => this.#release(key, execution)
    );
    return await execution;
  }

  async #executePersisted<T>(
    requestId: string,
    action: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const persisted = await this.#find(requestId, action);
    if (persisted !== undefined) return structuredClone(persisted.result) as T;
    const result = await operation();
    await this.#remember({
      requestId,
      action,
      completedAt: Date.now(),
      result: structuredClone(result)
    });
    return result;
  }

  async #find(
    requestId: string,
    action: string
  ): Promise<CompletedRequest | undefined> {
    return await this.#exclusive(async () => {
      const entries = await this.#read();
      return entries.find(
        (entry) => entry.requestId === requestId && entry.action === action
      );
    });
  }

  async #remember(entry: CompletedRequest): Promise<void> {
    await this.#exclusive(async () => {
      const entries = await this.#read();
      const withoutDuplicate = entries.filter(
        (candidate) =>
          candidate.requestId !== entry.requestId ||
          candidate.action !== entry.action
      );
      await this.storage.set({
        [this.storageKey]: [...withoutDuplicate, entry].slice(-this.maxEntries)
      });
    });
  }

  async #read(): Promise<CompletedRequest[]> {
    const stored = await this.storage.get(this.storageKey);
    const value = stored[this.storageKey];
    if (!Array.isArray(value)) {
      if (value !== undefined) await this.storage.set({ [this.storageKey]: [] });
      return [];
    }
    const valid = value.filter(isCompletedRequest);
    if (valid.length !== value.length) {
      await this.storage.set({ [this.storageKey]: valid });
    }
    return valid;
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#storageOperation.then(operation, operation);
    this.#storageOperation = result.then(() => undefined, () => undefined);
    return result;
  }

  #release(key: string, execution: Promise<unknown>): void {
    if (this.#inFlight.get(key) === execution) this.#inFlight.delete(key);
  }
}

function isCompletedRequest(value: unknown): value is CompletedRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "requestId" in value &&
    typeof value.requestId === "string" &&
    value.requestId.length > 0 &&
    "action" in value &&
    typeof value.action === "string" &&
    value.action.length > 0 &&
    "completedAt" in value &&
    typeof value.completedAt === "number" &&
    Number.isFinite(value.completedAt) &&
    "result" in value
  );
}
