import { useCallback, useEffect, useRef, useState } from "react";

import type { RecorderDraftView } from "../../../core/application/recorder-draft-controller";
import type { RecorderPanelStatus } from "../../../core/application/recorder-panel-controller";
import type { AutomationStep } from "../../../core/domain/automation-step";
import type { PresetV1 } from "../../../core/domain/preset";
import { AUTOMATION_RUNTIME_MESSAGE } from "../../../shared/types/automation-runtime";
import {
  errorMessage,
  errorTechnicalDetails,
  RuntimeRequestError,
  runtimeResponseError,
  sendRuntimeMessage
} from "../../runtime/runtime-client";
import type {
  ActiveTab,
  AddNotice,
  OperationState,
  RefreshWorkspace
} from "../../types";
import type { RecordedPresetFields } from "./RecordedStepsEditor";

export type PendingRecordedPresetConflict = {
  readonly fields: RecordedPresetFields;
  readonly hostname: string;
  readonly activePresets: readonly {
    readonly id: string;
    readonly name: string;
  }[];
};

export interface RecorderControllerOptions {
  readonly activeTab?: ActiveTab;
  readonly addNotice: AddNotice;
  readonly operation: OperationState;
}

export function useRecorderController({
  activeTab,
  addNotice,
  operation
}: RecorderControllerOptions) {
  const [status, setStatus] = useState<RecorderPanelStatus>();
  const [draft, setDraft] = useState<RecorderDraftView>();
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string>();
  const [pendingConflict, setPendingConflict] =
    useState<PendingRecordedPresetConflict>();
  const statusRequestId = useRef(0);
  const draftRequestId = useRef(0);

  const refreshStatus = useCallback(async (tabId: number) => {
    const requestId = ++statusRequestId.current;
    const response = await sendRuntimeMessage({
      type: AUTOMATION_RUNTIME_MESSAGE,
      action: "recorder-status",
      tabId
    });
    if (!response.ok) throw runtimeResponseError(response);
    if (response.result.kind !== "recorder-status") {
      throw new Error("The extension returned an unexpected recorder response.");
    }
    if (requestId !== statusRequestId.current) return;
    setStatus(response.result.status);
  }, []);

  const reset = useCallback(() => {
    statusRequestId.current += 1;
    draftRequestId.current += 1;
    setStatus(undefined);
    setDraft(undefined);
    setDraftError(undefined);
    setDraftLoading(false);
    setPendingConflict(undefined);
  }, []);

  const loadDraft = useCallback(async (tabId: number) => {
    const requestId = ++draftRequestId.current;
    setDraftLoading(true);
    setDraftError(undefined);
    try {
      const response = await sendRuntimeMessage({
        type: AUTOMATION_RUNTIME_MESSAGE,
        action: "recorder-draft",
        tabId
      });
      if (!response.ok) throw runtimeResponseError(response);
      if (response.result.kind !== "recorder-draft") {
        throw new Error("The extension returned an unexpected draft response.");
      }
      if (requestId !== draftRequestId.current) return;
      setDraft(response.result.draft);
    } catch (error) {
      if (requestId !== draftRequestId.current) return;
      setDraftError(`Unable to load recorded steps: ${errorMessage(error)}`);
    } finally {
      if (requestId === draftRequestId.current) setDraftLoading(false);
    }
  }, []);

  useEffect(() => {
    const editable =
      activeTab !== undefined &&
      status?.tabId === activeTab.id &&
      (status.state === "stopped" || status.state === "failed");
    if (!editable || activeTab === undefined) {
      setDraft(undefined);
      setDraftError(undefined);
      setDraftLoading(false);
      return;
    }
    void loadDraft(activeTab.id);
  }, [
    activeTab,
    loadDraft,
    status?.sessionId,
    status?.state,
    status?.stepCount
  ]);

  const start = useCallback(
    async (tab: ActiveTab, refreshWorkspace: RefreshWorkspace) => {
      operation.begin("record");
      setDraft(undefined);
      setDraftError(undefined);
      setPendingConflict(undefined);
      try {
        const response = await sendRuntimeMessage({
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "record",
          tabId: tab.id
        });
        if (!response.ok) throw runtimeResponseError(response);
        if (response.result.kind !== "recorder-status") {
          throw new Error("The extension returned an unexpected recorder response.");
        }
        setStatus(response.result.status);
      } catch (error) {
        if (!isLoggedRecorderUnavailableError(error)) {
          addNotice(
            "error",
            `Unable to start recording: ${errorMessage(error)}`,
            errorTechnicalDetails(error)
          );
        }
      } finally {
        operation.finish();
        await refreshWorkspace(tab.id).catch(() => undefined);
      }
    },
    [addNotice, operation]
  );

  const stop = useCallback(
    async (tab: ActiveTab, refreshWorkspace: RefreshWorkspace) => {
      operation.begin("stop-recording");
      try {
        const response = await sendRuntimeMessage({
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "stop-recording",
          tabId: tab.id
        });
        if (!response.ok) throw runtimeResponseError(response);
        if (response.result.kind !== "recorder-status") {
          throw new Error("The extension returned an unexpected recorder response.");
        }
        setStatus(response.result.status);
      } catch (error) {
        addNotice(
          "error",
          `Unable to stop recording: ${errorMessage(error)}`,
          errorTechnicalDetails(error)
        );
      } finally {
        operation.finish();
        await refreshWorkspace(tab.id).catch(() => undefined);
      }
    },
    [addNotice, operation]
  );

  const saveDraft = useCallback(
    async (
      tab: ActiveTab,
      steps: readonly AutomationStep[],
      refreshWorkspace: RefreshWorkspace
    ) => {
      if (draft === undefined) return;
      operation.begin("save-recorder-draft");
      setDraftError(undefined);
      try {
        const response = await sendRuntimeMessage({
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "save-recorder-draft",
          tabId: tab.id,
          sessionId: draft.sessionId,
          steps
        });
        if (!response.ok) throw runtimeResponseError(response);
        if (
          response.result.kind !== "recorder-draft" ||
          response.result.draft === undefined
        ) {
          throw new Error("The extension returned an unexpected draft response.");
        }
        setDraft(response.result.draft);
        addNotice("success", "Recorded step changes were saved to the draft.");
      } catch (error) {
        setDraftError(`Unable to save draft: ${errorMessage(error)}`);
      } finally {
        operation.finish();
        await refreshWorkspace(tab.id).catch(() => undefined);
      }
    },
    [addNotice, draft, operation]
  );

  const discardDraft = useCallback(
    async (tab: ActiveTab, refreshWorkspace: RefreshWorkspace) => {
      if (draft === undefined) return;
      operation.begin("discard-recorder-draft");
      setDraftError(undefined);
      try {
        const response = await sendRuntimeMessage({
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "discard-recorder-draft",
          tabId: tab.id,
          sessionId: draft.sessionId
        });
        if (!response.ok) throw runtimeResponseError(response);
        if (response.result.kind !== "recorder-draft-discarded") {
          throw new Error("The extension returned an unexpected discard response.");
        }
        setDraft(undefined);
        addNotice("success", "Recorded draft was discarded.");
      } catch (error) {
        setDraftError(`Unable to discard draft: ${errorMessage(error)}`);
      } finally {
        operation.finish();
        await refreshWorkspace(tab.id).catch(() => undefined);
      }
    },
    [addNotice, draft, operation]
  );

  const createPreset = useCallback(
    async (
      tab: ActiveTab,
      fields: RecordedPresetFields,
      refreshWorkspace: RefreshWorkspace,
      confirmedActivePresetIds?: readonly string[]
    ): Promise<PresetV1 | undefined> => {
      if (draft === undefined) return undefined;
      operation.begin("save-recorded-preset");
      setDraftError(undefined);
      try {
        const response = await sendRuntimeMessage({
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "save-recorded-preset",
          tabId: tab.id,
          sessionId: draft.sessionId,
          name: fields.name,
          ...(fields.description === undefined
            ? {}
            : { description: fields.description }),
          steps: fields.steps,
          ...(confirmedActivePresetIds === undefined
            ? {}
            : { confirmedActivePresetIds })
        });
        if (!response.ok) throw runtimeResponseError(response);
        if (response.result.kind !== "recorded-preset-save") {
          throw new Error("The extension returned an unexpected preset response.");
        }
        if (response.result.result.status === "confirmation-required") {
          setPendingConflict({
            fields,
            hostname: response.result.result.hostname,
            activePresets: response.result.result.activePresets
          });
          return undefined;
        }

        const preset = response.result.result.preset;
        setPendingConflict(undefined);
        setDraft(undefined);
        addNotice("success", `Recorded preset “${preset.name}” was created.`);
        return preset;
      } catch (error) {
        setDraftError(`Unable to create preset: ${errorMessage(error)}`);
        return undefined;
      } finally {
        operation.finish();
        await refreshWorkspace(tab.id).catch(() => undefined);
      }
    },
    [addNotice, draft, operation]
  );

  return {
    cancelConflict: () => setPendingConflict(undefined),
    createPreset,
    discardDraft,
    draft,
    draftError,
    draftLoading,
    pendingConflict,
    refreshStatus,
    reset,
    saveDraft,
    start,
    status,
    stop
  } as const;
}

function isLoggedRecorderUnavailableError(error: unknown): boolean {
  return (
    error instanceof RuntimeRequestError &&
    error.details.code === "recorder-unavailable"
  );
}
