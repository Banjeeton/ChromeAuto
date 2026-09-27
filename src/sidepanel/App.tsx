import { useCallback, useEffect, useState } from "react";

import {
  PLAYWRIGHT_CRX_SPIKE_MESSAGE,
  type PlaywrightSpikeMessage,
  type PlaywrightSpikeResponse,
  type PlaywrightSpikeResult
} from "../shared/types/playwright-crx-spike";

type TabAction = "snapshot" | "reload" | "modal" | "detach";

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
    const response = await sendSpikeMessage({
      type: PLAYWRIGHT_CRX_SPIKE_MESSAGE,
      action: "sessions"
    });

    if (response.ok && Array.isArray(response.result)) {
      setAttachedTabIds(response.result);
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

  const detachAll = async () => {
    setBusyAction("detach-all");
    try {
      const response = await sendSpikeMessage({
        type: PLAYWRIGHT_CRX_SPIKE_MESSAGE,
        action: "detach-all"
      });
      if (!response.ok) {
        throw new Error(response.error);
      }
      setAttachedTabIds([]);
      addLog("success", "All Playwright tab sessions were detached.");
    } catch (error) {
      addLog(
        "error",
        `Detach all failed: ${error instanceof Error ? error.message : String(error)}`
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
          both tabs, then Reload and Detach in only one tab.
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
            <ActionButton
              action="detach"
              busyAction={busyAction}
              disabled={!hasActiveTab}
              label="Detach tab"
              onClick={runTabAction}
              secondary
            />
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
              disabled={busyAction !== undefined || attachedTabIds.length === 0}
              onClick={() => void detachAll()}
            >
              Detach all
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

function labelForAction(action: TabAction): string {
  const labels = {
    snapshot: "Snapshot",
    reload: "Reload",
    modal: "HTML modal",
    detach: "Detach"
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
