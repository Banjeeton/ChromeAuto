import { useCallback, useEffect, useState } from "react";

import {
  PRESET_STORAGE_KEY,
  RECORDER_SESSION_STORAGE_KEY,
  REPEAT_CYCLE_STORAGE_KEY
} from "../shared/constants";
import {
  AutomationSessionsPanel,
  AutomationStatusPanel,
  useAutomationController
} from "./features/automation";
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
import { useOperationState } from "./hooks/use-operation-state";
import {
  errorMessage,
  errorTechnicalDetails
} from "./runtime/runtime-client";
import type { ActiveTab } from "./types";

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>();
  const operation = useOperationState();
  const runLog = useRunLogController();
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
    async (tabId: number) => {
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
      setActiveTab(undefined);
      automation.reset();
      recorder.reset();
      return;
    }

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
  }, [presets.refresh, refreshActiveTab, reportActiveTabError]);

  useEffect(() => {
    const tabId = activeTab?.id;
    if (tabId === undefined || recorder.status?.state !== "recording") return;

    const interval = setInterval(() => {
      void runLog.refresh(tabId).catch(() => undefined);
    }, 1_000);
    return () => clearInterval(interval);
  }, [activeTab?.id, recorder.status?.state, runLog.refresh]);

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

  const recorderIsActive =
    recorder.status?.state === "recording" ||
    recorder.status?.state === "stopping";
  const canRun =
    automation.manualStatus?.state === "ready" &&
    !recorderIsActive &&
    operation.busyAction === undefined;
  const currentTabHasActiveCycle =
    automation.manualStatus?.state === "running" ||
    automation.manualStatus?.state === "waiting";
  const canRecord =
    recorder.status?.canRecord === true &&
    !currentTabHasActiveCycle &&
    operation.busyAction === undefined;

  return (
    <main className="app-shell">
      <section className="workspace" aria-labelledby="app-title">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Chrome Automation</p>
            <h1 id="app-title">Automation Runner</h1>
          </div>
          <span className="status-dot" title="Extension is running" />
        </header>

        <AutomationStatusPanel
          activeTab={activeTab}
          busyAction={operation.busyAction}
          canRecord={canRecord}
          canRun={canRun}
          currentTabHasActiveCycle={currentTabHasActiveCycle}
          manualStatus={automation.manualStatus}
          onRecord={startRecording}
          onRefresh={() =>
            void refreshActiveTab().catch((error: unknown) => {
              reportActiveTabError("Unable to inspect the active tab", error);
            })
          }
          onRun={runAutomation}
          onStop={stopAutomation}
          onStopRecording={stopRecording}
          recorderStatus={recorder.status}
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
          status={recorder.status}
        />

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

        <AutomationSessionsPanel
          busyAction={operation.busyAction}
          onStopAll={() =>
            void automation.stopAll(activeTab, refreshWorkspace)
          }
          repeatCycles={automation.repeatCycles}
          sessions={automation.sessions}
        />

        <RunLogPanel
          cycleLogs={runLog.cycleLogs}
          notices={runLog.notices}
          onClear={() => {
            if (activeTab !== undefined) void runLog.clear(activeTab.id);
          }}
          recorderLogs={runLog.recorderLogs}
          stepLogs={runLog.stepLogs}
        />
      </section>
    </main>
  );
}

export { createPresetFilename } from "./features/presets";
export { PresetOverwriteConfirmation } from "./features/presets";
export {
  sendRuntimeMessage,
  type RuntimeMessageOptions
} from "./runtime/runtime-client";

export default App;
