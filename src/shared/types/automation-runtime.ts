import type { AutomationRunResult } from "../../core/application/automation-runner";
import type { ManualRunStatus } from "../../core/application/manual-run-controller";
import type { PresetEditableFields } from "../../core/application/preset-editor";
import type { PresetV1 } from "../../core/domain/preset";
import type { RunSession } from "../../core/domain/run-session";
import type { StepLogEntry } from "../../core/domain/step-log-entry";
import type { RepeatCycleLogEntry } from "../../core/domain/repeat-cycle-log-entry";
import type { RepeatCycleStatusView } from "../../core/application/repeat-cycle-status-controller";
import type { RecorderPanelStatus } from "../../core/application/recorder-panel-controller";
import type { RecorderDraftView } from "../../core/application/recorder-draft-controller";
import type { SaveRecordedPresetResult } from "../../core/application/recorded-preset-controller";
import type { AutomationStep } from "../../core/domain/automation-step";
import type {
  StopAllAutomationsResult,
  StopAutomationResult
} from "../../core/ports/runtime-controller";

export const AUTOMATION_RUNTIME_MESSAGE = "automation/runtime" as const;

export type AutomationRuntimeMessage =
  | {
      readonly type: typeof AUTOMATION_RUNTIME_MESSAGE;
      readonly action:
        | "manual-status"
        | "run"
        | "stop"
        | "logs"
        | "clear-logs"
        | "recorder-status"
        | "record"
        | "stop-recording"
        | "recorder-draft";
      readonly tabId: number;
    }
  | {
      readonly type: typeof AUTOMATION_RUNTIME_MESSAGE;
      readonly action: "save-recorder-draft";
      readonly tabId: number;
      readonly sessionId: string;
      readonly steps: readonly AutomationStep[];
    }
  | {
      readonly type: typeof AUTOMATION_RUNTIME_MESSAGE;
      readonly action: "discard-recorder-draft";
      readonly tabId: number;
      readonly sessionId: string;
    }
  | {
      readonly type: typeof AUTOMATION_RUNTIME_MESSAGE;
      readonly action: "save-recorded-preset";
      readonly tabId: number;
      readonly sessionId: string;
      readonly name: string;
      readonly description?: string;
      readonly steps: readonly AutomationStep[];
      readonly confirmedActivePresetIds?: readonly string[];
    }
  | {
      readonly type: typeof AUTOMATION_RUNTIME_MESSAGE;
      readonly action:
        | "stop-all"
        | "sessions"
        | "presets"
        | "repeat-statuses";
    }
  | {
      readonly type: typeof AUTOMATION_RUNTIME_MESSAGE;
      readonly action: "create-preset";
      readonly fields: PresetEditableFields;
    }
  | {
      readonly type: typeof AUTOMATION_RUNTIME_MESSAGE;
      readonly action: "update-preset";
      readonly presetId: string;
      readonly fields: PresetEditableFields;
    }
  | {
      readonly type: typeof AUTOMATION_RUNTIME_MESSAGE;
      readonly action: "delete-preset";
      readonly presetId: string;
    }
  | {
      readonly type: typeof AUTOMATION_RUNTIME_MESSAGE;
      readonly action: "import-preset";
      readonly source: string;
      readonly overwriteExistingUpdatedAt?: string;
    }
  | {
      readonly type: typeof AUTOMATION_RUNTIME_MESSAGE;
      readonly action: "export-preset";
      readonly presetId: string;
    };

export type AutomationRuntimeResult =
  | { readonly kind: "manual-status"; readonly status: ManualRunStatus }
  | { readonly kind: "recorder-status"; readonly status: RecorderPanelStatus }
  | { readonly kind: "recorder-draft"; readonly draft?: RecorderDraftView }
  | {
      readonly kind: "recorder-draft-discarded";
      readonly tabId: number;
      readonly discarded: boolean;
    }
  | {
      readonly kind: "recorded-preset-save";
      readonly result: SaveRecordedPresetResult;
    }
  | { readonly kind: "run"; readonly run: AutomationRunResult }
  | { readonly kind: "stop"; readonly stop: StopAutomationResult }
  | { readonly kind: "stop-all"; readonly stopAll: StopAllAutomationsResult }
  | { readonly kind: "sessions"; readonly sessions: readonly RunSession[] }
  | {
      readonly kind: "repeat-statuses";
      readonly statuses: readonly RepeatCycleStatusView[];
    }
  | { readonly kind: "presets"; readonly presets: readonly PresetV1[] }
  | { readonly kind: "preset-saved"; readonly preset: PresetV1 }
  | { readonly kind: "preset-deleted"; readonly presetId: string }
  | { readonly kind: "preset-imported"; readonly preset: PresetV1 }
  | {
      readonly kind: "preset-import-confirmation-required";
      readonly incomingPresetId: string;
      readonly incomingPresetName: string;
      readonly existingPresetName: string;
      readonly existingUpdatedAt: string;
    }
  | {
      readonly kind: "preset-exported";
      readonly presetId: string;
      readonly presetName: string;
      readonly json: string;
    }
  | {
      readonly kind: "logs";
      readonly entries: readonly StepLogEntry[];
      readonly cycleEntries: readonly RepeatCycleLogEntry[];
    }
  | { readonly kind: "clear-logs" };

export type AutomationRuntimeResponse =
  | { readonly ok: true; readonly result: AutomationRuntimeResult }
  | {
      readonly ok: false;
      readonly error: string;
      readonly details: AutomationRuntimeErrorDetails;
    };

export interface AutomationRuntimeErrorDetails {
  readonly action: AutomationRuntimeMessage["action"];
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly cause?: string;
  readonly data?: string;
  readonly stack?: string;
}
