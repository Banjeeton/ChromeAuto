import type { AutomationStep } from "../domain/automation-step";
import type { RecorderEvent } from "../domain/recorder-event";
import type {
  RecorderSessionIdentity,
  RecorderSessionState
} from "../domain/recorder-session";

export interface RecorderSessionRecord {
  readonly session: RecorderSessionState;
  readonly documentId: string;
  readonly currentUrl: string;
  readonly recordedEvents: readonly RecorderEvent[];
  readonly draftSteps: readonly AutomationStep[];
}

export interface RecorderSessionRegistry {
  list(): Promise<readonly RecorderSessionRecord[]>;
  getByTabId(tabId: number): Promise<RecorderSessionRecord | undefined>;
  save(record: RecorderSessionRecord): Promise<void>;
  markTabClosed(
    tabId: number,
    stoppedAt: string
  ): Promise<RecorderSessionRecord | undefined>;
  removeByTabId(tabId: number): Promise<boolean>;
  removeStale(
    validSessions: readonly RecorderSessionIdentity[]
  ): Promise<number>;
  clear(): Promise<number>;
}

export type RecorderSessionRegistryOperation = "read" | "write";

export class RecorderSessionRegistryAccessError extends Error {
  readonly operation: RecorderSessionRegistryOperation;

  constructor(operation: RecorderSessionRegistryOperation, cause: unknown) {
    super(`Unable to ${operation} recorder runtime state.`, { cause });
    this.name = "RecorderSessionRegistryAccessError";
    this.operation = operation;
  }
}
