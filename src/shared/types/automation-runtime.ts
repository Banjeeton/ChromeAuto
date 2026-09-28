import type { AutomationRunResult } from "../../core/application/automation-runner";
import type { ManualRunStatus } from "../../core/application/manual-run-controller";
import type { PresetEditableFields } from "../../core/application/preset-editor";
import type { PresetV1 } from "../../core/domain/preset";
import type { RunSession } from "../../core/domain/run-session";
import type { StepLogEntry } from "../../core/domain/step-log-entry";
import type {
  StopAllAutomationsResult,
  StopAutomationResult
} from "../../core/ports/runtime-controller";

export const AUTOMATION_RUNTIME_MESSAGE = "automation/runtime" as const;

export type AutomationRuntimeMessage =
  | {
      readonly type: typeof AUTOMATION_RUNTIME_MESSAGE;
      readonly action: "manual-status" | "run" | "stop" | "logs" | "clear-logs";
      readonly tabId: number;
    }
  | {
      readonly type: typeof AUTOMATION_RUNTIME_MESSAGE;
      readonly action: "stop-all" | "sessions" | "presets";
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
    };

export type AutomationRuntimeResult =
  | { readonly kind: "manual-status"; readonly status: ManualRunStatus }
  | { readonly kind: "run"; readonly run: AutomationRunResult }
  | { readonly kind: "stop"; readonly stop: StopAutomationResult }
  | { readonly kind: "stop-all"; readonly stopAll: StopAllAutomationsResult }
  | { readonly kind: "sessions"; readonly sessions: readonly RunSession[] }
  | { readonly kind: "presets"; readonly presets: readonly PresetV1[] }
  | { readonly kind: "preset-saved"; readonly preset: PresetV1 }
  | { readonly kind: "logs"; readonly entries: readonly StepLogEntry[] }
  | { readonly kind: "clear-logs" };

export type AutomationRuntimeResponse =
  | { readonly ok: true; readonly result: AutomationRuntimeResult }
  | { readonly ok: false; readonly error: string };
