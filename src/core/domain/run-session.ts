import type { AutomationStep } from "./automation-step";

/**
 * Identifier owned by the application layer. Infrastructure uses it to keep
 * concurrent automation sessions isolated from one another.
 */
export type AutomationSessionId = string;

export type AutomationStopReason = "user" | "error";

export type RunSessionStatus =
  | "starting"
  | "running"
  | "completing"
  | "stopping";

export interface RunSessionStep {
  readonly stepId: string;
  readonly stepIndex: number;
  readonly stepNumber: number;
  readonly stepType: AutomationStep["type"];
  readonly stepName?: string;
}

export interface RunSession {
  readonly sessionId: AutomationSessionId;
  readonly presetId: string;
  readonly tabId: number;
  readonly status: RunSessionStatus;
  readonly currentStep?: RunSessionStep;
  readonly stopReason?: AutomationStopReason;
}
