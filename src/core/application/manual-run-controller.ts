import type {
  AutomationRunResult,
  AutomationRunner
} from "./automation-runner";
import { findAutomationForUrl } from "./site-matcher";
import type { TabSessionManager } from "./tab-session-manager";
import { validatePresetForRun } from "../domain/preset-validator";
import type { PresetV1 } from "../domain/preset";
import type { PresetRepository } from "../ports/preset-repository";

export type ManualRunUnavailableReason =
  | "unsupported-url"
  | "no-preset"
  | "preset-disabled"
  | "invalid-preset";

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

  constructor(
    presets: PresetRepository,
    runner: AutomationRunner,
    sessions: TabSessionManager
  ) {
    this.#presets = presets;
    this.#runner = runner;
    this.#sessions = sessions;
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

    const presets = await this.#presets.list();
    const preset = findAutomationForUrl(presets, tabUrl);
    const activeSession = this.#sessions.getByTabId(tabId);
    if (activeSession !== undefined) {
      const activePreset =
        presets.find((item) => item.id === activeSession.presetId) ?? preset;
      return {
        status: {
          state: "running",
          tabId,
          hostname: location.hostname,
          presetId: activeSession.presetId,
          presetName: activePreset?.name ?? activeSession.presetId,
          sessionId: activeSession.sessionId
        },
        preset: activePreset
      };
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
