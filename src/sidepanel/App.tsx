import { useCallback, useEffect, useRef, useState } from "react";

import {
  NATURAL_PACING_STORAGE_KEY,
  PRESET_STORAGE_KEY,
  RECORDER_SESSION_STORAGE_KEY,
  REPEAT_CYCLE_STORAGE_KEY
} from "../shared/constants";
import { AUTOMATION_RUNTIME_MESSAGE } from "../shared/types/automation-runtime";
import { useAutomationController } from "./features/automation";
import { DashboardPanel } from "./features/dashboard";
import {
  PresetManagementPanel,
  usePresetManagement
} from "./features/presets";
import {
  RecordedDraftPanel,
  useRecorderController,
  type RecordedPresetFields
} from "./features/recorder";
import { RunLogPanel, useRunLogController } from "./features/run-log";
import {
  NaturalPacingPanel,
  useNaturalPacingController
} from "./features/natural-pacing";
import { useOperationState } from "./hooks/use-operation-state";
import { Icon, StatusBadge } from "./components";
import {
  SidePanelNavigation,
  type SidePanelView
} from "./components/SidePanelNavigation";
import {
  errorMessage,
  errorTechnicalDetails,
  sendRuntimeMessage
} from "./runtime/runtime-client";
import type { ActiveTab } from "./types";

function App() {
  const [activeView, setActiveView] = useState<SidePanelView>("dashboard");
  const [activeTab, setActiveTab] = useState<ActiveTab>();
  const activeTabIdRef = useRef<number | undefined>(undefined);
  const operation = useOperationState();
  const runLog = useRunLogController();
  const naturalPacing = useNaturalPacingController();
  const automation = useAutomationController({
    addNotice: runLog.addNotice,
    operation
  });
  const recorder = useRecorderController({
    activeTab,
    addNotice: runLog.addNotice,
    operation
  });

  const refreshWorkspace = useCallback(
    async (_requestedTabId: number) => {
      const tabId = activeTabIdRef.current;
      if (tabId === undefined) return;
      await Promise.all([
        automation.refresh(tabId),
        recorder.refreshStatus(tabId),
        runLog.refresh(tabId)
      ]);
    },
    [automation.refresh, recorder.refreshStatus, runLog.refresh]
  );

  const presets = usePresetManagement({
    activeTab,
    addNotice: runLog.addNotice,
    operation,
    refreshWorkspace
  });

  const refreshActiveTab = useCallback(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (tab?.id === undefined) {
      activeTabIdRef.current = undefined;
      setActiveTab(undefined);
      automation.reset();
      recorder.reset();
      return;
    }

    activeTabIdRef.current = tab.id;
    setActiveTab({
      id: tab.id,
      title: tab.title ?? `Tab #${tab.id}`,
      ...(tab.url === undefined ? {} : { url: tab.url })
    });
    await refreshWorkspace(tab.id);
  }, [automation.reset, recorder.reset, refreshWorkspace]);

  const reportActiveTabError = useCallback(
    (message: string, error: unknown) => {
      runLog.addNotice(
        "error",
        `${message}: ${errorMessage(error)}`,
        errorTechnicalDetails(error)
      );
    },
    [runLog.addNotice]
  );

  useEffect(() => {
    void refreshActiveTab().catch((error: unknown) => {
      reportActiveTabError("Unable to inspect the active tab", error);
    });

    const handleActivation = () => {
      void refreshActiveTab().catch((error: unknown) => {
        reportActiveTabError("Unable to inspect the active tab", error);
      });
    };
    const handleUpdated = (
      _tabId: number,
      changeInfo: { url?: string },
      tab: chrome.tabs.Tab
    ) => {
      if (tab.active && changeInfo.url !== undefined) {
        void refreshActiveTab().catch((error: unknown) => {
          reportActiveTabError("Unable to inspect the active tab", error);
        });
      }
    };
    chrome.tabs.onActivated.addListener(handleActivation);
    chrome.tabs.onUpdated.addListener(handleUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(handleActivation);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    };
  }, [refreshActiveTab, reportActiveTabError]);

  useEffect(() => {
    void presets.refresh(true);

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName === "local" && PRESET_STORAGE_KEY in changes) {
        void presets.refresh();
        void refreshActiveTab().catch((error: unknown) => {
          reportActiveTabError(
            "Unable to refresh the active-site status",
            error
          );
        });
      } else if (
        areaName === "local" &&
        NATURAL_PACING_STORAGE_KEY in changes
      ) {
        void naturalPacing.refresh(naturalPacing.presetId);
      } else if (
        areaName === "session" &&
        (REPEAT_CYCLE_STORAGE_KEY in changes ||
          RECORDER_SESSION_STORAGE_KEY in changes)
      ) {
        void refreshActiveTab().catch((error: unknown) => {
          reportActiveTabError("Unable to refresh runtime status", error);
        });
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [
    naturalPacing.presetId,
    naturalPacing.refresh,
    presets.refresh,
    refreshActiveTab,
    reportActiveTabError
  ]);

  useEffect(() => {
    const tabId = activeTab?.id;
    if (tabId === undefined || recorder.status?.state !== "recording") return;

    const interval = setInterval(() => {
      void runLog.refresh(tabId).catch(() => undefined);
    }, 1_000);
    return () => clearInterval(interval);
  }, [activeTab?.id, recorder.status?.state, runLog.refresh]);

  useEffect(() => {
    const tabId = activeTab?.id;
    const hasRunningAutomation =
      operation.busyAction === "run" ||
      automation.sessions.some(({ status }) => status !== "stopping") ||
      automation.repeatCycles.some(({ state }) => state === "running");
    if (tabId === undefined || !hasRunningAutomation) return;

    const interval = setInterval(() => {
      void refreshWorkspace(tabId).catch(() => undefined);
    }, 750);
    return () => clearInterval(interval);
  }, [
    activeTab?.id,
    automation.repeatCycles,
    automation.sessions,
    operation.busyAction,
    refreshWorkspace
  ]);

  const runAutomation = () => {
    if (activeTab === undefined) {
      runLog.addNotice("error", "No active browser tab was found.");
      return;
    }
    void automation.run(activeTab, refreshWorkspace);
  };

  const stopAutomation = () => {
    if (activeTab !== undefined) {
      void automation.stop(activeTab, refreshWorkspace);
    }
  };

  const stopAutomationTab = (tabId: number) => {
    void automation.stopByTabId(tabId, refreshWorkspace);
  };

  const startRecording = () => {
    if (activeTab === undefined) {
      runLog.addNotice("error", "No active browser tab was found.");
      return;
    }
    void recorder.start(activeTab, refreshWorkspace);
  };

  const stopRecording = () => {
    if (activeTab !== undefined) {
      void recorder.stop(activeTab, refreshWorkspace);
    }
  };

  const createRecordedPreset = async (
    fields: RecordedPresetFields,
    confirmedActivePresetIds?: readonly string[]
  ) => {
    if (activeTab === undefined) return;
    const preset = await recorder.createPreset(
      activeTab,
      fields,
      refreshWorkspace,
      confirmedActivePresetIds
    );
    if (preset !== undefined) {
      presets.selectPreset(preset.id);
      await presets.refresh();
    }
  };

  const openPresetCreator = () => {
    presets.openNew();
    setActiveView("presets");
  };

  const openPresetEditor = (presetId: string) => {
    void (async () => {
      try {
        let preset =
          presets.listState.status === "ready"
            ? presets.listState.presets.find(({ id }) => id === presetId)
            : undefined;
        if (preset === undefined) {
          const response = await sendRuntimeMessage({
            type: AUTOMATION_RUNTIME_MESSAGE,
            action: "presets"
          });
          if (!response.ok || response.result.kind !== "presets") {
            throw new Error(
              response.ok
                ? "The extension returned an unexpected preset response."
                : response.error
            );
          }
          preset = response.result.presets.find(({ id }) => id === presetId);
        }
        if (preset === undefined) {
          throw new Error("The preset is no longer in storage.");
        }
        presets.selectPreset(preset.id);
        presets.openEdit(preset);
        setActiveView("presets");
      } catch (error) {
        runLog.addNotice(
          "error",
          `Unable to edit the site preset: ${errorMessage(error)}`,
          errorTechnicalDetails(error)
        );
        void presets.refresh(true);
      }
    })();
  };

  const currentManualStatus =
    automation.manualStatus?.tabId === activeTab?.id
      ? automation.manualStatus
      : undefined;
  const currentRecorderStatus =
    recorder.status?.tabId === activeTab?.id ? recorder.status : undefined;
  useEffect(() => {
    void naturalPacing.refresh(currentManualStatus?.presetId);
  }, [currentManualStatus?.presetId, naturalPacing.refresh]);
  const recorderIsActive =
    currentRecorderStatus?.state === "recording" ||
    currentRecorderStatus?.state === "stopping";
  const canRun =
    currentManualStatus?.state === "ready" &&
    !recorderIsActive &&
    operation.busyAction === undefined;
  const currentTabHasActiveCycle =
    currentManualStatus?.state === "running" ||
    currentManualStatus?.state === "waiting";
  const canRecord =
    currentRecorderStatus?.canRecord === true &&
    !currentTabHasActiveCycle &&
    operation.busyAction === undefined;
  const workspaceState = getWorkspaceState(
    currentManualStatus?.state,
    currentRecorderStatus?.state,
    currentManualStatus?.state === "unavailable"
      ? currentManualStatus.reason
      : undefined
  );

  return (
    <main className="app-shell">
      <section className="workspace" aria-labelledby="app-title">
        <SidePanelNavigation activeView={activeView} onChange={setActiveView} />
        <div className="workspace-main">
          <header className="workspace-header">
            <div className="workspace-brand">
              <Icon className="workspace-brand__mark" name="bolt" size={24} />
              <h1 id="app-title">Automation</h1>
            </div>
            <div className="workspace-header__actions">
              <StatusBadge status={workspaceState} />
              <span aria-hidden="true" className="workspace-header__divider" />
              <span aria-hidden="true" className="workspace-settings">
                <Icon name="settings" size={20} />
              </span>
            </div>
          </header>

          <div className="workspace-content">
            <section
              aria-label="Dashboard"
              className="workspace-view"
              hidden={activeView !== "dashboard"}
            >
              <DashboardPanel
                activeTab={activeTab}
                busyAction={operation.busyAction}
                canRecord={canRecord}
                canRun={canRun}
                currentTabHasActiveCycle={currentTabHasActiveCycle}
                cycleLogs={runLog.cycleLogs}
                manualStatus={currentManualStatus}
                naturalPacingPanel={
                  <NaturalPacingPanel
                    enabled={naturalPacing.enabled}
                    error={naturalPacing.error}
                    loading={naturalPacing.loading}
                    maximumDelay={naturalPacing.maximumDelay}
                    minimumDelay={naturalPacing.minimumDelay}
                    onEnabledChange={naturalPacing.setEnabled}
                    onMaximumDelayChange={naturalPacing.setMaximumDelay}
                    onMinimumDelayChange={naturalPacing.setMinimumDelay}
                    onSave={() => void naturalPacing.save()}
                    saving={naturalPacing.saving}
                    validationErrors={naturalPacing.validationErrors}
                  />
                }
                onCreatePreset={openPresetCreator}
                onEditPreset={openPresetEditor}
                onRecord={startRecording}
                onRefresh={() =>
                  void refreshActiveTab().catch((error: unknown) => {
                    reportActiveTabError("Unable to inspect the active tab", error);
                  })
                }
                onRun={runAutomation}
                onStop={stopAutomation}
                onStopTab={stopAutomationTab}
                onStopAll={() =>
                  void automation.stopAll(activeTab, refreshWorkspace)
                }
                onStopRecording={stopRecording}
                repeatCycles={automation.repeatCycles}
                recorderStatus={currentRecorderStatus}
                sessions={automation.sessions}
                stepLogs={runLog.stepLogs}
              />

              <RecordedDraftPanel
                busyAction={operation.busyAction}
                conflict={recorder.pendingConflict}
                draft={recorder.draft}
                error={recorder.draftError}
                loading={recorder.draftLoading}
                onCancelConflict={recorder.cancelConflict}
                onCreatePreset={(fields, confirmedIds) =>
                  void createRecordedPreset(fields, confirmedIds)
                }
                onDiscard={() => {
                  if (activeTab !== undefined) {
                    void recorder.discardDraft(activeTab, refreshWorkspace);
                  }
                }}
                onSave={(steps) => {
                  if (activeTab !== undefined) {
                    void recorder.saveDraft(activeTab, steps, refreshWorkspace);
                  }
                }}
                status={currentRecorderStatus}
              />
            </section>

            <section
              aria-label="Presets and editor"
              className="workspace-view"
              hidden={activeView !== "presets"}
            >
              <PresetManagementPanel
                busyAction={operation.busyAction}
                deleteConfirmationPresetId={presets.deleteConfirmationPresetId}
                deletingPresetId={presets.deletingPresetId}
                editor={presets.editor}
                listState={presets.listState}
                onCancelDelete={presets.cancelDelete}
                onCancelEditor={presets.cancelEditor}
                onCancelImport={presets.cancelImport}
                onConfirmDelete={(preset) => void presets.remove(preset)}
                onDuplicate={presets.openDuplicate}
                onEdit={presets.openEdit}
                onExport={(preset) => void presets.exportPreset(preset)}
                onImport={(source, overwrite) =>
                  void presets.importPreset(source, overwrite)
                }
                onNew={presets.openNew}
                onRefresh={() => void presets.refresh(true)}
                onRequestDelete={presets.confirmDelete}
                onSave={(fields) => void presets.save(fields)}
                onSelect={presets.selectPreset}
                operationError={presets.operationError}
                pendingImport={presets.pendingImport}
                saveError={presets.saveError}
                selectedPresetId={presets.selectedPresetId}
              />
            </section>

            <section
              aria-label="Run log"
              className="workspace-view"
              hidden={activeView !== "run-log"}
            >
              <RunLogPanel
                currentTabId={activeTab?.id}
                cycleLogs={runLog.cycleLogs}
                notices={runLog.notices}
                naturalPacingLogs={runLog.naturalPacingLogs}
                onClear={() => {
                  if (activeTab !== undefined) void runLog.clear(activeTab.id);
                }}
                recorderLogs={runLog.recorderLogs}
                stepLogs={runLog.stepLogs}
              />
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}

type WorkspaceState =
  | "Ready"
  | "Running"
  | "Waiting"
  | "Recording"
  | "Disabled"
  | "Unavailable"
  | "Stopped"
  | "Failed";

export function getWorkspaceState(
  manualState?: string,
  recorderState?: string,
  unavailableReason?: string
): WorkspaceState {
  if (recorderState === "recording" || recorderState === "stopping") {
    return "Recording";
  }
  if (recorderState === "failed") return "Failed";
  if (manualState === "running") return "Running";
  if (manualState === "waiting") return "Waiting";
  if (manualState === "stopped") return "Stopped";
  if (manualState === "failed") return "Failed";
  if (manualState === "unavailable") {
    return unavailableReason === "preset-disabled" ? "Disabled" : "Unavailable";
  }
  return "Ready";
}

export { createPresetFilename } from "./features/presets";
export { PresetOverwriteConfirmation } from "./features/presets";
export {
  sendRuntimeMessage,
  type RuntimeMessageOptions
} from "./runtime/runtime-client";

export default App;
