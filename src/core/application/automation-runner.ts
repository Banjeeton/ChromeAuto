import {
  AutomationEngineError,
  isAutomationEngineError
} from "../domain/automation-engine-error";
import type { AutomationDefinition } from "../domain/automation";
import type { AutomationStep } from "../domain/automation-step";
import type {
  StepLogEntry,
  StepLogStatus
} from "../domain/step-log-entry";
import type { AutomationEngine } from "../ports/automation-engine";
import type { ExecutionLog } from "../ports/execution-log";
import type { TabSessionManager } from "./tab-session-manager";

export interface RunAutomationRequest {
  readonly presetId: string;
  readonly tabId: number;
  readonly automation: AutomationDefinition;
}

export interface AutomationRunResult {
  readonly sessionId: string;
  readonly presetId: string;
  readonly tabId: number;
  readonly executedSteps: number;
  readonly skippedSteps: number;
}

export interface AutomationRunnerOptions {
  readonly clock?: () => number;
  readonly createLogEntryId?: () => string;
}

export class AutomationRunner {
  readonly #engine: AutomationEngine;
  readonly #sessions: TabSessionManager;
  readonly #log: ExecutionLog;
  readonly #clock: () => number;
  readonly #createLogEntryId: () => string;

  constructor(
    engine: AutomationEngine,
    sessions: TabSessionManager,
    log: ExecutionLog,
    options: AutomationRunnerOptions = {}
  ) {
    this.#engine = engine;
    this.#sessions = sessions;
    this.#log = log;
    this.#clock = options.clock ?? Date.now;
    this.#createLogEntryId = options.createLogEntryId ?? (() => crypto.randomUUID());
  }

  async run(request: RunAutomationRequest): Promise<AutomationRunResult> {
    const session = await this.#sessions.start({
      presetId: request.presetId,
      tabId: request.tabId
    });
    const signal = this.#sessions.cancellationSignal(session.sessionId);
    let executedSteps = 0;
    let skippedSteps = 0;

    try {
      for (const [stepIndex, step] of request.automation.steps.entries()) {
        this.#throwIfStopped(signal, session.sessionId, request.tabId);

        if (!step.enabled) {
          skippedSteps += 1;
          await this.#appendStepEntry({
            sessionId: session.sessionId,
            presetId: request.presetId,
            tabId: request.tabId,
            step,
            stepIndex,
            startedAt: this.#clock(),
            status: "skipped"
          });
          continue;
        }

        const startedAt = this.#clock();
        try {
          const result = await this.#engine.executeStep({
            sessionId: session.sessionId,
            stepIndex,
            step,
            defaults: request.automation.defaults
          });
          this.#throwIfStopped(signal, session.sessionId, request.tabId);
          executedSteps += 1;
          await this.#appendStepEntry({
            sessionId: session.sessionId,
            presetId: request.presetId,
            tabId: request.tabId,
            step,
            stepIndex,
            startedAt,
            status: "succeeded",
            output: result.output
          });
        } catch (error) {
          const normalizedError = this.#normalizeStepError(
            error,
            signal,
            session.sessionId,
            request.tabId,
            step,
            stepIndex
          );
          const status: StepLogStatus =
            normalizedError.code === "session-stopped" ? "stopped" : "failed";
          await this.#appendStepEntry({
            sessionId: session.sessionId,
            presetId: request.presetId,
            tabId: request.tabId,
            step,
            stepIndex,
            startedAt,
            status,
            output: this.#errorOutput(normalizedError),
            error: normalizedError
          });
          throw normalizedError;
        }
      }

      this.#throwIfStopped(signal, session.sessionId, request.tabId);
      await this.#sessions.complete(session.sessionId);
      this.#throwIfStopped(signal, session.sessionId, request.tabId);

      return Object.freeze({
        sessionId: session.sessionId,
        presetId: request.presetId,
        tabId: request.tabId,
        executedSteps,
        skippedSteps
      });
    } catch (error) {
      const normalizedError = this.#normalizeRunError(
        error,
        signal,
        session.sessionId,
        request.tabId
      );
      const activeSession = this.#sessions.getById(session.sessionId);
      if (activeSession) {
        try {
          await this.#sessions.stop(
            session.sessionId,
            normalizedError.code === "session-stopped" ? "user" : "error"
          );
        } catch {
          // The original execution error remains authoritative. A failed
          // detach leaves the session in stopping state and can be retried.
        }
      }
      throw normalizedError;
    }
  }

  async #appendStepEntry(input: {
    sessionId: string;
    presetId: string;
    tabId: number;
    step: AutomationStep;
    stepIndex: number;
    startedAt: number;
    status: StepLogStatus;
    output?: unknown;
    error?: AutomationEngineError;
  }): Promise<void> {
    const finishedAt = this.#clock();
    const entry: StepLogEntry = {
      id: this.#createLogEntryId(),
      recordedAt: new Date(finishedAt).toISOString(),
      durationMs: Math.max(0, finishedAt - input.startedAt),
      sessionId: input.sessionId,
      presetId: input.presetId,
      tabId: input.tabId,
      stepId: input.step.id,
      stepIndex: input.stepIndex,
      stepNumber: input.stepIndex + 1,
      stepType: input.step.type,
      ...(input.step.name === undefined ? {} : { stepName: input.step.name }),
      status: input.status,
      ...(input.output === undefined ? {} : { output: input.output }),
      ...(input.error === undefined
        ? {}
        : {
            error: {
              code: input.error.code,
              message: input.error.message,
              name: input.error.name
            }
          })
    };
    await this.#log.append(entry);
  }

  #normalizeStepError(
    error: unknown,
    signal: AbortSignal,
    sessionId: string,
    tabId: number,
    step: AutomationStep,
    stepIndex: number
  ): AutomationEngineError {
    const stoppedError = this.#stoppedError(signal, sessionId, tabId);
    if (stoppedError) {
      return stoppedError;
    }
    if (isAutomationEngineError(error)) {
      return error;
    }
    return new AutomationEngineError(
      "step-failed",
      error instanceof Error ? error.message : String(error),
      {
        cause: error,
        context: { sessionId, tabId, stepId: step.id, stepIndex }
      }
    );
  }

  #normalizeRunError(
    error: unknown,
    signal: AbortSignal,
    sessionId: string,
    tabId: number
  ): AutomationEngineError {
    return (
      this.#stoppedError(signal, sessionId, tabId) ??
      (isAutomationEngineError(error)
        ? error
        : new AutomationEngineError("engine-unavailable", String(error), {
            cause: error,
            context: { sessionId, tabId }
          }))
    );
  }

  #throwIfStopped(
    signal: AbortSignal,
    sessionId: string,
    tabId: number
  ): void {
    const error = this.#stoppedError(signal, sessionId, tabId);
    if (error) {
      throw error;
    }
  }

  #stoppedError(
    signal: AbortSignal,
    sessionId: string,
    tabId: number
  ): AutomationEngineError | undefined {
    if (!signal.aborted) {
      return undefined;
    }
    if (isAutomationEngineError(signal.reason)) {
      return signal.reason;
    }
    return new AutomationEngineError(
      "session-stopped",
      "Automation was stopped",
      { cause: signal.reason, context: { sessionId, tabId } }
    );
  }

  #errorOutput(error: AutomationEngineError): unknown | undefined {
    const cause = error.cause;
    if (
      typeof cause === "object" &&
      cause !== null &&
      "logs" in cause &&
      Array.isArray(cause.logs)
    ) {
      return { logs: [...cause.logs] };
    }
    return undefined;
  }
}
