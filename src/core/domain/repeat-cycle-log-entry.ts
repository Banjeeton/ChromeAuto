export type RepeatCycleLogEvent =
  | "started"
  | "completed"
  | "scheduled"
  | "stopped"
  | "failed";

export type RepeatCycleStopReason =
  | "user"
  | "stop-all"
  | "tab-closed"
  | "tab-context-changed"
  | "invalid-context"
  | "automation-stop";

export interface RepeatCycleLogEntry {
  readonly id: string;
  readonly recordedAt: string;
  readonly tabId: number;
  readonly presetId: string;
  readonly event: RepeatCycleLogEvent;
  readonly message: string;
  readonly intervalMinutes?: number;
  readonly nextRunAt?: number;
  readonly reason?: RepeatCycleStopReason;
  readonly stepId?: string;
  readonly stepNumber?: number;
  readonly error?: string;
}

export interface RepeatCycleLogQuery {
  readonly tabId?: number;
  readonly presetId?: string;
}
