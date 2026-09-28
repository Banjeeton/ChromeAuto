import type {
  RepeatCycleIdentity,
  RepeatCycleRuntimeState
} from "../domain/repeat-cycle";

export interface RepeatCycleRegistry {
  list(): Promise<readonly RepeatCycleRuntimeState[]>;
  getByTabId(tabId: number): Promise<RepeatCycleRuntimeState | undefined>;
  save(state: RepeatCycleRuntimeState): Promise<void>;
  removeByTabId(tabId: number): Promise<boolean>;
  removeStale(validCycles: readonly RepeatCycleIdentity[]): Promise<number>;
  clear(): Promise<number>;
}

export type RepeatCycleRegistryOperation = "read" | "write";

export class RepeatCycleRegistryAccessError extends Error {
  readonly operation: RepeatCycleRegistryOperation;

  constructor(operation: RepeatCycleRegistryOperation, cause: unknown) {
    super(`Unable to ${operation} repeat-cycle runtime state.`, { cause });
    this.name = "RepeatCycleRegistryAccessError";
    this.operation = operation;
  }
}
