import type { RunSession } from "../domain/run-session";

export interface StopAutomationResult {
  readonly stopped: boolean;
  readonly sessionId?: string;
  readonly tabId: number;
}

export interface StopAllAutomationsResult {
  readonly stoppedCount: number;
  readonly sessionIds: readonly string[];
}

/** Application boundary used by background messages and UI controls. */
export interface RuntimeController {
  sessions(): readonly RunSession[];
  stopByTabId(tabId: number): Promise<StopAutomationResult>;
  stopAll(): Promise<StopAllAutomationsResult>;
}
