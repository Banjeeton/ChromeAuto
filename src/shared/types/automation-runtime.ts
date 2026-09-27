import type { RunSession } from "../../core/domain/run-session";
import type {
  StopAllAutomationsResult,
  StopAutomationResult
} from "../../core/ports/runtime-controller";

export const AUTOMATION_RUNTIME_MESSAGE = "automation/runtime" as const;

export type AutomationRuntimeMessage =
  | {
      readonly type: typeof AUTOMATION_RUNTIME_MESSAGE;
      readonly action: "stop";
      readonly tabId: number;
    }
  | {
      readonly type: typeof AUTOMATION_RUNTIME_MESSAGE;
      readonly action: "stop-all" | "sessions";
    };

export type AutomationRuntimeResult =
  | StopAutomationResult
  | StopAllAutomationsResult
  | readonly RunSession[];

export type AutomationRuntimeResponse =
  | { readonly ok: true; readonly result: AutomationRuntimeResult }
  | { readonly ok: false; readonly error: string };
