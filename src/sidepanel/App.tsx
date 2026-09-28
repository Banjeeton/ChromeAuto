import { useCallback, useEffect, useRef, useState } from "react";

import type { ManualRunStatus } from "../core/application/manual-run-controller";
import {
  createPresetEditorDefaults,
  editableFieldsFromPreset,
  type PresetEditableFields
} from "../core/application/preset-editor";
import type { PresetV1 } from "../core/domain/preset";
import type { RunSession } from "../core/domain/run-session";
import type { StepLogEntry } from "../core/domain/step-log-entry";
import { PRESET_STORAGE_KEY } from "../shared/constants";
import {
  AUTOMATION_RUNTIME_MESSAGE,
  type AutomationRuntimeMessage,
  type AutomationRuntimeResponse
} from "../shared/types/automation-runtime";
import {
  PresetEditor,
  PresetList,
  type PresetListState
} from "./features/presets";

type ActiveTab = {
  id: number;
  title: string;
  url?: string;
};

type Notice = {
  id: number;
  status: "error" | "success";
  text: string;
};

type PresetEditorState = {
  readonly mode: "create" | "edit";
  readonly presetId?: string;
  readonly fields: PresetEditableFields;
};

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>();
  const [manualStatus, setManualStatus] = useState<ManualRunStatus>();
  const [sessions, setSessions] = useState<readonly RunSession[]>([]);
  const [stepLogs, setStepLogs] = useState<readonly StepLogEntry[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [busyAction, setBusyAction] = useState<string>();
  const [presetListState, setPresetListState] = useState<PresetListState>({
    status: "loading"
  });
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [presetEditor, setPresetEditor] = useState<PresetEditorState>();
  const [presetSaveError, setPresetSaveError] = useState<string>();
  const presetRequestId = useRef(0);

  const addNotice = useCallback(
    (status: Notice["status"], text: string) => {
      setNotices((current) => [
        { id: Date.now() + Math.random(), status, text },
        ...current
      ]);
    },
    []
  );

  const refreshWorkspace = useCallback(async (tabId: number) => {
    const [statusResponse, sessionsResponse, logsResponse] = await Promise.all([
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
        action: "logs",
        tabId
      })
    ]);

    if (!statusResponse.ok) {
      throw new Error(statusResponse.error);
    }
    if (statusResponse.result.kind === "manual-status") {
      setManualStatus(statusResponse.result.status);
    }
    if (
      sessionsResponse.ok &&
      sessionsResponse.result.kind === "sessions"
    ) {
      setSessions(sessionsResponse.result.sessions);
    }
    if (logsResponse.ok && logsResponse.result.kind === "logs") {
      setStepLogs(logsResponse.result.entries);
    }
  }, []);

  const refreshPresets = useCallback(async (showLoading = false) => {
    const requestId = ++presetRequestId.current;
    if (showLoading) {
      setPresetListState({ status: "loading" });
    }

    try {
      const response = await sendRuntimeMessage({
        type: AUTOMATION_RUNTIME_MESSAGE,
        action: "presets"
      });
      if (!response.ok) {
        throw new Error(response.error);
      }
      if (response.result.kind !== "presets") {
        throw new Error("The extension returned an unexpected preset response.");
      }

      const presets = sortPresets(response.result.presets);
      if (requestId !== presetRequestId.current) {
        return;
      }
      setPresetListState({ status: "ready", presets });
      setSelectedPresetId((current) =>
        current !== undefined && presets.some((preset) => preset.id === current)
          ? current
          : presets[0]?.id
      );
    } catch (error) {
      if (requestId !== presetRequestId.current) {
        return;
      }
      setPresetListState({
        status: "error",
        message: `Unable to load presets: ${
          error instanceof Error ? error.message : String(error)
        }`
      });
    }
  }, []);

  const refreshActiveTab = useCallback(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    if (tab?.id === undefined) {
      setActiveTab(undefined);
      setManualStatus(undefined);
      return;
    }

    setActiveTab({
      id: tab.id,
      title: tab.title ?? `Tab #${tab.id}`,
      ...(tab.url === undefined ? {} : { url: tab.url })
    });
    await refreshWorkspace(tab.id);
  }, [refreshWorkspace]);

  useEffect(() => {
    void refreshActiveTab().catch((error: unknown) => {
      addNotice(
        "error",
        error instanceof Error ? error.message : String(error)
      );
    });

    const handleActivation = () => {
      void refreshActiveTab();
    };
    const handleUpdated = (
      _tabId: number,
      changeInfo: { url?: string },
      tab: chrome.tabs.Tab
    ) => {
      if (tab.active && changeInfo.url !== undefined) {
        void refreshActiveTab();
      }
    };
    chrome.tabs.onActivated.addListener(handleActivation);
    chrome.tabs.onUpdated.addListener(handleUpdated);

    return () => {
      chrome.tabs.onActivated.removeListener(handleActivation);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    };
  }, [addNotice, refreshActiveTab]);

  useEffect(() => {
    void refreshPresets(true);

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName === "local" && PRESET_STORAGE_KEY in changes) {
        void refreshPresets();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      presetRequestId.current += 1;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [refreshPresets]);

  const runAutomation = async () => {
    if (activeTab === undefined) {
      addNotice("error", "No active browser tab was found.");
      return;
    }

    setBusyAction("run");
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
      if (!response.ok) {
        throw new Error(response.error);
      }
      if (response.result.kind === "run") {
        addNotice(
          "success",
          `Automation finished: ${response.result.run.executedSteps} steps executed.`
        );
      }
    } catch (error) {
      addNotice(
        "error",
        `Run failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setBusyAction(undefined);
      await refreshWorkspace(activeTab.id).catch(() => undefined);
    }
  };

  const stopActiveTab = async () => {
    if (activeTab === undefined) {
      return;
    }
    setBusyAction("stop");
    try {
      const response = await sendRuntimeMessage({
        type: AUTOMATION_RUNTIME_MESSAGE,
        action: "stop",
        tabId: activeTab.id
      });
      if (!response.ok) {
        throw new Error(response.error);
      }
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
        `Stop failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setBusyAction(undefined);
      await refreshWorkspace(activeTab.id).catch(() => undefined);
    }
  };

  const stopAll = async () => {
    setBusyAction("stop-all");
    try {
      const response = await sendRuntimeMessage({
        type: AUTOMATION_RUNTIME_MESSAGE,
        action: "stop-all"
      });
      if (!response.ok) {
        throw new Error(response.error);
      }
      addNotice("success", "All automation sessions were stopped.");
    } catch (error) {
      addNotice(
        "error",
        `Stop All failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setBusyAction(undefined);
      if (activeTab !== undefined) {
        await refreshWorkspace(activeTab.id).catch(() => undefined);
      }
    }
  };

  const clearLogs = async () => {
    if (activeTab === undefined) {
      return;
    }
    const response = await sendRuntimeMessage({
      type: AUTOMATION_RUNTIME_MESSAGE,
      action: "clear-logs",
      tabId: activeTab.id
    });
    if (response.ok) {
      setStepLogs([]);
      setNotices([]);
    }
  };

  const openNewPreset = () => {
    const site = defaultSiteFromUrl(activeTab?.url);
    setPresetSaveError(undefined);
    setPresetEditor({
      mode: "create",
      fields: createPresetEditorDefaults(site.hostname, site.protocol)
    });
  };

  const openPresetEditor = (preset: PresetV1) => {
    setPresetSaveError(undefined);
    setPresetEditor({
      mode: "edit",
      presetId: preset.id,
      fields: editableFieldsFromPreset(preset)
    });
  };

  const savePreset = async (fields: PresetEditableFields) => {
    if (presetEditor === undefined) {
      return;
    }

    setBusyAction("save-preset");
    setPresetSaveError(undefined);
    try {
      const message: AutomationRuntimeMessage =
        presetEditor.mode === "create"
          ? {
              type: AUTOMATION_RUNTIME_MESSAGE,
              action: "create-preset",
              fields
            }
          : {
              type: AUTOMATION_RUNTIME_MESSAGE,
              action: "update-preset",
              presetId: presetEditor.presetId ?? "",
              fields
            };
      const response = await sendRuntimeMessage(message);
      if (!response.ok) {
        throw new Error(response.error);
      }
      if (response.result.kind !== "preset-saved") {
        throw new Error("The extension returned an unexpected save response.");
      }

      setSelectedPresetId(response.result.preset.id);
      setPresetEditor(undefined);
      addNotice(
        "success",
        presetEditor.mode === "create"
          ? `Preset “${response.result.preset.name}” was created.`
          : `Preset “${response.result.preset.name}” was updated.`
      );
      await refreshPresets();
      if (activeTab !== undefined) {
        await refreshWorkspace(activeTab.id);
      }
    } catch (error) {
      setPresetSaveError(
        `Unable to save preset: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setBusyAction(undefined);
    }
  };

  const canRun = manualStatus?.state === "ready" && busyAction === undefined;
  const currentTabIsRunning = manualStatus?.state === "running";

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

        <div className={`notice ${statusTone(manualStatus)}`}>
          {statusMessage(manualStatus)}
        </div>

        <section className="card" aria-labelledby="active-tab-title">
          <div className="section-heading">
            <div className="target-heading">
              <p className="section-label">Current site</p>
              <h2 id="active-tab-title">
                {manualStatus?.hostname ?? "No supported site"}
              </h2>
              {activeTab !== undefined && (
                <p className="tab-title" title={activeTab.title}>
                  {activeTab.title}
                </p>
              )}
            </div>
            <button
              className="icon-button"
              onClick={() => void refreshActiveTab()}
            >
              Refresh
            </button>
          </div>

          {manualStatus?.presetName !== undefined && (
            <div className="preset-summary">
              <span>Preset</span>
              <strong>{manualStatus.presetName}</strong>
              {manualStatus.state === "ready" && (
                <small>{manualStatus.stepCount} steps</small>
              )}
            </div>
          )}

          <div className="button-grid primary-actions">
            <button
              className="action-button"
              disabled={!canRun}
              onClick={() => void runAutomation()}
            >
              {busyAction === "run" ? "Running…" : "Run automation"}
            </button>
            <button
              className="action-button secondary"
              disabled={!currentTabIsRunning || busyAction === "stop"}
              onClick={() => void stopActiveTab()}
            >
              {busyAction === "stop" ? "Stopping…" : "Stop"}
            </button>
          </div>
        </section>

        <section className="card" aria-labelledby="presets-title">
          <div className="section-heading">
            <div>
              <p className="section-label">Automation library</p>
              <h2 id="presets-title">Saved presets</h2>
            </div>
            <div className="header-actions">
              <button
                className="icon-button"
                onClick={() => void refreshPresets(true)}
                type="button"
              >
                Refresh
              </button>
              <button
                className="inline-button neutral"
                onClick={openNewPreset}
                type="button"
              >
                New preset
              </button>
            </div>
          </div>

          <PresetList
            onEdit={openPresetEditor}
            onRetry={() => void refreshPresets(true)}
            onSelect={setSelectedPresetId}
            selectedPresetId={selectedPresetId}
            state={presetListState}
          />

          {presetEditor !== undefined && (
            <PresetEditor
              initialFields={presetEditor.fields}
              key={`${presetEditor.mode}-${presetEditor.presetId ?? "new"}`}
              mode={presetEditor.mode}
              onCancel={() => {
                setPresetEditor(undefined);
                setPresetSaveError(undefined);
              }}
              onSave={(fields) => void savePreset(fields)}
              saveError={presetSaveError}
              saving={busyAction === "save-preset"}
            />
          )}
        </section>

        <section className="card" aria-labelledby="sessions-title">
          <div className="section-heading">
            <div>
              <p className="section-label">Independent sessions</p>
              <h2 id="sessions-title">Running tabs</h2>
            </div>
            <button
              className="icon-button danger-text"
              disabled={sessions.length === 0 || busyAction === "stop-all"}
              onClick={() => void stopAll()}
            >
              Stop All
            </button>
          </div>

          {sessions.length === 0 ? (
            <p className="empty-state">No automations are running.</p>
          ) : (
            <div className="session-list">
              {sessions.map((session) => (
                <span className="session-pill" key={session.sessionId}>
                  <span className="session-indicator" /> Tab #{session.tabId}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="card log-card" aria-labelledby="log-title">
          <div className="section-heading">
            <div>
              <p className="section-label">Current tab</p>
              <h2 id="log-title">Run log</h2>
            </div>
            <button className="icon-button" onClick={() => void clearLogs()}>
              Clear
            </button>
          </div>

          {notices.length === 0 && stepLogs.length === 0 ? (
            <p className="empty-state">Step results will appear here.</p>
          ) : (
            <ol className="log-list">
              {notices.map((notice) => (
                <li className={`log-entry ${notice.status}`} key={notice.id}>
                  <span>{notice.status === "success" ? "DONE" : "ERROR"}</span>
                  <p>{notice.text}</p>
                </li>
              ))}
              {[...stepLogs].reverse().map((entry) => (
                <li className={`log-entry ${entry.status}`} key={entry.id}>
                  <span>{entry.status.toUpperCase()}</span>
                  <p>
                    Step {entry.stepNumber}: {entry.stepName ?? entry.stepType}
                    {entry.error === undefined ? "" : ` — ${entry.error.message}`}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </section>
    </main>
  );
}

async function sendRuntimeMessage(
  message: AutomationRuntimeMessage
): Promise<AutomationRuntimeResponse> {
  return chrome.runtime.sendMessage(message) as Promise<AutomationRuntimeResponse>;
}

function statusMessage(status?: ManualRunStatus): string {
  if (status === undefined) {
    return "Checking the active tab…";
  }
  if (status.state === "ready") {
    return `Ready to run “${status.presetName}” on this site.`;
  }
  if (status.state === "running") {
    return `“${status.presetName}” is running in this tab.`;
  }
  return status.message;
}

function statusTone(status?: ManualRunStatus): string {
  if (status?.state === "ready") {
    return "ready";
  }
  if (status?.state === "running") {
    return "running";
  }
  return "muted";
}

export default App;

function sortPresets(presets: readonly PresetV1[]): readonly PresetV1[] {
  return [...presets].sort((left, right) =>
    left.name.localeCompare(right.name, "en", { sensitivity: "base" })
  );
}

function defaultSiteFromUrl(url?: string): {
  hostname: string;
  protocol: "http" | "https";
} {
  if (url === undefined) {
    return { hostname: "", protocol: "https" };
  }

  try {
    const parsed = new URL(url);
    return {
      hostname: parsed.hostname,
      protocol: parsed.protocol === "http:" ? "http" : "https"
    };
  } catch {
    return { hostname: "", protocol: "https" };
  }
}
