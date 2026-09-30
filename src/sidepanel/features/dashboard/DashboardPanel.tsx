import type { ManualRunStatus } from "../../../core/application/manual-run-controller";
import type { RecorderPanelStatus } from "../../../core/application/recorder-panel-controller";
import type { RepeatCycleStatusView } from "../../../core/application/repeat-cycle-status-controller";
import type { RepeatCycleLogEntry } from "../../../core/domain/repeat-cycle-log-entry";
import type { RunSession } from "../../../core/domain/run-session";
import type { StepLogEntry } from "../../../core/domain/step-log-entry";
import type { ReactNode } from "react";
import { Alert, Badge, Button, Card, type StatusTone } from "../../components";
import type { ActiveTab } from "../../types";
import { AutomationSessionsPanel } from "../automation";
import { RecorderControls } from "../recorder";

export type DashboardState =
  | "Ready"
  | "Running"
  | "Waiting"
  | "Recording"
  | "Disabled"
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
  readonly onCreatePreset: () => void;
  readonly onEditPreset: (presetId: string) => void;
  readonly onRun: () => void;
  readonly onRecord: () => void;
  readonly onStop: () => void;
  readonly onStopTab?: (tabId: number) => void;
  readonly onStopRecording: () => void;
  readonly onStopAll: () => void;
  readonly naturalPacingPanel?: ReactNode;
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
  onCreatePreset,
  onEditPreset,
  onRun,
  onRecord,
  onStop,
  onStopTab,
  onStopRecording,
  onStopAll,
  naturalPacingPanel
}: DashboardPanelProps) {
  const currentManualStatus = statusForTab(activeTab, manualStatus);
  const currentRecorderStatus = statusForTab(activeTab, recorderStatus);
  const state = dashboardState(currentManualStatus, currentRecorderStatus);
  const location = tabLocation(activeTab?.url);
  const contextPreset =
    currentManualStatus?.presetId === undefined ? undefined : currentManualStatus;
  const contextPresetId = contextPreset?.presetId;
  const hasNoPreset =
    currentManualStatus?.state === "unavailable" &&
    currentManualStatus.reason === "no-preset";
  return (
    <section className="dashboard" aria-labelledby="dashboard-title">
      <Card className="card current-site-card">
        <div className="section-heading dashboard-heading">
          <div>
            <p className="section-label">Current site</p>
            <h2
              aria-label="Current site"
              id="dashboard-title"
              title={currentManualStatus?.hostname ?? location.hostname}
            >
              {currentManualStatus?.hostname ?? location.hostname}
            </h2>
            <p className="current-site-summary">
              {currentManualStatus?.presetName === undefined
                ? "No automation assigned"
                : "1 automation assigned"}
            </p>
          </div>
          <div className="dashboard-heading-actions">
            <Badge tone={dashboardTone(state)}>{state}</Badge>
            <Button onClick={onRefresh} size="small" variant="secondary">
              Refresh
            </Button>
          </div>
        </div>

        <dl className="dashboard-site-details">
          <div>
            <dt>Protocol</dt>
            <dd>{location.protocol}</dd>
          </div>
          <div className="dashboard-title-row">
            <dt>Page title</dt>
            <dd title={activeTab?.title}>{activeTab?.title ?? "No active tab"}</dd>
          </div>
        </dl>
      </Card>

      <Card className="card dashboard-card automation-card">
        <p className="section-label">Automation</p>
        {contextPreset !== undefined ? (
          <div className="dashboard-preset" aria-label="Assigned preset">
            <div className="dashboard-preset-copy">
              <strong>{contextPreset.presetName}</strong>
              <span>
                {contextPreset.presetDescription ??
                  "No description provided."}
              </span>
            </div>
            {contextPreset.stepCount !== undefined && (
              <small>{contextPreset.stepCount} steps</small>
            )}
            <Badge tone={dashboardTone(state)}>{state}</Badge>
          </div>
        ) : !hasNoPreset ? (
          <div className="dashboard-preset" aria-label="Assigned preset">
            <strong>{presetFallback(currentManualStatus)}</strong>
          </div>
        ) : null}

        <Alert
          aria-atomic="true"
          aria-live="polite"
          className="dashboard-status"
          tone={dashboardTone(state)}
        >
          {dashboardMessage(
            activeTab,
            currentManualStatus,
            currentRecorderStatus,
            state
          )}
        </Alert>

        {currentManualStatus !== undefined &&
          "hasCustomCode" in currentManualStatus &&
          currentManualStatus.hasCustomCode === true && (
          <Alert className="dashboard-custom-code-warning" tone="warning">
            This preset contains custom JavaScript. Running it gives that code
            access to the current page. Run only code you trust.
          </Alert>
        )}

        {hasNoPreset ? (
          <div className="context-preset-empty" role="status">
            <div>
              <strong>No automation for {location.hostname}</strong>
              <span>Create a preset or record actions on this page.</span>
            </div>
            <div className="context-preset-empty__actions">
              <Button onClick={onCreatePreset}>Create preset</Button>
              <Button
                disabled={!canRecord}
                onClick={onRecord}
                variant="secondary"
              >
                Record actions
              </Button>
            </div>
          </div>
        ) : (
          <>
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

            {contextPresetId !== undefined && (
              <Button
                className="context-preset-edit"
                onClick={() => onEditPreset(contextPresetId)}
                variant="secondary"
              >
                Edit preset
              </Button>
            )}

            <RecorderControls
              busyAction={busyAction}
              canRecord={canRecord}
              hostname={location.hostname}
              onRecord={onRecord}
              onStopRecording={onStopRecording}
              status={currentRecorderStatus}
            />
          </>
        )}
      </Card>

      {contextPreset !== undefined && (
        <Card className="card dashboard-card repeat-settings-card">
          <div className="pacing-heading">
            <div>
              <p className="section-label">Scheduling</p>
              <h2>Repeat cycle</h2>
              <p>
                {contextPreset.repeatEnabled
                  ? `Runs again ${contextPreset.repeatIntervalMinutes} minute(s) after completion.`
                  : "Runs once when started manually."}
              </p>
            </div>
            <Badge tone={contextPreset.repeatEnabled ? "info" : "neutral"}>
              {contextPreset.repeatEnabled ? "Enabled" : "Off"}
            </Badge>
          </div>
        </Card>
      )}

      {contextPreset !== undefined && naturalPacingPanel}

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
  if (
    manualStatus?.state === "unavailable" &&
    manualStatus.reason === "preset-disabled"
  ) {
    return "Disabled";
  }
  return "Unavailable";
}

function dashboardTone(state: DashboardState): StatusTone {
  if (state === "Ready") return "success";
  if (state === "Running") return "info";
  if (state === "Waiting") return "warning";
  if (state === "Recording") return "error";
  if (state === "Disabled") return "neutral";
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
