import {
  AutomationEngineError,
  isAutomationEngineError
} from "../domain/automation-engine-error";
import type { AutomationDefinition } from "../domain/automation";
import type { AutomationStep } from "../domain/automation-step";
import {
  randomNaturalPacingDelayMs,
  type NaturalPacingSettings
} from "../domain/natural-pacing";
import type {
  StepLogEntry,
  StepLogStatus
} from "../domain/step-log-entry";
import type { AutomationEngine } from "../ports/automation-engine";
import type { ExecutionLog } from "../ports/execution-log";
import type { NaturalPacingLog } from "../ports/natural-pacing-log";
import type { NaturalPacingRepository } from "../ports/natural-pacing-repository";
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
  readonly naturalPacingRepository?: NaturalPacingRepository;
  readonly naturalPacingLog?: NaturalPacingLog;
  readonly random?: () => number;
  readonly delay?: (durationMs: number, signal: AbortSignal) => Promise<void>;
}

export class AutomationRunner {
  readonly #engine: AutomationEngine;
  readonly #sessions: TabSessionManager;
  readonly #log: ExecutionLog;
  readonly #clock: () => number;
  readonly #createLogEntryId: () => string;
  readonly #naturalPacingRepository?: NaturalPacingRepository;
  readonly #naturalPacingLog?: NaturalPacingLog;
  readonly #random: () => number;
  readonly #delay: (durationMs: number, signal: AbortSignal) => Promise<void>;

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
    this.#naturalPacingRepository = options.naturalPacingRepository;
    this.#naturalPacingLog = options.naturalPacingLog;
    this.#random = options.random ?? Math.random;
    this.#delay = options.delay ?? abortableDelay;
  }

  async run(request: RunAutomationRequest): Promise<AutomationRunResult> {
    const naturalPacing = await this.#naturalPacingRepository?.get(
      request.presetId
    );
    const session = await this.#sessions.start({
      presetId: request.presetId,
      tabId: request.tabId
    });
    const signal = this.#sessions.cancellationSignal(session.sessionId);
    const defaults = naturalPacing?.enabled
      ? {
          ...request.automation.defaults,
          humanInput: {
            ...request.automation.defaults.humanInput,
            enabled: true
          }
        }
      : request.automation.defaults;
    let executedSteps = 0;
    let skippedSteps = 0;

    try {
      for (const [stepIndex, step] of request.automation.steps.entries()) {
        this.#throwIfStopped(signal, session.sessionId, request.tabId);

        this.#sessions.setCurrentStep(session.sessionId, {
          stepId: step.id,
          stepIndex,
          stepNumber: stepIndex + 1,
          stepType: step.type,
          ...(step.name === undefined ? {} : { stepName: step.name })
        });

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
        let stepCompleted = false;
        try {
          const result = await this.#engine.executeStep({
            sessionId: session.sessionId,
            stepIndex,
            step,
            defaults
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
          stepCompleted = true;
          if (
            naturalPacing?.enabled === true &&
            step.postActionDelayMs === undefined &&
            hasLaterEnabledStep(request.automation.steps, stepIndex)
          ) {
            await this.#applyNaturalPacing({
              settings: naturalPacing,
              sessionId: session.sessionId,
              presetId: request.presetId,
              tabId: request.tabId,
              step,
              stepIndex,
              signal
            });
          }
        } catch (error) {
          const normalizedError = this.#normalizeStepError(
            error,
            signal,
            session.sessionId,
            request.tabId,
            step,
            stepIndex
          );
          if (stepCompleted) throw normalizedError;
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

  async #applyNaturalPacing(input: {
    readonly settings: NaturalPacingSettings;
    readonly sessionId: string;
    readonly presetId: string;
    readonly tabId: number;
    readonly step: AutomationStep;
    readonly stepIndex: number;
    readonly signal: AbortSignal;
  }): Promise<void> {
    const durationMs = randomNaturalPacingDelayMs(input.settings, this.#random);
    await this.#appendNaturalPacingEntry("started", durationMs, input);
    try {
      await this.#delay(durationMs, input.signal);
      this.#throwIfStopped(input.signal, input.sessionId, input.tabId);
      await this.#appendNaturalPacingEntry("completed", durationMs, input);
    } catch (error) {
      if (input.signal.aborted) {
        await this.#appendNaturalPacingEntry("stopped", durationMs, input);
      }
      throw error;
    }
  }

  async #appendNaturalPacingEntry(
    event: "started" | "completed" | "stopped",
    durationMs: number,
    input: {
      readonly sessionId: string;
      readonly presetId: string;
      readonly tabId: number;
      readonly step: AutomationStep;
      readonly stepIndex: number;
    }
  ): Promise<void> {
    if (this.#naturalPacingLog === undefined) return;
    const seconds = durationMs / 1_000;
    await this.#naturalPacingLog.append({
      id: this.#createLogEntryId(),
      recordedAt: new Date(this.#clock()).toISOString(),
      event,
      sessionId: input.sessionId,
      presetId: input.presetId,
      tabId: input.tabId,
      stepId: input.step.id,
      stepIndex: input.stepIndex,
      stepNumber: input.stepIndex + 1,
      durationMs,
      message:
        event === "started"
          ? `Natural pacing pause started for ${seconds} second(s).`
          : event === "completed"
            ? `Natural pacing pause completed after ${seconds} second(s).`
            : `Natural pacing pause of ${seconds} second(s) was stopped.`
    });
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
            error: createStepLogError(input.error, input.step)
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
      return sanitizeEngineError(error, step);
    }
    return new AutomationEngineError(
      "step-failed",
      redactStepValue(error instanceof Error ? error.message : String(error), step),
      {
        cause: sanitizeCause(error, step),
        context: {
          sessionId,
          tabId,
          stepId: step.id,
          stepIndex,
          stepNumber: stepIndex + 1,
          stepType: step.type,
          ...(step.name === undefined ? {} : { stepName: step.name }),
          action: step.type,
          ...stepDiagnosticContext(step)
        }
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

function hasLaterEnabledStep(
  steps: readonly AutomationStep[],
  stepIndex: number
): boolean {
  return steps.slice(stepIndex + 1).some((step) => step.enabled);
}

function abortableDelay(durationMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, durationMs);
    const abort = () => {
      globalThis.clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function createStepLogError(
  error: AutomationEngineError,
  step: AutomationStep
) {
  const reason = stepErrorReason(error, step);
  return {
    code: error.code,
    name: error.name,
    message: redactStepValue(error.message, step),
    action: step.type,
    reason,
    technicalDetails: formatStepTechnicalDetails(error, step),
    ...stepDiagnosticContext(step)
  };
}

function stepDiagnosticContext(step: AutomationStep) {
  const target =
    "target" in step && step.target !== undefined
      ? step.target
      : step.type === "wait" && step.condition.type === "element"
        ? step.condition.target
        : undefined;
  return {
    ...(target === undefined ? {} : { target: structuredClone(target) }),
    ...(step.type === "select"
      ? { selectOption: structuredClone(step.option) }
      : {}),
    ...(step.type === "pressKey" ? { key: step.key } : {})
  };
}

function stepErrorReason(
  error: AutomationEngineError,
  step: AutomationStep
): string {
  if (step.type === "customCode") {
    return "Custom JavaScript execution failed. Page-provided error details were omitted.";
  }
  const cause = error.cause;
  const reason =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : error.message;
  return redactStepValue(reason, step);
}

function formatStepTechnicalDetails(
  error: AutomationEngineError,
  step: AutomationStep
): string {
  const lines = [
    `Action: ${step.type}`,
    `Error: ${error.name} [${error.code}]: ${redactStepValue(error.message, step)}`,
    `Reason: ${stepErrorReason(error, step)}`
  ];
  if (step.type !== "customCode" && error.stack !== undefined) {
    lines.push(`Stack:\n${redactStepValue(error.stack, step).slice(0, 8_000)}`);
  }
  return lines.join("\n");
}

function sanitizeEngineError(
  error: AutomationEngineError,
  step: AutomationStep
): AutomationEngineError {
  const message = redactStepValue(error.message, step);
  const cause = sanitizeCause(error.cause, step);
  if (message === error.message && cause === error.cause) {
    return error;
  }
  return new AutomationEngineError(error.code, message, {
    context: error.context,
    cause
  });
}

function sanitizeCause(error: unknown, step: AutomationStep): unknown {
  if (step.type === "customCode") {
    return new Error(
      "Custom JavaScript execution failed. Page-provided error details were omitted."
    );
  }
  if (step.type !== "input" || step.value.length === 0) {
    return error;
  }
  if (error instanceof Error) {
    const sanitized = new Error(redactStepValue(error.message, step));
    sanitized.name = error.name;
    if (error.stack !== undefined) {
      sanitized.stack = redactStepValue(error.stack, step);
    }
    return sanitized;
  }
  return typeof error === "string" ? redactStepValue(error, step) : error;
}

function redactStepValue(value: string, step: AutomationStep): string {
  if (step.type === "customCode") {
    return "Custom JavaScript execution failed. Review the code in this step.";
  }
  return step.type === "input" && step.value.length > 0
    ? value.replaceAll(step.value, "[REDACTED]")
    : value;
}
