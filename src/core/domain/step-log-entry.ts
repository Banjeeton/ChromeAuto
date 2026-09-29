import type { AutomationEngineErrorCode } from "./automation-engine-error";
import type {
  AutomationStep,
  ElementTarget,
  SelectOption
} from "./automation-step";
import type { AutomationSessionId } from "./run-session";

export type StepLogStatus = "succeeded" | "skipped" | "failed" | "stopped";

export interface StepLogError {
  readonly code: AutomationEngineErrorCode;
  readonly message: string;
  readonly name: string;
  readonly action: AutomationStep["type"];
  readonly reason: string;
  readonly technicalDetails?: string;
  readonly target?: ElementTarget;
  readonly selectOption?: SelectOption;
  readonly key?: string;
}

export interface StepLogEntry {
  readonly id: string;
  readonly recordedAt: string;
  readonly durationMs: number;
  readonly sessionId: AutomationSessionId;
  readonly presetId: string;
  readonly tabId: number;
  readonly stepId: string;
  readonly stepIndex: number;
  readonly stepNumber: number;
  readonly stepType: AutomationStep["type"];
  readonly stepName?: string;
  readonly status: StepLogStatus;
  readonly output?: unknown;
  readonly error?: StepLogError;
}

export interface StepLogQuery {
  readonly sessionId?: AutomationSessionId;
  readonly presetId?: string;
  readonly tabId?: number;
}
