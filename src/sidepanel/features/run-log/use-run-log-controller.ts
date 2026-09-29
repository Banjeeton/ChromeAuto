import { useCallback, useState } from "react";

import type { RecorderLogEntry } from "../../../core/domain/recorder-log-entry";
import type { RepeatCycleLogEntry } from "../../../core/domain/repeat-cycle-log-entry";
import type { StepLogEntry } from "../../../core/domain/step-log-entry";
import { AUTOMATION_RUNTIME_MESSAGE } from "../../../shared/types/automation-runtime";
import {
  errorMessage,
  errorTechnicalDetails,
  runtimeResponseError,
  sendRuntimeMessage
} from "../../runtime/runtime-client";
import type { AddNotice, Notice } from "../../types";

export function useRunLogController() {
  const [stepLogs, setStepLogs] = useState<readonly StepLogEntry[]>([]);
  const [cycleLogs, setCycleLogs] =
    useState<readonly RepeatCycleLogEntry[]>([]);
  const [recorderLogs, setRecorderLogs] =
    useState<readonly RecorderLogEntry[]>([]);
  const [notices, setNotices] = useState<readonly Notice[]>([]);

  const addNotice: AddNotice = useCallback((status, text, details) => {
    setNotices((current) => [
      {
        id: Date.now() + Math.random(),
        status,
        text,
        ...(details === undefined ? {} : { details })
      },
      ...current
    ]);
  }, []);

  const refresh = useCallback(async (tabId: number) => {
    const response = await sendRuntimeMessage({
      type: AUTOMATION_RUNTIME_MESSAGE,
      action: "logs",
      tabId
    });
    if (!response.ok) {
      throw runtimeResponseError(response);
    }
    if (response.result.kind !== "logs") {
      throw new Error("The extension returned an unexpected log response.");
    }
    setStepLogs(response.result.entries);
    setCycleLogs(response.result.cycleEntries);
    setRecorderLogs(response.result.recorderEntries);
  }, []);

  const clear = useCallback(
    async (tabId: number) => {
      try {
        const response = await sendRuntimeMessage({
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "clear-logs",
          tabId
        });
        if (!response.ok) {
          throw runtimeResponseError(response);
        }
        setStepLogs([]);
        setCycleLogs([]);
        setRecorderLogs([]);
        setNotices([]);
      } catch (error) {
        addNotice(
          "error",
          `Unable to clear the run log: ${errorMessage(error)}`,
          errorTechnicalDetails(error)
        );
      }
    },
    [addNotice]
  );

  return {
    addNotice,
    clear,
    cycleLogs,
    notices,
    recorderLogs,
    refresh,
    stepLogs
  } as const;
}
