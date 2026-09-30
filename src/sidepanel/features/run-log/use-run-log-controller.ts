import { useCallback, useRef, useState } from "react";

import type { RecorderLogEntry } from "../../../core/domain/recorder-log-entry";
import type { RepeatCycleLogEntry } from "../../../core/domain/repeat-cycle-log-entry";
import type { StepLogEntry } from "../../../core/domain/step-log-entry";
import type { NaturalPacingLogEntry } from "../../../core/domain/natural-pacing-log-entry";
import { AUTOMATION_RUNTIME_MESSAGE } from "../../../shared/types/automation-runtime";
import {
  errorMessage,
  errorTechnicalDetails,
  runtimeResponseError,
  sendRuntimeMessage
} from "../../runtime/runtime-client";
import type { AddNotice, Notice, NoticeContext } from "../../types";

export function useRunLogController() {
  const currentTabId = useRef<number | undefined>(undefined);
  const [stepLogs, setStepLogs] = useState<readonly StepLogEntry[]>([]);
  const [cycleLogs, setCycleLogs] =
    useState<readonly RepeatCycleLogEntry[]>([]);
  const [recorderLogs, setRecorderLogs] =
    useState<readonly RecorderLogEntry[]>([]);
  const [naturalPacingLogs, setNaturalPacingLogs] =
    useState<readonly NaturalPacingLogEntry[]>([]);
  const [notices, setNotices] = useState<readonly Notice[]>([]);

  const addNotice: AddNotice = useCallback((
    status,
    text,
    details,
    context: NoticeContext = {}
  ) => {
    const tabId = context.tabId ?? currentTabId.current;
    setNotices((current) => [
      {
        id: Date.now() + Math.random(),
        status,
        text,
        recordedAt: new Date().toISOString(),
        ...(tabId === undefined ? {} : { tabId }),
        ...(context.sessionId === undefined
          ? {}
          : { sessionId: context.sessionId }),
        ...(context.action === undefined ? {} : { action: context.action }),
        ...(details === undefined ? {} : { details })
      },
      ...current
    ]);
  }, []);

  const refresh = useCallback(async (tabId: number) => {
    currentTabId.current = tabId;
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
    setNaturalPacingLogs(response.result.naturalPacingEntries);
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
        setNaturalPacingLogs([]);
        setNotices((current) =>
          current.filter((notice) => notice.tabId !== tabId)
        );
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
    naturalPacingLogs,
    recorderLogs,
    refresh,
    stepLogs
  } as const;
}
