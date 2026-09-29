import type { RepeatCycleStatusView } from "../../../core/application/repeat-cycle-status-controller";
import type { RunSession } from "../../../core/domain/run-session";
import { Button, Card } from "../../components";

export interface AutomationSessionsPanelProps {
  readonly busyAction?: string;
  readonly repeatCycles: readonly RepeatCycleStatusView[];
  readonly sessions: readonly RunSession[];
  readonly onStopAll: () => void;
}

export function AutomationSessionsPanel({
  busyAction,
  repeatCycles,
  sessions,
  onStopAll
}: AutomationSessionsPanelProps) {
  return (
    <Card className="card" aria-labelledby="sessions-title">
      <div className="section-heading">
        <div>
          <p className="section-label">Independent tabs</p>
          <h2 id="sessions-title">Automation status</h2>
        </div>
        <Button
          className="icon-button danger-text"
          disabled={busyAction === "stop-all"}
          onClick={onStopAll}
          size="small"
          variant="danger"
        >
          Stop All
        </Button>
      </div>

      {sessions.length === 0 && repeatCycles.length === 0 ? (
        <p className="empty-state">No automations are running.</p>
      ) : (
        <div className="session-list">
          {repeatCycles.map((cycle) => (
            <div
              className={`session-pill repeat-cycle-pill ${cycle.state}`}
              key={`${cycle.tabId}-${cycle.presetId}`}
            >
              <span className="session-indicator" />
              <span>
                <strong>{cycle.state === "running" ? "Running" : "Waiting"}</strong>
                {` · Tab #${cycle.tabId} · every ${cycle.intervalMinutes} min`}
                {cycle.nextRunAt === undefined
                  ? ""
                  : ` · next ${formatNextRun(cycle.nextRunAt)}`}
              </span>
            </div>
          ))}
          {sessions.map((session) => (
            <span
              className="session-pill"
              key={session.sessionId}
              hidden={repeatCycles.some((cycle) => cycle.tabId === session.tabId)}
            >
              <span className="session-indicator" /> Tab #{session.tabId}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function formatNextRun(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
