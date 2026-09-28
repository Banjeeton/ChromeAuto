import type { PresetV1 } from "../domain/preset";
import { validatePresetForRun } from "../domain/preset-validator";
import type {
  RepeatCycleIdentity,
  RepeatCycleRuntimeState
} from "../domain/repeat-cycle";
import type {
  CycleScheduler,
  ScheduledCycleTimer
} from "../ports/cycle-scheduler";
import type { PresetRepository } from "../ports/preset-repository";
import type { RepeatCycleRegistry } from "../ports/repeat-cycle-registry";
import type { TabUrlProvider } from "../ports/tab-url-provider";
import type { AutomationRunResult } from "./automation-runner";
import type { RepeatCycleController } from "./repeat-cycle-controller";
import { siteBindingMatchesUrl } from "./site-matcher";

type ScheduledCycleRunner = Pick<RepeatCycleController, "runScheduled">;
type WaitingRepeatCycleState = RepeatCycleRuntimeState & {
  readonly state: "waiting";
  readonly nextRunAt: number;
};

export interface RepeatCycleRecoveryResult {
  readonly recognized: number;
  readonly restoredTimers: number;
  readonly removedTimers: number;
  readonly removedStates: number;
}

/**
 * Reconciles durable MV3 alarms with runtime cycle state and restores alarm
 * execution after the extension service worker has been recreated.
 */
export class RepeatCycleRecoveryController {
  readonly #runner: ScheduledCycleRunner;
  readonly #scheduler: CycleScheduler;
  readonly #registry: RepeatCycleRegistry;
  readonly #presets: Pick<PresetRepository, "list" | "getById">;
  readonly #tabs: TabUrlProvider;
  #recovery?: Promise<RepeatCycleRecoveryResult>;

  constructor(
    runner: ScheduledCycleRunner,
    scheduler: CycleScheduler,
    registry: RepeatCycleRegistry,
    presets: Pick<PresetRepository, "list" | "getById">,
    tabs: TabUrlProvider
  ) {
    this.#runner = runner;
    this.#scheduler = scheduler;
    this.#registry = registry;
    this.#presets = presets;
    this.#tabs = tabs;
  }

  /** Coalesces concurrent startup recovery attempts into one reconciliation. */
  recover(): Promise<RepeatCycleRecoveryResult> {
    if (this.#recovery !== undefined) {
      return this.#recovery;
    }

    const recovery = this.#reconcile();
    this.#recovery = recovery;
    void recovery.then(
      () => this.#releaseRecovery(recovery),
      () => this.#releaseRecovery(recovery)
    );
    return recovery;
  }

  /** Handles one Chrome alarm using only freshly loaded preset and tab data. */
  async handleAlarm(
    timer: ScheduledCycleTimer
  ): Promise<AutomationRunResult | undefined> {
    const state = await this.#registry.getByTabId(timer.tabId);
    if (
      state?.state !== "waiting" ||
      state.presetId !== timer.presetId ||
      state.nextRunAt !== timer.scheduledFor
    ) {
      return undefined;
    }

    const preset = await this.#presets.getById(timer.presetId);
    if (preset === undefined || !(await this.#canRun(preset, timer.tabId))) {
      await this.#discard(timer);
      return undefined;
    }

    return this.#runner.runScheduled(
      preset,
      timer.tabId,
      timer.scheduledFor
    );
  }

  async #reconcile(): Promise<RepeatCycleRecoveryResult> {
    const [states, timers, presets] = await Promise.all([
      this.#registry.list(),
      this.#scheduler.list(),
      this.#presets.list()
    ]);
    const presetsById = new Map(presets.map((preset) => [preset.id, preset]));
    const timersByIdentity = new Map(
      timers.map((timer) => [identityKey(timer), timer])
    );
    const validStates = new Map<string, WaitingRepeatCycleState>();
    let removedTimers = 0;
    let restoredTimers = 0;

    for (const state of states) {
      const preset = presetsById.get(state.presetId);
      const valid =
        state?.state === "waiting" &&
        state.nextRunAt !== undefined &&
        preset !== undefined &&
        (await this.#canRun(preset, state.tabId));

      if (valid) {
        validStates.set(identityKey(state), state as WaitingRepeatCycleState);
      }
    }

    for (const timer of timers) {
      const state = validStates.get(identityKey(timer));
      if (
        state === undefined ||
        state.nextRunAt !== timer.scheduledFor
      ) {
        if (await this.#scheduler.cancel(timer)) {
          removedTimers += 1;
        }
      }
    }

    for (const state of validStates.values()) {
      const timer = timersByIdentity.get(identityKey(state));
      if (timer?.scheduledFor !== state.nextRunAt) {
        await this.#scheduler.schedule({
          tabId: state.tabId,
          presetId: state.presetId,
          scheduledFor: state.nextRunAt
        });
        restoredTimers += 1;
      }
    }

    const valid = [...validStates.values()].map(({ tabId, presetId }) => ({
      tabId,
      presetId
    }));
    const removedStates = await this.#registry.removeStale(valid);
    return Object.freeze({
      recognized: valid.length,
      restoredTimers,
      removedTimers,
      removedStates
    });
  }

  async #canRun(
    preset: PresetV1,
    tabId: number
  ): Promise<boolean> {
    if (
      validatePresetForRun(preset).length > 0 ||
      !preset.siteSettings.enabled ||
      !preset.siteSettings.repeat.enabled
    ) {
      return false;
    }

    const tabUrl = await this.#tabs.getUrl(tabId);
    return tabUrl !== undefined && siteBindingMatchesUrl(preset.site, tabUrl);
  }

  async #discard(identity: RepeatCycleIdentity): Promise<void> {
    await this.#scheduler.cancel(identity);
    await this.#registry.removeByTabId(identity.tabId);
  }

  #releaseRecovery(recovery: Promise<RepeatCycleRecoveryResult>): void {
    if (this.#recovery === recovery) {
      this.#recovery = undefined;
    }
  }
}

function identityKey(identity: RepeatCycleIdentity): string {
  return `${identity.tabId}:${identity.presetId}`;
}
