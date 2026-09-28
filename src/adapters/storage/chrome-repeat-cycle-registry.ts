import type {
  RepeatCycleIdentity,
  RepeatCycleRuntimeState,
  RepeatCycleState
} from "../../core/domain/repeat-cycle";
import {
  type RepeatCycleRegistry,
  RepeatCycleRegistryAccessError
} from "../../core/ports/repeat-cycle-registry";
import { REPEAT_CYCLE_STORAGE_KEY } from "../../shared/constants";

export interface ChromeSessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Stores non-portable repeat-cycle state separately from preset storage. */
export class ChromeRepeatCycleRegistry implements RepeatCycleRegistry {
  readonly #storage: ChromeSessionStorageArea;
  readonly #storageKey: string;
  #pendingOperation: Promise<void> = Promise.resolve();

  constructor(
    storage: ChromeSessionStorageArea = chrome.storage.session,
    storageKey = REPEAT_CYCLE_STORAGE_KEY
  ) {
    this.#storage = storage;
    this.#storageKey = storageKey;
  }

  async list(): Promise<readonly RepeatCycleRuntimeState[]> {
    return await this.#runExclusive(async () => {
      const states = await this.#readAndRepair();
      return freezeStates(states);
    });
  }

  async getByTabId(
    tabId: number
  ): Promise<RepeatCycleRuntimeState | undefined> {
    assertTabId(tabId);
    return await this.#runExclusive(async () => {
      const state = (await this.#readAndRepair()).find(
        (candidate) => candidate.tabId === tabId
      );
      return state === undefined ? undefined : freezeState(state);
    });
  }

  async save(state: RepeatCycleRuntimeState): Promise<void> {
    assertRepeatCycleRuntimeState(state);
    const detached = structuredClone(state);

    await this.#runExclusive(async () => {
      const states = await this.#readAndRepair();
      const existingIndex = states.findIndex(
        (candidate) => candidate.tabId === detached.tabId
      );
      if (existingIndex === -1) {
        states.push(detached);
      } else {
        states[existingIndex] = detached;
      }
      await this.#write(states);
    });
  }

  async removeByTabId(tabId: number): Promise<boolean> {
    assertTabId(tabId);
    return await this.#runExclusive(async () => {
      const states = await this.#readAndRepair();
      const remaining = states.filter((state) => state.tabId !== tabId);
      if (remaining.length === states.length) {
        return false;
      }
      await this.#write(remaining);
      return true;
    });
  }

  async removeStale(
    validCycles: readonly RepeatCycleIdentity[]
  ): Promise<number> {
    validCycles.forEach(assertRepeatCycleIdentity);
    const validKeys = new Set(validCycles.map(repeatCycleIdentityKey));

    return await this.#runExclusive(async () => {
      const states = await this.#readAndRepair();
      const remaining = states.filter((state) =>
        validKeys.has(repeatCycleIdentityKey(state))
      );
      const removedCount = states.length - remaining.length;
      if (removedCount > 0) {
        await this.#write(remaining);
      }
      return removedCount;
    });
  }

  async clear(): Promise<number> {
    return await this.#runExclusive(async () => {
      const states = await this.#readAndRepair();
      if (states.length > 0) {
        await this.#write([]);
      }
      return states.length;
    });
  }

  async #readAndRepair(): Promise<RepeatCycleRuntimeState[]> {
    let stored: Record<string, unknown>;
    try {
      stored = await this.#storage.get(this.#storageKey);
    } catch (error) {
      throw new RepeatCycleRegistryAccessError("read", error);
    }

    const decoded = decodeRepeatCycleCollection(stored[this.#storageKey]);
    if (decoded.needsRepair) {
      await this.#write(decoded.states);
    }
    return decoded.states;
  }

  async #write(states: readonly RepeatCycleRuntimeState[]): Promise<void> {
    try {
      await this.#storage.set({
        [this.#storageKey]: structuredClone(states)
      });
    } catch (error) {
      throw new RepeatCycleRegistryAccessError("write", error);
    }
  }

  #runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pendingOperation.then(operation, operation);
    this.#pendingOperation = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

type DecodedRepeatCycles = {
  states: RepeatCycleRuntimeState[];
  needsRepair: boolean;
};

function decodeRepeatCycleCollection(value: unknown): DecodedRepeatCycles {
  if (value === undefined) {
    return { states: [], needsRepair: false };
  }
  if (!Array.isArray(value)) {
    return { states: [], needsRepair: true };
  }

  const byTabId = new Map<number, RepeatCycleRuntimeState>();
  let needsRepair = false;
  for (const candidate of value) {
    if (!isRepeatCycleRuntimeState(candidate)) {
      needsRepair = true;
      continue;
    }
    if (byTabId.has(candidate.tabId)) {
      needsRepair = true;
    }
    // The last valid entry is the most recent serialized value for this tab.
    byTabId.set(candidate.tabId, structuredClone(candidate));
  }

  return { states: [...byTabId.values()], needsRepair };
}

function isRepeatCycleRuntimeState(
  value: unknown
): value is RepeatCycleRuntimeState {
  if (!isObject(value)) {
    return false;
  }
  const allowedKeys = new Set(["tabId", "presetId", "state", "nextRunAt"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return false;
  }

  const { tabId, presetId, state, nextRunAt } = value;
  if (
    !isTabId(tabId) ||
    typeof presetId !== "string" ||
    presetId.trim().length === 0 ||
    !isRepeatCycleState(state)
  ) {
    return false;
  }

  return state === "waiting"
    ? isTimestamp(nextRunAt)
    : nextRunAt === undefined;
}

function assertRepeatCycleRuntimeState(
  state: RepeatCycleRuntimeState
): void {
  if (!isRepeatCycleRuntimeState(state)) {
    throw new TypeError(
      "Repeat-cycle state must contain a valid tabId, presetId, state and waiting nextRunAt."
    );
  }
}

function assertRepeatCycleIdentity(identity: RepeatCycleIdentity): void {
  assertTabId(identity.tabId);
  if (identity.presetId.trim().length === 0) {
    throw new TypeError("presetId must be a non-empty string.");
  }
}

function assertTabId(tabId: number): void {
  if (!isTabId(tabId)) {
    throw new RangeError("tabId must be a non-negative integer.");
  }
}

function isTabId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRepeatCycleState(value: unknown): value is RepeatCycleState {
  return (
    value === "idle" ||
    value === "running" ||
    value === "waiting" ||
    value === "stopped" ||
    value === "failed"
  );
}

function repeatCycleIdentityKey(identity: RepeatCycleIdentity): string {
  return `${identity.tabId}\u0000${identity.presetId}`;
}

function freezeStates(
  states: readonly RepeatCycleRuntimeState[]
): readonly RepeatCycleRuntimeState[] {
  return Object.freeze(states.map(freezeState));
}

function freezeState(state: RepeatCycleRuntimeState): RepeatCycleRuntimeState {
  return Object.freeze(structuredClone(state));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
