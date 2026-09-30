import { useMemo, useState } from "react";

import type { RepeatCycleStatusView } from "../../../core/application/repeat-cycle-status-controller";
import type { RepeatCycleLogEntry } from "../../../core/domain/repeat-cycle-log-entry";
import type { RunSession } from "../../../core/domain/run-session";
import type { StepLogEntry } from "../../../core/domain/step-log-entry";
import { Badge, Button, Card, ConfirmationDialog } from "../../components";

export interface AutomationSessionsPanelProps {
  readonly busyAction?: string;
  readonly repeatCycles: readonly RepeatCycleStatusView[];
  readonly sessions: readonly RunSession[];
  readonly stepLogs?: readonly StepLogEntry[];
  readonly cycleLogs?: readonly RepeatCycleLogEntry[];
  readonly onStopTab?: (tabId: number) => void;
  readonly onStopAll: () => void;
  readonly showStopAll?: boolean;
}

export interface SessionOutcomeView {
  readonly id: string;
  readonly tabId: number;
  readonly presetId: string;
  readonly state: "completed" | "stopped" | "failed";
  readonly recordedAt: string;
  readonly message: string;
}

export function AutomationSessionsPanel({
  busyAction,
  repeatCycles,
  sessions,
  stepLogs = [],
  cycleLogs = [],
  onStopTab,
  onStopAll,
  showStopAll = true
}: AutomationSessionsPanelProps) {
  const [confirmStopAll, setConfirmStopAll] = useState(false);
  const activeSessionIds = useMemo(
    () => new Set(sessions.map(({ sessionId }) => sessionId)),
    [sessions]
  );
  const outcomes = useMemo(
    () => buildRecentSessionOutcomes(stepLogs, cycleLogs, activeSessionIds),
    [activeSessionIds, cycleLogs, stepLogs]
  );
  const sessionByTabId = new Map(
    sessions.map((session) => [session.tabId, session])
  );
  const activeCount = new Set([
    ...sessions.map(({ tabId }) => tabId),
    ...repeatCycles.map(({ tabId }) => tabId)
  ]).size;

  return (
    <Card className="card" aria-labelledby="sessions-title">
      <div className="section-heading">
        <div>
          <p className="section-label">Independent tabs</p>
          <h2 id="sessions-title">Automation status</h2>
        </div>
        <Badge tone={activeCount > 0 ? "info" : "neutral"}>
          {activeCount} active
        </Badge>
      </div>

      {activeCount === 0 ? (
        <p className="empty-state">No automations are running.</p>
      ) : (
        <div className="automation-session-list">
          {repeatCycles.map((cycle) => (
            <RepeatCycleCard
              busyAction={busyAction}
              cycle={cycle}
              key={`${cycle.tabId}-${cycle.presetId}`}
              onStopTab={onStopTab}
              session={sessionByTabId.get(cycle.tabId)}
            />
          ))}
          {sessions
            .filter(
              (session) =>
                !repeatCycles.some((cycle) => cycle.tabId === session.tabId)
            )
            .map((session) => (
              <RunSessionCard
                busyAction={busyAction}
                key={session.sessionId}
                onStopTab={onStopTab}
                session={session}
              />
            ))}
        </div>
      )}

      {outcomes.length > 0 && (
        <section
          className="session-history"
          aria-labelledby="session-history-title"
        >
          <div className="session-history-heading">
            <h3 id="session-history-title">Recent sessions</h3>
            <span>{outcomes.length}</span>
          </div>
          <ol>
            {outcomes.map((outcome) => (
              <li
                className={`session-outcome ${outcome.state}`}
                key={outcome.id}
              >
                <Badge tone={outcomeTone(outcome.state)}>{outcome.state}</Badge>
                <div>
                  <strong>Tab #{outcome.tabId}</strong>
                  <span>{outcome.message}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {showStopAll && (
        <Button
          className="stop-all-button"
          disabled={activeCount === 0 || busyAction === "stop-all"}
          onClick={() => setConfirmStopAll(true)}
          variant="danger"
        >
          {busyAction === "stop-all" ? "Stopping all…" : "Stop All"}
        </Button>
      )}

      <ConfirmationDialog
        confirmLabel="Stop all automations"
        onCancel={() => setConfirmStopAll(false)}
        onConfirm={() => {
          setConfirmStopAll(false);
          onStopAll();
        }}
        open={confirmStopAll}
        title="Stop all automations?"
      >
        Every running automation and scheduled repeat in all tabs will be
        stopped. They will not resume automatically.
      </ConfirmationDialog>
    </Card>
  );
}

function RepeatCycleCard({
  cycle,
  session,
  busyAction,
  onStopTab
}: {
  readonly cycle: RepeatCycleStatusView;
  readonly session?: RunSession;
  readonly busyAction?: string;
  readonly onStopTab?: (tabId: number) => void;
}) {
  return (
    <article className={`automation-session-card ${cycle.state}`}>
      <div className="automation-session-heading">
        <div>
          <span className="session-indicator" />
          <strong>{cycle.presetName}</strong>
        </div>
        <Badge tone={cycle.state === "running" ? "info" : "warning"}>
          {cycle.state === "running" ? "Running" : "Waiting"}
        </Badge>
      </div>
      <dl className="automation-session-details">
        <div><dt>Hostname</dt><dd>{cycle.hostname}</dd></div>
        <div><dt>Tab</dt><dd>#{cycle.tabId}</dd></div>
        <div><dt>Interval</dt><dd>{cycle.intervalMinutes} min</dd></div>
        <div>
          <dt>Next run</dt>
          <dd>
            {cycle.nextRunAt === undefined
              ? "After completion"
              : formatNextRun(cycle.nextRunAt)}
          </dd>
        </div>
      </dl>
      {session?.currentStep !== undefined && (
        <CurrentStep step={session.currentStep} />
      )}
      {onStopTab !== undefined && (
        <Button
          disabled={busyAction === "stop" || busyAction === "stop-all"}
          onClick={() => onStopTab(cycle.tabId)}
          size="small"
          variant="secondary"
        >
          Stop tab #{cycle.tabId}
        </Button>
      )}
    </article>
  );
}

function RunSessionCard({
  session,
  busyAction,
  onStopTab
}: {
  readonly session: RunSession;
  readonly busyAction?: string;
  readonly onStopTab?: (tabId: number) => void;
}) {
  return (
    <article className={`automation-session-card ${session.status}`}>
      <div className="automation-session-heading">
        <div>
          <span className="session-indicator" />
          <strong>Tab #{session.tabId}</strong>
        </div>
        <Badge tone={session.status === "stopping" ? "warning" : "info"}>
          {session.status === "stopping" ? "Stopping" : "Running"}
        </Badge>
      </div>
      <p className="automation-session-preset">Preset: {session.presetId}</p>
      {session.currentStep !== undefined && (
        <CurrentStep step={session.currentStep} />
      )}
      {onStopTab !== undefined && (
        <Button
          disabled={
            busyAction === "stop" ||
            busyAction === "stop-all" ||
            session.status === "stopping"
          }
          onClick={() => onStopTab(session.tabId)}
          size="small"
          variant="secondary"
        >
          Stop tab #{session.tabId}
        </Button>
      )}
    </article>
  );
}

function CurrentStep({
  step
}: {
  readonly step: NonNullable<RunSession["currentStep"]>;
}) {
  return (
    <div className="current-step" aria-label="Current automation step">
      <span>Current step</span>
      <strong>#{step.stepNumber} · {step.stepType}</strong>
      <small>{step.stepName ?? step.stepId}</small>
    </div>
  );
}

export function buildRecentSessionOutcomes(
  stepLogs: readonly StepLogEntry[],
  cycleLogs: readonly RepeatCycleLogEntry[],
  activeSessionIds: ReadonlySet<string> = new Set()
): readonly SessionOutcomeView[] {
  const latestSteps = new Map<string, StepLogEntry>();
  for (const entry of stepLogs) {
    if (activeSessionIds.has(entry.sessionId)) continue;
    const existing = latestSteps.get(entry.sessionId);
    if (existing === undefined || existing.recordedAt < entry.recordedAt) {
      latestSteps.set(entry.sessionId, entry);
    }
  }

  const stepOutcomes: SessionOutcomeView[] = [...latestSteps.values()].map(
    (entry) => ({
      id: `run-${entry.sessionId}`,
      tabId: entry.tabId,
      presetId: entry.presetId,
      state:
        entry.status === "failed"
          ? "failed"
          : entry.status === "stopped"
            ? "stopped"
            : "completed",
      recordedAt: entry.recordedAt,
      message:
        entry.status === "failed"
          ? entry.error?.reason ?? "Automation failed."
          : entry.status === "stopped"
            ? "Automation was stopped before completion."
            : `Completed at step #${entry.stepNumber}.`
    })
  );

  const cycleOutcomes: SessionOutcomeView[] = cycleLogs
    .filter(
      (entry) =>
        entry.event === "completed" ||
        entry.event === "stopped" ||
        entry.event === "failed"
    )
    .map((entry) => ({
      id: `cycle-${entry.id}`,
      tabId: entry.tabId,
      presetId: entry.presetId,
      state:
        entry.event === "failed"
          ? "failed"
          : entry.event === "stopped"
            ? "stopped"
            : "completed",
      recordedAt: entry.recordedAt,
      message: entry.event === "failed"
        ? `${entry.message} No next run was scheduled.`
        : entry.message
    }));

  return [...stepOutcomes, ...cycleOutcomes]
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
    .slice(0, 6);
}

function outcomeTone(state: SessionOutcomeView["state"]) {
  if (state === "completed") return "success" as const;
  if (state === "failed") return "error" as const;
  return "warning" as const;
}

function formatNextRun(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
