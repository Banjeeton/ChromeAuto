import {
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
    if (!this.#claimTab(tabId)) {
      throw new RepeatCycleAlreadyRunningError(tabId, preset.id);
    }

    try {
      // A new manual run replaces any pending wait for the same cycle.
      await this.#scheduler.cancel({ tabId, presetId: preset.id });
      return await this.#runPass(preset, tabId);
    } finally {
      this.#runningTabs.delete(tabId);
    }
  }

  async runScheduled(
    preset: PresetV1,
    tabId: number,
    scheduledFor: number
  ): Promise<AutomationRunResult | undefined> {
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

    try {
      return await this.#runPass(preset, tabId);
    } finally {
      this.#runningTabs.delete(tabId);
    }
  }

  async #runPass(
    preset: PresetV1,
    tabId: number
  ): Promise<AutomationRunResult> {
    const identity = { tabId, presetId: preset.id };

    try {
      await this.#registry.save({ ...identity, state: "running" });
      const result = await this.#runner.run({
        presetId: preset.id,
        tabId,
        automation: preset.automation
      });

      const nextRunAt =
        this.#clock() +
        preset.siteSettings.repeat.intervalMinutes * MILLISECONDS_PER_MINUTE;
      await this.#scheduler.schedule({ ...identity, scheduledFor: nextRunAt });
      await this.#registry.save({
        ...identity,
        state: "waiting",
        nextRunAt
      });
      return result;
    } catch (error) {
      await this.#settleFailedPass(identity, error);
      throw error;
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

  #assertRepeatEnabled(preset: PresetV1): void {
    if (!preset.siteSettings.repeat.enabled) {
      throw new Error(
        `Preset ${preset.id} does not have repeat scheduling enabled.`
      );
    }
  }
}
