import type { AutomationDefaults } from "../domain/automation";
import type { AutomationStep } from "../domain/automation-step";
import type { AutomationSessionId } from "../domain/run-session";

export type { AutomationSessionId } from "../domain/run-session";

export interface AutomationTarget {
  tabId: number;
}

export interface StartAutomationRequest {
  sessionId: AutomationSessionId;
  target: AutomationTarget;
}

export interface AutomationSessionHandle {
  sessionId: AutomationSessionId;
  target: AutomationTarget;
}

export interface ExecuteAutomationStepRequest {
  sessionId: AutomationSessionId;
  stepIndex: number;
  step: AutomationStep;
  defaults: AutomationDefaults;
}

export interface AutomationStepExecutionResult {
  sessionId: AutomationSessionId;
  stepId: string;
  stepIndex: number;
  output?: unknown;
}

export type AutomationStopReason = "user" | "error";

export interface StopAutomationRequest {
  sessionId: AutomationSessionId;
  reason: AutomationStopReason;
}

export interface StopAllAutomationsRequest {
  reason: AutomationStopReason;
}

/**
 * Browser automation boundary used by the core application layer.
 *
 * Implementations may use Playwright CRX or another browser driver, but no
 * driver-specific objects are allowed to cross this boundary.
 */
export interface AutomationEngine {
  start(request: StartAutomationRequest): Promise<AutomationSessionHandle>;
  executeStep(
    request: ExecuteAutomationStepRequest
  ): Promise<AutomationStepExecutionResult>;
  complete(sessionId: AutomationSessionId): Promise<void>;
  stop(request: StopAutomationRequest): Promise<void>;
  stopAll(request: StopAllAutomationsRequest): Promise<void>;
}
