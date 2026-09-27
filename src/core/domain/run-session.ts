/**
 * Identifier owned by the application layer. Infrastructure uses it to keep
 * concurrent automation sessions isolated from one another.
 */
export type AutomationSessionId = string;

export type RunSessionStatus =
  | "starting"
  | "running"
  | "completing"
  | "stopping";

export interface RunSession {
  readonly sessionId: AutomationSessionId;
  readonly presetId: string;
  readonly tabId: number;
  readonly status: RunSessionStatus;
}
