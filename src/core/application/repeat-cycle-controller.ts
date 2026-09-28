import {
  AutomationEngineError,
  isAutomationEngineError
} from "../domain/automation-engine-error";
import type { PresetV1 } from "../domain/preset";
import type {
  RepeatCycleLogEntry,
  RepeatCycleStopReason
} from "../domain/repeat-cycle-log-entry";
import type { CycleScheduler } from "../ports/cycle-scheduler";
import type { RepeatCycleLog } from "../ports/repeat-cycle-log";
import type { RepeatCycleRegistry } from "../ports/repeat-cycle-registry";
import type {
  AutomationRunResult,
  AutomationRunner
} from "./automation-runner";

const MILLISECONDS_PER_MINUTE = 60_000;

type AutomationRunExecutor = Pick<AutomationRunner, "run">;

export interface RepeatCycleControllerOptions {
  readonly clock?: () => number;
  readonly createLogEntryId?: () => string;
  readonly log?: RepeatCycleLog;
}

export class RepeatCycleAlreadyRunningError extends Error {
  readonly tabId: number;
  readonly presetId: string;

  constructor(tabId: number, presetId: string) {
    super(`A repeat-cycle pass is already running in tab ${tabId}.`);
    this.name = "RepeatCycleAlreadyRunningError";
    this.tabId = tabId;
    this.presetId = presetId;
  }
}

/** Coordinates one automation pass with its following one-shot timer. */
export class RepeatCycleController {
  readonly #runner: AutomationRunExecutor;
  readonly #scheduler: CycleScheduler;
  readonly #registry: RepeatCycleRegistry;
  readonly #clock: () => number;
  readonly #createLogEntryId: () => string;
  readonly #log?: RepeatCycleLog;
  readonly #runningTabs = new Set<number>();
  readonly #cycleGenerationByTabId = new Map<number, number>();
  #stopAllPromise?: Promise<readonly number[]>;

  constructor(
    runner: AutomationRunExecutor,
    scheduler: CycleScheduler,
    registry: RepeatCycleRegistry,
    options: RepeatCycleControllerOptions = {}
  ) {
    this.#runner = runner;
    this.#scheduler = scheduler;
    this.#registry = registry;
    this.#clock = options.clock ?? Date.now;
    this.#createLogEntryId =
      options.createLogEntryId ?? (() => crypto.randomUUID());
    this.#log = options.log;
  }

  async runManual(
    preset: PresetV1,
    tabId: number
  ): Promise<AutomationRunResult> {
    this.#assertRepeatEnabled(preset);
    if (this.#stopAllPromise !== undefined) {
      throw new RepeatCycleAlreadyRunningError(tabId, preset.id);
    }
    if (!this.#claimTab(tabId)) {
      throw new RepeatCycleAlreadyRunningError(tabId, preset.id);
    }
    const generation = this.#generation(tabId);

    try {
      // A new manual run replaces any pending wait for the same cycle.
      await this.#scheduler.cancel({ tabId, presetId: preset.id });
      return await this.#runPass(preset, tabId, generation);
    } finally {
      this.#runningTabs.delete(tabId);
    }
  }

  async runScheduled(
    preset: PresetV1,
    tabId: number,
    scheduledFor: number
  ): Promise<AutomationRunResult | undefined> {
    if (this.#stopAllPromise !== undefined) {
      return undefined;
    }
    const state = await this.#registry.getByTabId(tabId);
    if (
      state?.state !== "waiting" ||
      state.presetId !== preset.id ||
      state.nextRunAt !== scheduledFor
    ) {
      return undefined;
    }

    if (!preset.siteSettings.repeat.enabled) {
      await this.#registry.save({
        tabId,
        presetId: preset.id,
        state: "stopped"
      });
      return undefined;
    }

    if (!this.#claimTab(tabId)) {
      return undefined;
    }
    const generation = this.#generation(tabId);

    try {
      return await this.#runPass(preset, tabId, generation);
    } finally {
      this.#runningTabs.delete(tabId);
    }
  }

  /** Stops one running or waiting cycle and invalidates in-flight scheduling. */
  async stopByTabId(
    tabId: number,
    reason: RepeatCycleStopReason = "user"
  ): Promise<boolean> {
    this.#invalidate(tabId);
    const state = await this.#registry.getByTabId(tabId);
    if (state === undefined) {
      return false;
    }

    const wasActive = state.state === "running" || state.state === "waiting";
    if (wasActive) {
      await this.#appendLog({
        tabId,
        presetId: state.presetId,
        event: "stopped",
        reason,
        message: stopMessage(reason, tabId)
      });
    }
    await this.#stopState(state);
    return wasActive;
  }

  /** Stops every running/waiting cycle while preserving tab isolation. */
  stopAll(
    reason: RepeatCycleStopReason = "stop-all"
  ): Promise<readonly number[]> {
    if (this.#stopAllPromise !== undefined) {
      return this.#stopAllPromise;
    }

    const operation = this.#performStopAll(reason).finally(() => {
      this.#stopAllPromise = undefined;
    });
    this.#stopAllPromise = operation;
    return operation;
  }

  async #runPass(
    preset: PresetV1,
    tabId: number,
    generation: number
  ): Promise<AutomationRunResult> {
    const identity = { tabId, presetId: preset.id };

    try {
      this.#throwIfInvalidated(identity, generation);
      await this.#appendLog({
        ...identity,
        event: "started",
        message: `Repeat cycle started in tab ${tabId}.`
      });
      await this.#registry.save({ ...identity, state: "running" });
      this.#throwIfInvalidated(identity, generation);
      const result = await this.#runner.run({
        presetId: preset.id,
        tabId,
        automation: preset.automation
      });
      const nextRunAt =
        this.#clock() +
        preset.siteSettings.repeat.intervalMinutes * MILLISECONDS_PER_MINUTE;
      await this.#appendLog({
        ...identity,
        event: "completed",
        message: `Repeat cycle completed in tab ${tabId}.`
      });

      if (!this.#isCurrent(tabId, generation)) {
        await this.#stopState(identity);
        return result;
      }

      await this.#scheduler.schedule({ ...identity, scheduledFor: nextRunAt });
      if (!this.#isCurrent(tabId, generation)) {
        await this.#stopState(identity);
        return result;
      }
      await this.#appendLog({
        ...identity,
        event: "scheduled",
        intervalMinutes: preset.siteSettings.repeat.intervalMinutes,
        nextRunAt,
        message: `Next run scheduled in ${preset.siteSettings.repeat.intervalMinutes} minute(s).`
      });
      await this.#registry.save({
        ...identity,
        state: "waiting",
        nextRunAt
      });
      if (!this.#isCurrent(tabId, generation)) {
        await this.#stopState(identity);
        return result;
      }
      return result;
    } catch (error) {
      if (
        this.#isCurrent(tabId, generation) ||
        !isAutomationEngineError(error) ||
        error.code !== "session-stopped"
      ) {
        await this.#appendFailureLog(identity, error);
      }
      await this.#settleFailedPass(identity, error);
      throw error;
    }
  }

  async #performStopAll(
    reason: RepeatCycleStopReason
  ): Promise<readonly number[]> {
    const inFlightTabIds = [...this.#runningTabs];
    inFlightTabIds.forEach((tabId) => this.#invalidate(tabId));
    const [states, timers] = await Promise.all([
      this.#registry.list(),
      this.#scheduler.list()
    ]);
    const activeStates = states.filter(
      (state) => state.state === "running" || state.state === "waiting"
    );
    const affectedTabIds = new Set([
      ...inFlightTabIds,
      ...activeStates.map((state) => state.tabId),
      ...timers.map((timer) => timer.tabId)
    ]);
    affectedTabIds.forEach((tabId) => this.#invalidate(tabId));

    await Promise.all(
      activeStates.map((state) =>
        this.#appendLog({
          tabId: state.tabId,
          presetId: state.presetId,
          event: "stopped",
          reason,
          message: stopMessage(reason, state.tabId)
        })
      )
    );

    const results = await Promise.allSettled([
      ...timers.map((timer) => this.#scheduler.cancel(timer)),
      ...activeStates.map((state) =>
        this.#registry.save({
          tabId: state.tabId,
          presetId: state.presetId,
          state: "stopped"
        })
      )
    ]);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (failure !== undefined) {
      throw failure.reason;
    }

    return Object.freeze([...affectedTabIds]);
  }

  async #stopState(
    identity: { readonly tabId: number; readonly presetId: string }
  ): Promise<void> {
    let schedulerError: unknown;
    try {
      await this.#scheduler.cancel(identity);
    } catch (error) {
      schedulerError = error;
    }

    await this.#registry.save({
      tabId: identity.tabId,
      presetId: identity.presetId,
      state: "stopped"
    });
    if (schedulerError !== undefined) {
      throw schedulerError;
    }
  }

  async #settleFailedPass(
    identity: { readonly tabId: number; readonly presetId: string },
    error: unknown
  ): Promise<void> {
    try {
      await this.#scheduler.cancel(identity);
    } catch {
      // Preserve the execution or scheduling error as the authoritative cause.
    }

    const state =
      isAutomationEngineError(error) && error.code === "session-stopped"
        ? "stopped"
        : "failed";
    try {
      await this.#registry.save({ ...identity, state });
    } catch {
      // A registry failure must not replace the original cycle failure.
    }
  }

  async #appendFailureLog(
    identity: { readonly tabId: number; readonly presetId: string },
    error: unknown
  ): Promise<void> {
    const stopped =
      isAutomationEngineError(error) && error.code === "session-stopped";
    const stepIndex = isAutomationEngineError(error)
      ? error.context.stepIndex
      : undefined;
    const stepId = isAutomationEngineError(error)
      ? error.context.stepId
      : undefined;
    const message = error instanceof Error ? error.message : String(error);
    await this.#appendLog({
      ...identity,
      event: stopped ? "stopped" : "failed",
      ...(stopped ? { reason: "automation-stop" as const } : {}),
      ...(stepId === undefined ? {} : { stepId }),
      ...(stepIndex === undefined ? {} : { stepNumber: stepIndex + 1 }),
      error: message,
      message:
        stepIndex === undefined
          ? `Repeat cycle stopped: ${message}`
          : `Repeat cycle stopped at step ${stepIndex + 1}${stepId === undefined ? "" : ` (${stepId})`}: ${message}`
    });
  }

  async #appendLog(
    entry: Omit<RepeatCycleLogEntry, "id" | "recordedAt">
  ): Promise<void> {
    if (this.#log === undefined) {
      return;
    }
    try {
      await this.#log.append({
        id: this.#createLogEntryId(),
        recordedAt: new Date(this.#clock()).toISOString(),
        ...entry
      });
    } catch {
      // Observability must not change scheduling semantics.
    }
  }

  #claimTab(tabId: number): boolean {
    if (this.#runningTabs.has(tabId)) {
      return false;
    }
    this.#runningTabs.add(tabId);
    return true;
  }

  #generation(tabId: number): number {
    return this.#cycleGenerationByTabId.get(tabId) ?? 0;
  }

  #invalidate(tabId: number): void {
    this.#cycleGenerationByTabId.set(tabId, this.#generation(tabId) + 1);
  }

  #isCurrent(tabId: number, generation: number): boolean {
    return this.#generation(tabId) === generation;
  }

  #throwIfInvalidated(
    identity: { readonly tabId: number; readonly presetId: string },
    generation: number
  ): void {
    if (!this.#isCurrent(identity.tabId, generation)) {
      throw new AutomationEngineError(
        "session-stopped",
        `Repeat cycle for tab ${identity.tabId} was stopped by the user`,
        { context: identity }
      );
    }
  }

  #assertRepeatEnabled(preset: PresetV1): void {
    if (!preset.siteSettings.repeat.enabled) {
      throw new Error(
        `Preset ${preset.id} does not have repeat scheduling enabled.`
      );
    }
  }
}

function stopMessage(reason: RepeatCycleStopReason, tabId: number): string {
  switch (reason) {
    case "tab-closed":
      return `Repeat cycle stopped because tab ${tabId} was closed.`;
    case "tab-context-changed":
      return `Repeat cycle stopped because tab ${tabId} left its assigned hostname or protocol.`;
    case "invalid-context":
      return `Repeat cycle stopped because tab ${tabId} or its preset is no longer valid.`;
    case "stop-all":
      return `Repeat cycle stopped by Stop All in tab ${tabId}.`;
    case "automation-stop":
      return `Repeat cycle stopped by automation code in tab ${tabId}.`;
    case "user":
      return `Repeat cycle stopped by the user in tab ${tabId}.`;
  }
}
