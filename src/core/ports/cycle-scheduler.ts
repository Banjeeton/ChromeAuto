import type { RepeatCycleIdentity } from "../domain/repeat-cycle";

export type CycleTimerIdentity = RepeatCycleIdentity;

export interface ScheduleCycleTimerRequest extends CycleTimerIdentity {
  /** Absolute Unix time in milliseconds at which the one-shot timer fires. */
  readonly scheduledFor: number;
}

export interface ScheduledCycleTimer extends CycleTimerIdentity {
  readonly scheduledFor: number;
}

/**
 * Browser-independent boundary for one-shot repeat-cycle timers.
 *
 * The application creates the next timer only after a successful automation
 * pass. Implementations must not turn it into a fixed periodic timer.
 */
export interface CycleScheduler {
  schedule(request: ScheduleCycleTimerRequest): Promise<void>;
  get(identity: CycleTimerIdentity): Promise<ScheduledCycleTimer | undefined>;
  cancel(identity: CycleTimerIdentity): Promise<boolean>;
}

export type CycleSchedulerOperation = "schedule" | "get" | "cancel";

export class CycleSchedulerError extends Error {
  readonly operation: CycleSchedulerOperation;
  readonly identity: Readonly<CycleTimerIdentity>;

  constructor(
    operation: CycleSchedulerOperation,
    identity: CycleTimerIdentity,
    cause: unknown
  ) {
    super(
      `Unable to ${operation} the repeat-cycle timer for tab ${identity.tabId} and preset ${identity.presetId}.`,
      { cause }
    );
    this.name = "CycleSchedulerError";
    this.operation = operation;
    this.identity = Object.freeze({ ...identity });
  }
}
