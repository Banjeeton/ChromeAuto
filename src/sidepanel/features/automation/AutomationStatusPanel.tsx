import type { ManualRunStatus } from "../../../core/application/manual-run-controller";
import type { RecorderPanelStatus } from "../../../core/application/recorder-panel-controller";
import type { ActiveTab } from "../../types";
import { RecorderControls } from "../recorder/RecorderControls";

export interface AutomationStatusPanelProps {
  readonly activeTab?: ActiveTab;
  readonly manualStatus?: ManualRunStatus;
  readonly recorderStatus?: RecorderPanelStatus;
  readonly busyAction?: string;
  readonly canRun: boolean;
  readonly canRecord: boolean;
  readonly currentTabHasActiveCycle: boolean;
  readonly onRefresh: () => void;
  readonly onRun: () => void;
  readonly onStop: () => void;
  readonly onRecord: () => void;
  readonly onStopRecording: () => void;
}

export function AutomationStatusPanel({
  activeTab,
  manualStatus,
  recorderStatus,
  busyAction,
  canRun,
  canRecord,
  currentTabHasActiveCycle,
  onRefresh,
  onRun,
  onStop,
  onRecord,
  onStopRecording
}: AutomationStatusPanelProps) {
  return (
    <>
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
          <button className="icon-button" onClick={onRefresh}>Refresh</button>
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
          <button className="action-button" disabled={!canRun} onClick={onRun}>
            {busyAction === "run" ? "Running…" : "Run automation"}
          </button>
          <button
            className="action-button secondary"
            disabled={!currentTabHasActiveCycle || busyAction === "stop"}
            onClick={onStop}
          >
            {busyAction === "stop" ? "Stopping…" : "Stop"}
          </button>
        </div>

        <RecorderControls
          busyAction={busyAction}
          canRecord={canRecord}
          onRecord={onRecord}
          onStopRecording={onStopRecording}
          status={recorderStatus}
        />
      </section>
    </>
  );
}

function statusMessage(status?: ManualRunStatus): string {
  if (status === undefined) return "Checking the active tab…";
  if (status.state === "ready") {
    return `Ready to run “${status.presetName}” on this site.`;
  }
  if (status.state === "running") {
    return `“${status.presetName}” is running in this tab.`;
  }
  if (status.state === "waiting") {
    return `“${status.presetName}” is waiting for its next run.`;
  }
  return status.message;
}

function statusTone(status?: ManualRunStatus): string {
  if (status?.state === "ready") return "ready";
  if (status?.state === "running" || status?.state === "waiting") {
    return "running";
  }
  return "muted";
}
