import type { AutomationSessionId } from "./run-session";

export type NaturalPacingLogEvent = "started" | "completed" | "stopped";

export interface NaturalPacingLogEntry {
  readonly id: string;
  readonly recordedAt: string;
  readonly event: NaturalPacingLogEvent;
  readonly sessionId: AutomationSessionId;
  readonly presetId: string;
  readonly tabId: number;
  readonly stepId: string;
  readonly stepIndex: number;
  readonly stepNumber: number;
  readonly durationMs: number;
  readonly message: string;
}

export interface NaturalPacingLogQuery {
  readonly tabId?: number;
  readonly sessionId?: AutomationSessionId;
}
