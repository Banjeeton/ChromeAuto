import type { AutomationStep } from "./automation-step";
import type { AutomationSessionId } from "./run-session";

export const AUTOMATION_ENGINE_ERROR_CODES = [
  "invalid-target",
  "session-conflict",
  "session-not-found",
  "session-stopped",
  "step-timeout",
  "step-failed",
  "engine-unavailable"
] as const;

export type AutomationEngineErrorCode =
  (typeof AUTOMATION_ENGINE_ERROR_CODES)[number];

export interface AutomationEngineErrorContext {
  sessionId?: AutomationSessionId;
  tabId?: number;
  stepId?: string;
  stepIndex?: number;
  stepNumber?: number;
  stepType?: AutomationStep["type"];
}

export interface AutomationEngineErrorOptions {
  context?: AutomationEngineErrorContext;
  cause?: unknown;
}

/**
 * Stable error exposed by an AutomationEngine implementation to the core.
 * Adapter-specific exceptions must be converted to this type at the boundary.
 */
export class AutomationEngineError extends Error {
  readonly code: AutomationEngineErrorCode;
  readonly context: Readonly<AutomationEngineErrorContext>;

  constructor(
    code: AutomationEngineErrorCode,
    message: string,
    options: AutomationEngineErrorOptions = {}
  ) {
    super(message, { cause: options.cause });

    this.name = "AutomationEngineError";
    this.code = code;
    this.context = Object.freeze({ ...options.context });
  }
}

export function isAutomationEngineError(
  error: unknown
): error is AutomationEngineError {
  return error instanceof AutomationEngineError;
}
