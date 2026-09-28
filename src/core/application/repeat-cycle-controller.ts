import {
  AutomationEngineError,
  isAutomationEngineError
} from "../domain/automation-engine-error";
import type { PresetV1 } from "../domain/preset";
import type { CycleScheduler } from "../ports/cycle-scheduler";
import type { RepeatCycleRegistry } from "../ports/repeat-cycle-registry";
import type {
  AutomationRunResult,
  AutomationRunner
} from "./automation-runner";

const MILLISECONDS_PER_MINUTE = 60_000;

type AutomationRunExecutor = Pick<AutomationRunner, "run">;

export interface RepeatCycleControllerOptions {
  readonly clock?: () => number;
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
  async stopByTabId(tabId: number): Promise<boolean> {
    this.#invalidate(tabId);
    const state = await this.#registry.getByTabId(tabId);
    if (state === undefined) {
      return false;
    }

    const wasActive = state.state === "running" || state.state === "waiting";
    await this.#stopState(state);
    return wasActive;
  }

  /** Stops every running/waiting cycle while preserving tab isolation. */
  stopAll(): Promise<readonly number[]> {
    if (this.#stopAllPromise !== undefined) {
      return this.#stopAllPromise;
    }

    const operation = this.#performStopAll().finally(() => {
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
      await this.#registry.save({ ...identity, state: "running" });
      this.#throwIfInvalidated(identity, generation);
      const result = await this.#runner.run({
        presetId: preset.id,
        tabId,
        automation: preset.automation
      });

      if (!this.#isCurrent(tabId, generation)) {
        await this.#stopState(identity);
        return result;
      }

      const nextRunAt =
        this.#clock() +
        preset.siteSettings.repeat.intervalMinutes * MILLISECONDS_PER_MINUTE;
      await this.#scheduler.schedule({ ...identity, scheduledFor: nextRunAt });
      if (!this.#isCurrent(tabId, generation)) {
        await this.#stopState(identity);
        return result;
      }
      await this.#registry.save({
        ...identity,
        state: "waiting",
        nextRunAt
      });
      if (!this.#isCurrent(tabId, generation)) {
        await this.#stopState(identity);
      }
      return result;
    } catch (error) {
      await this.#settleFailedPass(identity, error);
      throw error;
    }
  }

  async #performStopAll(): Promise<readonly number[]> {
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
