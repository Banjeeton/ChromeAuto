export interface RepeatCycleIdentity {
  readonly tabId: number;
  readonly presetId: string;
}

export type RepeatCycleState =
  | "idle"
  | "running"
  | "waiting"
  | "stopped"
  | "failed";

export interface RepeatCycleRuntimeState extends RepeatCycleIdentity {
  readonly state: RepeatCycleState;
  /** Present only while the cycle is waiting for its next one-shot timer. */
  readonly nextRunAt?: number;
}
