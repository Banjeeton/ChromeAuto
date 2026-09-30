import type { ManualRunStatus } from "../../../core/application/manual-run-controller";
import type { RecorderPanelStatus } from "../../../core/application/recorder-panel-controller";
import type { RepeatCycleStatusView } from "../../../core/application/repeat-cycle-status-controller";
import type { RepeatCycleLogEntry } from "../../../core/domain/repeat-cycle-log-entry";
import type { RunSession } from "../../../core/domain/run-session";
import type { StepLogEntry } from "../../../core/domain/step-log-entry";
import { Alert, Badge, Button, Card, type StatusTone } from "../../components";
import type { ActiveTab } from "../../types";
import { AutomationSessionsPanel } from "../automation";
import { RecorderControls } from "../recorder";

export type DashboardState =
  | "Ready"
  | "Running"
  | "Waiting"
  | "Recording"
  | "Unavailable";

export interface DashboardPanelProps {
  readonly activeTab?: ActiveTab;
  readonly manualStatus?: ManualRunStatus;
  readonly recorderStatus?: RecorderPanelStatus;
  readonly busyAction?: string;
  readonly canRun: boolean;
  readonly canRecord: boolean;
  readonly currentTabHasActiveCycle: boolean;
  readonly sessions: readonly RunSession[];
  readonly repeatCycles: readonly RepeatCycleStatusView[];
  readonly stepLogs?: readonly StepLogEntry[];
  readonly cycleLogs?: readonly RepeatCycleLogEntry[];
  readonly onRefresh: () => void;
  readonly onRun: () => void;
  readonly onRecord: () => void;
  readonly onStop: () => void;
  readonly onStopTab?: (tabId: number) => void;
  readonly onStopRecording: () => void;
  readonly onStopAll: () => void;
}

export function DashboardPanel({
  activeTab,
  manualStatus,
  recorderStatus,
  busyAction,
  canRun,
  canRecord,
  currentTabHasActiveCycle,
  sessions,
  repeatCycles,
  stepLogs,
  cycleLogs,
  onRefresh,
  onRun,
  onRecord,
  onStop,
  onStopTab,
  onStopRecording,
  onStopAll
}: DashboardPanelProps) {
  const currentManualStatus = statusForTab(activeTab, manualStatus);
  const currentRecorderStatus = statusForTab(activeTab, recorderStatus);
  const state = dashboardState(currentManualStatus, currentRecorderStatus);
  const location = tabLocation(activeTab?.url);
  return (
    <section className="dashboard" aria-labelledby="dashboard-title">
      <Card className="card dashboard-card">
        <div className="section-heading dashboard-heading">
          <div>
            <p className="section-label">Dashboard</p>
            <h2 id="dashboard-title">Current site</h2>
          </div>
          <div className="dashboard-heading-actions">
            <Badge tone={dashboardTone(state)}>{state}</Badge>
            <button className="icon-button" onClick={onRefresh} type="button">
              Refresh
            </button>
          </div>
        </div>

        <dl className="dashboard-site-details">
          <div className="dashboard-hostname">
            <dt>Hostname</dt>
            <dd>{currentManualStatus?.hostname ?? location.hostname}</dd>
          </div>
          <div>
            <dt>Protocol</dt>
            <dd>{location.protocol}</dd>
          </div>
          <div className="dashboard-title-row">
            <dt>Page title</dt>
            <dd title={activeTab?.title}>{activeTab?.title ?? "No active tab"}</dd>
          </div>
        </dl>

        <div className="dashboard-preset" aria-label="Assigned preset">
          <span>Assigned preset</span>
          <strong>
            {currentManualStatus?.presetName ?? presetFallback(currentManualStatus)}
          </strong>
          {currentManualStatus?.state === "ready" && (
            <small>{currentManualStatus.stepCount} steps</small>
          )}
        </div>

        <Alert className="dashboard-status" tone={dashboardTone(state)}>
          {dashboardMessage(
            activeTab,
            currentManualStatus,
            currentRecorderStatus,
            state
          )}
        </Alert>

        <RecorderControls
          busyAction={busyAction}
          canRecord={canRecord}
          hostname={location.hostname}
          onRecord={onRecord}
          onStopRecording={onStopRecording}
          status={currentRecorderStatus}
        />

        <div
          className="dashboard-actions automation-actions"
          aria-label="Automation actions"
        >
          <Button disabled={!canRun} onClick={onRun}>
            {busyAction === "run" ? "Running…" : "Run"}
          </Button>
          <Button
            disabled={
              !currentTabHasActiveCycle ||
              busyAction === "stop" ||
              busyAction === "stop-all"
            }
            onClick={onStop}
            variant="secondary"
          >
            {busyAction === "stop" ? "Stopping…" : "Stop"}
          </Button>
        </div>
      </Card>

      <AutomationSessionsPanel
        busyAction={busyAction}
        cycleLogs={cycleLogs}
        onStopTab={onStopTab}
        onStopAll={onStopAll}
        repeatCycles={repeatCycles}
        sessions={sessions}
        stepLogs={stepLogs}
      />
    </section>
  );
}

function statusForTab<T extends { readonly tabId: number }>(
  activeTab: ActiveTab | undefined,
  status: T | undefined
): T | undefined {
  return activeTab !== undefined && status?.tabId === activeTab.id
    ? status
    : undefined;
}

function dashboardState(
  manualStatus?: ManualRunStatus,
  recorderStatus?: RecorderPanelStatus
): DashboardState {
  if (
    recorderStatus?.state === "recording" ||
    recorderStatus?.state === "stopping"
  ) {
    return "Recording";
  }
  if (recorderStatus?.state === "failed") return "Unavailable";
  if (manualStatus?.state === "ready") return "Ready";
  if (manualStatus?.state === "running") return "Running";
  if (manualStatus?.state === "waiting") return "Waiting";
  return "Unavailable";
}

function dashboardTone(state: DashboardState): StatusTone {
  if (state === "Ready") return "success";
  if (state === "Running") return "info";
  if (state === "Waiting") return "warning";
  if (state === "Recording") return "error";
  return "neutral";
}

function dashboardMessage(
  activeTab: ActiveTab | undefined,
  manualStatus: ManualRunStatus | undefined,
  recorderStatus: RecorderPanelStatus | undefined,
  state: DashboardState
): string {
  if (activeTab === undefined) return "No active browser tab was found.";
  if (state === "Recording") {
    return recorderStatus?.message ?? "Recording actions in the current tab.";
  }
  if (recorderStatus?.state === "failed") return recorderStatus.message;
  if (manualStatus === undefined) return "Checking the active tab…";
  if (manualStatus.state === "ready") {
    return `Ready to run “${manualStatus.presetName}” on this site.`;
  }
  if (manualStatus.state === "running") {
    return `“${manualStatus.presetName}” is running in this tab.`;
  }
  if (manualStatus.state === "waiting") {
    return `“${manualStatus.presetName}” is waiting for its next run.`;
  }
  return manualStatus.message;
}

function presetFallback(status?: ManualRunStatus): string {
  if (status?.state === "unavailable" && status.reason === "no-preset") {
    return "No preset assigned";
  }
  if (status?.state === "unavailable" && status.reason === "unsupported-url") {
    return "Not available on this page";
  }
  return "No preset assigned";
}

function tabLocation(url?: string): { hostname: string; protocol: string } {
  if (url === undefined) return { hostname: "Unavailable", protocol: "Unknown" };
  try {
    const location = new URL(url);
    return {
      hostname: location.hostname || "Unavailable",
      protocol: location.protocol.replace(/:$/, "").toUpperCase() || "Unknown"
    };
  } catch {
    return { hostname: "Unavailable", protocol: "Unknown" };
  }
}
