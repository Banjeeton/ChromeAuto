import { useCallback, useRef, useState } from "react";

import type { ManualRunStatus } from "../../../core/application/manual-run-controller";
import type { RepeatCycleStatusView } from "../../../core/application/repeat-cycle-status-controller";
import type { RunSession } from "../../../core/domain/run-session";
import { AUTOMATION_RUNTIME_MESSAGE } from "../../../shared/types/automation-runtime";
import {
  errorMessage,
  errorTechnicalDetails,
  runtimeResponseError,
  sendRuntimeMessage
} from "../../runtime/runtime-client";
import type {
  ActiveTab,
  AddNotice,
  OperationState,
  RefreshWorkspace
} from "../../types";

export interface AutomationControllerOptions {
  readonly addNotice: AddNotice;
  readonly operation: OperationState;
}

export function useAutomationController({
  addNotice,
  operation
}: AutomationControllerOptions) {
  const [manualStatus, setManualStatus] = useState<ManualRunStatus>();
  const [sessions, setSessions] = useState<readonly RunSession[]>([]);
  const [repeatCycles, setRepeatCycles] =
    useState<readonly RepeatCycleStatusView[]>([]);
  const refreshRequestId = useRef(0);

  const refresh = useCallback(async (tabId: number) => {
    const requestId = ++refreshRequestId.current;
    const [statusResponse, sessionsResponse, repeatResponse] = await Promise.all([
      sendRuntimeMessage({
        type: AUTOMATION_RUNTIME_MESSAGE,
        action: "manual-status",
        tabId
      }),
      sendRuntimeMessage({
        type: AUTOMATION_RUNTIME_MESSAGE,
        action: "sessions"
      }),
      sendRuntimeMessage({
        type: AUTOMATION_RUNTIME_MESSAGE,
        action: "repeat-statuses"
      })
    ]);
    if (!statusResponse.ok) throw runtimeResponseError(statusResponse);
    if (!sessionsResponse.ok) throw runtimeResponseError(sessionsResponse);
    if (!repeatResponse.ok) throw runtimeResponseError(repeatResponse);
    if (statusResponse.result.kind !== "manual-status") {
      throw new Error("The extension returned an unexpected status response.");
    }
    if (sessionsResponse.result.kind !== "sessions") {
      throw new Error("The extension returned an unexpected sessions response.");
    }
    if (repeatResponse.result.kind !== "repeat-statuses") {
      throw new Error("The extension returned an unexpected repeat response.");
    }
    if (requestId !== refreshRequestId.current) return;
    setManualStatus(statusResponse.result.status);
    setSessions(sessionsResponse.result.sessions);
    setRepeatCycles(repeatResponse.result.statuses);
  }, []);

  const reset = useCallback(() => {
    refreshRequestId.current += 1;
    setManualStatus(undefined);
    setSessions([]);
    setRepeatCycles([]);
  }, []);

  const run = useCallback(
    async (activeTab: ActiveTab, refreshWorkspace: RefreshWorkspace) => {
      operation.begin("run");
      setManualStatus((current) =>
        current?.state === "ready"
          ? {
              state: "running",
              tabId: current.tabId,
              hostname: current.hostname,
              presetId: current.presetId,
              presetName: current.presetName,
              sessionId: "starting"
            }
          : current
      );
      try {
        const response = await sendRuntimeMessage({
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "run",
          tabId: activeTab.id
        });
        if (!response.ok) throw runtimeResponseError(response);
        if (response.result.kind === "run") {
          addNotice(
            "success",
            `Automation finished: ${response.result.run.executedSteps} steps executed.`
          );
        }
      } catch (error) {
        addNotice(
          "error",
          `Run failed: ${errorMessage(error)}`,
          errorTechnicalDetails(error)
        );
      } finally {
        operation.finish();
        await refreshWorkspace(activeTab.id).catch(() => undefined);
      }
    },
    [addNotice, operation]
  );

  const stop = useCallback(
    async (activeTab: ActiveTab, refreshWorkspace: RefreshWorkspace) => {
      operation.begin("stop");
      try {
        const response = await sendRuntimeMessage({
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "stop",
          tabId: activeTab.id
        });
        if (!response.ok) throw runtimeResponseError(response);
        if (response.result.kind === "stop") {
          addNotice(
            "success",
            response.result.stop.stopped
              ? "Automation stopped for the current tab."
              : "The current tab has no active automation."
          );
        }
      } catch (error) {
        addNotice(
          "error",
          `Stop failed: ${errorMessage(error)}`,
          errorTechnicalDetails(error)
        );
      } finally {
        operation.finish();
        await refreshWorkspace(activeTab.id).catch(() => undefined);
      }
    },
    [addNotice, operation]
  );

  const stopAll = useCallback(
    async (
      activeTab: ActiveTab | undefined,
      refreshWorkspace: RefreshWorkspace
    ) => {
      operation.begin("stop-all");
      try {
        const response = await sendRuntimeMessage({
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "stop-all"
        });
        if (!response.ok) throw runtimeResponseError(response);
        addNotice("success", "All automation sessions were stopped.");
      } catch (error) {
        addNotice(
          "error",
          `Stop All failed: ${errorMessage(error)}`,
          errorTechnicalDetails(error)
        );
      } finally {
        operation.finish();
        if (activeTab !== undefined) {
          await refreshWorkspace(activeTab.id).catch(() => undefined);
        }
      }
    },
    [addNotice, operation]
  );

  return {
    manualStatus,
    refresh,
    repeatCycles,
    reset,
    run,
    sessions,
    stop,
    stopAll
  } as const;
}
