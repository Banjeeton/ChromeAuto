import type { RecorderLogEntry } from "../../../core/domain/recorder-log-entry";
import type { RepeatCycleLogEntry } from "../../../core/domain/repeat-cycle-log-entry";
import type { StepLogEntry } from "../../../core/domain/step-log-entry";
import type { Notice } from "../../types";
import { StepLogEntryView } from "../logs/StepLogEntryView";

export interface RunLogPanelProps {
  readonly notices: readonly Notice[];
  readonly stepLogs: readonly StepLogEntry[];
  readonly cycleLogs: readonly RepeatCycleLogEntry[];
  readonly recorderLogs: readonly RecorderLogEntry[];
  readonly onClear: () => void;
}

export function RunLogPanel({
  notices,
  stepLogs,
  cycleLogs,
  recorderLogs,
  onClear
}: RunLogPanelProps) {
  const empty =
    notices.length === 0 &&
    stepLogs.length === 0 &&
    cycleLogs.length === 0 &&
    recorderLogs.length === 0;

  return (
    <section className="card log-card" aria-labelledby="log-title">
      <div className="section-heading">
        <div>
          <p className="section-label">Current tab</p>
          <h2 id="log-title">Run log</h2>
        </div>
        <button className="icon-button" onClick={onClear}>Clear</button>
      </div>

      {empty ? (
        <p className="empty-state">Automation and recorder events will appear here.</p>
      ) : (
        <ol className="log-list">
          {notices.map((notice) => (
            <li className={`log-entry ${notice.status}`} key={notice.id}>
              <span>{notice.status === "success" ? "DONE" : "ERROR"}</span>
              <div className="log-entry-content">
                <p>{notice.text}</p>
                {notice.details !== undefined && (
                  <details className="log-details">
                    <summary>Technical details</summary>
                    <pre>{notice.details}</pre>
                  </details>
                )}
              </div>
            </li>
          ))}
          {[...cycleLogs].reverse().map((entry) => (
            <li
              className={`log-entry cycle-${entry.event} ${cycleLogTone(entry)}`}
              key={entry.id}
            >
              <span>{entry.event.toUpperCase()}</span>
              <p>{entry.message}</p>
            </li>
          ))}
          {[...recorderLogs].reverse().map((entry) => (
            <li
              className={`log-entry recorder-${entry.event} ${recorderLogTone(entry)}`}
              key={entry.id}
            >
              <span>{recorderLogLabel(entry)}</span>
              <div className="log-entry-content">
                <p>{entry.message}</p>
                {entry.details !== undefined && (
                  <details className="log-details">
                    <summary>Technical details</summary>
                    <pre>{formatRecorderLogDetails(entry)}</pre>
                  </details>
                )}
              </div>
            </li>
          ))}
          {[...stepLogs].reverse().map((entry) => (
            <StepLogEntryView entry={entry} key={entry.id} />
          ))}
        </ol>
      )}
    </section>
  );
}

function cycleLogTone(entry: RepeatCycleLogEntry): string {
  if (entry.event === "failed") return "failed";
  if (entry.event === "stopped") return "stopped";
  return "succeeded";
}

function recorderLogTone(entry: RecorderLogEntry): string {
  return entry.event === "failed" ? "failed" : entry.event === "stopped" ||
    entry.event === "context-changed" || entry.event === "tab-closed"
    ? "stopped"
    : "succeeded";
}

function recorderLogLabel(entry: RecorderLogEntry): string {
  if (entry.event === "action-recorded") return "RECORDED";
  if (entry.event === "context-changed" || entry.event === "tab-closed") {
    return "STOPPED";
  }
  return entry.event.toUpperCase();
}

function formatRecorderLogDetails(entry: RecorderLogEntry): string {
  const details = entry.details;
  if (details === undefined) return "";
  return [
    `Action: ${entry.action}`,
    `Tab: ${entry.tabId}`,
    ...(entry.sessionId === undefined ? [] : [`Session: ${entry.sessionId}`]),
    ...(entry.recorderEventId === undefined
      ? []
      : [`Event: ${entry.recorderEventId}`]),
    ...(details.code === undefined ? [] : [`Code: ${details.code}`]),
    `${details.name}: ${details.message}`,
    ...(details.cause === undefined ? [] : [`Cause: ${details.cause}`]),
    ...(details.stack === undefined ? [] : [details.stack])
  ].join("\n");
}
