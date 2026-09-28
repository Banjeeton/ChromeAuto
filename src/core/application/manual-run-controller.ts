import type {
  AutomationRunResult,
  AutomationRunner
} from "./automation-runner";
import {
  findActiveAutomationForUrl,
  siteBindingMatchesUrl
} from "./site-matcher";
import type { TabSessionManager } from "./tab-session-manager";
import { validatePresetForRun } from "../domain/preset-validator";
import type { PresetV1 } from "../domain/preset";
import type { PresetRepository } from "../ports/preset-repository";
import type { RepeatCycleController } from "./repeat-cycle-controller";
import type { RepeatCycleRegistry } from "../ports/repeat-cycle-registry";
import type { RecorderSessionRegistry } from "../ports/recorder-session-registry";

export type ManualRunUnavailableReason =
  | "unsupported-url"
  | "no-preset"
  | "preset-disabled"
  | "invalid-preset"
  | "recording-active";

export type ManualRunStatus =
  | {
      readonly state: "ready";
      readonly tabId: number;
      readonly hostname: string;
      readonly presetId: string;
      readonly presetName: string;
      readonly stepCount: number;
    }
  | {
      readonly state: "running";
      readonly tabId: number;
      readonly hostname: string;
      readonly presetId: string;
      readonly presetName: string;
      readonly sessionId: string;
    }
  | {
      readonly state: "waiting";
      readonly tabId: number;
      readonly hostname: string;
      readonly presetId: string;
      readonly presetName: string;
      readonly nextRunAt: number;
    }
  | {
      readonly state: "unavailable";
      readonly tabId: number;
      readonly hostname?: string;
      readonly presetId?: string;
      readonly presetName?: string;
      readonly reason: ManualRunUnavailableReason;
      readonly message: string;
    };

interface ResolvedStatus {
  readonly status: ManualRunStatus;
  readonly preset?: PresetV1;
}

export class ManualRunController {
  readonly #presets: PresetRepository;
  readonly #runner: AutomationRunner;
  readonly #sessions: TabSessionManager;
  readonly #repeatCycles?: Pick<RepeatCycleController, "runManual">;
  readonly #repeatCycleStates?: Pick<RepeatCycleRegistry, "getByTabId">;
  readonly #recorderSessions?: Pick<RecorderSessionRegistry, "getByTabId">;

  constructor(
    presets: PresetRepository,
    runner: AutomationRunner,
    sessions: TabSessionManager,
    repeatCycles?: Pick<RepeatCycleController, "runManual">,
    repeatCycleStates?: Pick<RepeatCycleRegistry, "getByTabId">,
    recorderSessions?: Pick<RecorderSessionRegistry, "getByTabId">
  ) {
    this.#presets = presets;
    this.#runner = runner;
    this.#sessions = sessions;
    this.#repeatCycles = repeatCycles;
    this.#repeatCycleStates = repeatCycleStates;
    this.#recorderSessions = recorderSessions;
  }

  async status(tabId: number, tabUrl: string): Promise<ManualRunStatus> {
    return (await this.#resolve(tabId, tabUrl)).status;
  }

  async run(tabId: number, tabUrl: string): Promise<AutomationRunResult> {
    const resolved = await this.#resolve(tabId, tabUrl);
    if (resolved.status.state !== "ready" || resolved.preset === undefined) {
      throw new Error(
        resolved.status.state === "unavailable"
          ? resolved.status.message
          : "This tab already has a running automation."
      );
    }

    if (resolved.preset.siteSettings.repeat.enabled) {
      if (this.#repeatCycles === undefined) {
        throw new Error("Repeat-cycle runtime is unavailable.");
      }
      return this.#repeatCycles.runManual(resolved.preset, tabId);
    }

    return this.#runner.run({
      presetId: resolved.preset.id,
      tabId,
      automation: resolved.preset.automation
    });
  }

  async #resolve(tabId: number, tabUrl: string): Promise<ResolvedStatus> {
    const location = parseHttpLocation(tabUrl);
    if (location === undefined) {
      return {
        status: {
          state: "unavailable",
          tabId,
          reason: "unsupported-url",
          message: "Automations can only run on HTTP or HTTPS pages."
        }
      };
    }

    const recorder = await this.#recorderSessions?.getByTabId(tabId);
    if (
      recorder?.session.state === "recording" ||
      recorder?.session.state === "stopping"
    ) {
      return {
        status: {
          state: "unavailable",
          tabId,
          hostname: location.hostname,
          reason: "recording-active",
          message: "Stop recording in this tab before running automation."
        }
      };
    }

    const presets = await this.#presets.list();
    const activePreset = findActiveAutomationForUrl(presets, tabUrl);
    const preset =
      activePreset ??
      presets.find(
        (item) =>
          !item.siteSettings.enabled &&
          siteBindingMatchesUrl(item.site, tabUrl)
      );
    const activeSession = this.#sessions.getByTabId(tabId);
    if (activeSession !== undefined) {
      const sessionPreset =
        presets.find((item) => item.id === activeSession.presetId) ?? preset;
      return {
        status: {
          state: "running",
          tabId,
          hostname: location.hostname,
          presetId: activeSession.presetId,
          presetName: sessionPreset?.name ?? activeSession.presetId,
          sessionId: activeSession.sessionId
        },
        preset: sessionPreset
      };
    }

    const repeatState = await this.#repeatCycleStates?.getByTabId(tabId);
    if (repeatState?.state === "waiting") {
      const repeatPreset = presets.find(
        (item) =>
          item.id === repeatState.presetId &&
          item.siteSettings.enabled &&
          item.siteSettings.repeat.enabled &&
          siteBindingMatchesUrl(item.site, tabUrl)
      );
      if (repeatPreset !== undefined && repeatState.nextRunAt !== undefined) {
        return {
          status: {
            state: "waiting",
            tabId,
            hostname: location.hostname,
            presetId: repeatPreset.id,
            presetName: repeatPreset.name,
            nextRunAt: repeatState.nextRunAt
          },
          preset: repeatPreset
        };
      }
    }

    if (preset === undefined) {
      return {
        status: {
          state: "unavailable",
          tabId,
          hostname: location.hostname,
          reason: "no-preset",
          message: `No automation is assigned to ${location.hostname}.`
        }
      };
    }

    if (!preset.siteSettings.enabled) {
      return {
        status: {
          state: "unavailable",
          tabId,
          hostname: location.hostname,
          presetId: preset.id,
          presetName: preset.name,
          reason: "preset-disabled",
          message: `Automation “${preset.name}” is disabled for this site.`
        },
        preset
      };
    }

    const issues = validatePresetForRun(preset);
    if (issues.length > 0) {
      const issue = issues[0];
      return {
        status: {
          state: "unavailable",
          tabId,
          hostname: location.hostname,
          presetId: preset.id,
          presetName: preset.name,
          reason: "invalid-preset",
          message: `${issue.path}: ${issue.message}`
        },
        preset
      };
    }

    return {
      status: {
        state: "ready",
        tabId,
        hostname: location.hostname,
        presetId: preset.id,
        presetName: preset.name,
        stepCount: preset.automation.steps.length
      },
      preset
    };
  }
}

function parseHttpLocation(url: string): URL | undefined {
  try {
    const location = new URL(url);
    return location.protocol === "http:" || location.protocol === "https:"
      ? location
      : undefined;
  } catch {
    return undefined;
  }
}
