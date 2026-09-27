import { useCallback, useEffect, useState } from "react";

import {
  AUTOMATION_RUNTIME_MESSAGE,
  type AutomationRuntimeMessage,
  type AutomationRuntimeResponse,
  type AutomationRuntimeResult
} from "../shared/types/automation-runtime";
import type { RunSession } from "../core/domain/run-session";
import {
  PLAYWRIGHT_CRX_SPIKE_MESSAGE,
  type PlaywrightSpikeMessage,
  type PlaywrightSpikeResponse,
  type PlaywrightSpikeResult
} from "../shared/types/playwright-crx-spike";

type TabAction = "snapshot" | "reload" | "modal";

type LogEntry = {
  id: number;
  status: "error" | "success";
  text: string;
};

function App() {
  const [activeTabId, setActiveTabId] = useState<number>();
  const [attachedTabIds, setAttachedTabIds] = useState<number[]>([]);
  const [busyAction, setBusyAction] = useState<string>();
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback(
    (status: LogEntry["status"], text: string) => {
      setLogs((current) => [
        { id: Date.now() + Math.random(), status, text },
        ...current
      ]);
    },
    []
  );

  const refreshActiveTab = useCallback(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    setActiveTabId(tab?.id);
  }, []);

  const refreshSessions = useCallback(async () => {
    const response = await sendRuntimeMessage({
      type: AUTOMATION_RUNTIME_MESSAGE,
      action: "sessions"
    });

    if (response.ok && isRunSessionArray(response.result)) {
      setAttachedTabIds(response.result.map((session) => session.tabId));
    }
  }, []);

  useEffect(() => {
    void refreshActiveTab();
    void refreshSessions();

    const handleActivation = () => {
      void refreshActiveTab();
    };
    chrome.tabs.onActivated.addListener(handleActivation);

    return () => chrome.tabs.onActivated.removeListener(handleActivation);
  }, [refreshActiveTab, refreshSessions]);

  const runTabAction = async (action: TabAction) => {
    if (activeTabId === undefined) {
      addLog("error", "No active browser tab was found.");
      return;
    }

    setBusyAction(action);
    try {
      const response = await sendSpikeMessage({
        type: PLAYWRIGHT_CRX_SPIKE_MESSAGE,
        action,
        tabId: activeTabId
      });

      if (!response.ok) {
        throw new Error(response.error);
      }

      addLog(
        "success",
        `${labelForAction(action)} passed for tab #${activeTabId}${formatResult(response.result)}`
      );
      await refreshSessions();
    } catch (error) {
      addLog(
        "error",
        `${labelForAction(action)} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setBusyAction(undefined);
    }
  };

  const stopActiveTab = async () => {
    if (activeTabId === undefined) {
      addLog("error", "No active browser tab was found.");
      return;
    }

    setBusyAction("stop");
    try {
      const response = await sendRuntimeMessage({
        type: AUTOMATION_RUNTIME_MESSAGE,
        action: "stop",
        tabId: activeTabId
      });
      if (!response.ok) {
        throw new Error(response.error);
      }

      const result = response.result;
      const stopped =
        !Array.isArray(result) && "stopped" in result && result.stopped;
      addLog(
        "success",
        stopped
          ? `Automation stopped for tab #${activeTabId}.`
          : `Tab #${activeTabId} has no active automation.`
      );
      await refreshSessions();
    } catch (error) {
      addLog(
        "error",
        `Stop failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setBusyAction(undefined);
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
      setAttachedTabIds([]);
      addLog("success", "All automation sessions were stopped.");
    } catch (error) {
      addLog(
        "error",
        `Stop All failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setBusyAction(undefined);
    }
  };

  const hasActiveTab = activeTabId !== undefined;

  return (
    <main className="app-shell">
      <section className="workspace" aria-labelledby="app-title">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Chrome Automation</p>
            <h1 id="app-title">Playwright CRX smoke test</h1>
          </div>
          <span className="status-dot" title="Extension is running" />
        </header>

        <div className="notice">
          Open the local spike fixture in two tabs. Run Snapshot and Modal in
          both tabs, then Reload and Stop in only one tab.
        </div>

        <section className="card" aria-labelledby="active-tab-title">
          <div className="section-heading">
            <div>
              <p className="section-label">Current target</p>
              <h2 id="active-tab-title">
                {hasActiveTab ? `Tab #${activeTabId}` : "No active tab"}
              </h2>
            </div>
            <button
              className="icon-button"
              onClick={() => void refreshActiveTab()}
            >
              Refresh
            </button>
          </div>

          <div className="button-grid">
            <ActionButton
              action="snapshot"
              busyAction={busyAction}
              disabled={!hasActiveTab}
              label="Attach & snapshot"
              onClick={runTabAction}
            />
            <ActionButton
              action="reload"
              busyAction={busyAction}
              disabled={!hasActiveTab}
              label="Test reload"
              onClick={runTabAction}
            />
            <ActionButton
              action="modal"
              busyAction={busyAction}
              disabled={!hasActiveTab}
              label="Test HTML modal"
              onClick={runTabAction}
            />
            <button
              className="action-button secondary"
              disabled={
                !hasActiveTab ||
                busyAction === "stop" ||
                busyAction === "stop-all"
              }
              onClick={() => void stopActiveTab()}
            >
              {busyAction === "stop" ? "Stopping…" : "Stop current tab"}
            </button>
          </div>
        </section>

        <section className="card" aria-labelledby="sessions-title">
          <div className="section-heading">
            <div>
              <p className="section-label">Independent sessions</p>
              <h2 id="sessions-title">Attached tabs</h2>
            </div>
            <button
              className="icon-button danger-text"
              disabled={
                busyAction === "stop" ||
                busyAction === "stop-all" ||
                (busyAction === undefined && attachedTabIds.length === 0)
              }
              onClick={() => void stopAll()}
            >
              Stop All
            </button>
          </div>

          {attachedTabIds.length === 0 ? (
            <p className="empty-state">No tabs attached yet.</p>
          ) : (
            <div className="session-list">
              {attachedTabIds.map((tabId) => (
                <span className="session-pill" key={tabId}>
                  <span className="session-indicator" /> Tab #{tabId}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="card log-card" aria-labelledby="log-title">
          <div className="section-heading">
            <div>
              <p className="section-label">Verification</p>
              <h2 id="log-title">Run log</h2>
            </div>
            <button className="icon-button" onClick={() => setLogs([])}>
              Clear
            </button>
          </div>

          {logs.length === 0 ? (
            <p className="empty-state">Test results will appear here.</p>
          ) : (
            <ol className="log-list">
              {logs.map((entry) => (
                <li className={`log-entry ${entry.status}`} key={entry.id}>
                  <span>{entry.status === "success" ? "PASS" : "FAIL"}</span>
                  <p>{entry.text}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </section>
    </main>
  );
}

type ActionButtonProps = {
  action: TabAction;
  busyAction?: string;
  disabled: boolean;
  label: string;
  onClick: (action: TabAction) => Promise<void>;
  secondary?: boolean;
};

function ActionButton({
  action,
  busyAction,
  disabled,
  label,
  onClick,
  secondary = false
}: ActionButtonProps) {
  return (
    <button
      className={secondary ? "action-button secondary" : "action-button"}
      disabled={disabled || busyAction !== undefined}
      onClick={() => void onClick(action)}
    >
      {busyAction === action ? "Running…" : label}
    </button>
  );
}

async function sendSpikeMessage(
  message: PlaywrightSpikeMessage
): Promise<PlaywrightSpikeResponse> {
  return chrome.runtime.sendMessage(message) as Promise<PlaywrightSpikeResponse>;
}

async function sendRuntimeMessage(
  message: AutomationRuntimeMessage
): Promise<AutomationRuntimeResponse> {
  return chrome.runtime.sendMessage(message) as Promise<AutomationRuntimeResponse>;
}

function isRunSessionArray(
  result: AutomationRuntimeResult
): result is readonly RunSession[] {
  return (
    Array.isArray(result) &&
    result.every(
      (session) =>
        typeof session === "object" &&
        session !== null &&
        "sessionId" in session &&
        "tabId" in session
    )
  );
}

function labelForAction(action: TabAction): string {
  const labels = {
    snapshot: "Snapshot",
    reload: "Reload",
    modal: "HTML modal"
  } as const;
  return labels[action];
}

function formatResult(result: PlaywrightSpikeResult): string {
  if (result === undefined) {
    return ".";
  }
  return `: ${JSON.stringify(result)}`;
}

export default App;
