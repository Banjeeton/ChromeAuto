import { useMemo, useState } from "react";

import type { RecorderLogEntry } from "../../../core/domain/recorder-log-entry";
import type { RepeatCycleLogEntry } from "../../../core/domain/repeat-cycle-log-entry";
import type { StepLogEntry } from "../../../core/domain/step-log-entry";
import type { NaturalPacingLogEntry } from "../../../core/domain/natural-pacing-log-entry";
import { Button, Card } from "../../components";
import type { Notice } from "../../types";
import {
  buildRunLogGroups,
  formatRunLogTime,
  type RunLogFilter,
  type RunLogItem
} from "./run-log-model";

export interface RunLogPanelProps {
  readonly currentTabId?: number;
  readonly notices: readonly Notice[];
  readonly stepLogs: readonly StepLogEntry[];
  readonly cycleLogs: readonly RepeatCycleLogEntry[];
  readonly recorderLogs: readonly RecorderLogEntry[];
  readonly naturalPacingLogs?: readonly NaturalPacingLogEntry[];
  readonly onClear: () => void;
}

const FILTERS: readonly { value: RunLogFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "success", label: "Success" },
  { value: "warning", label: "Warning" },
  { value: "error", label: "Error" }
];

export function RunLogPanel({
  currentTabId,
  notices,
  stepLogs,
  cycleLogs,
  recorderLogs,
  naturalPacingLogs = [],
  onClear
}: RunLogPanelProps) {
  const [filter, setFilter] = useState<RunLogFilter>("all");
  const empty =
    notices.length === 0 &&
    stepLogs.length === 0 &&
    cycleLogs.length === 0 &&
    recorderLogs.length === 0 &&
    naturalPacingLogs.length === 0;
  const groups = useMemo(
    () =>
      buildRunLogGroups({
        ...(currentTabId === undefined ? {} : { currentTabId }),
        notices,
        stepLogs,
        cycleLogs,
        recorderLogs,
        naturalPacingLogs,
        filter
      }),
    [currentTabId, notices, stepLogs, cycleLogs, recorderLogs, naturalPacingLogs, filter]
  );

  return (
    <Card className="card log-card" aria-labelledby="log-title">
      <div className="section-heading">
        <div>
          <p className="section-label">Current tab</p>
          <h2 id="log-title">Run log</h2>
        </div>
        <Button
          aria-label="Clear log for current tab"
          disabled={empty || currentTabId === undefined}
          onClick={onClear}
          size="small"
          variant="secondary"
        >
          Clear
        </Button>
      </div>

      <div aria-label="Filter run log" className="log-filters" role="group">
        {FILTERS.map(({ value, label }) => (
          <Button
            aria-pressed={filter === value}
            className="log-filter-button"
            key={value}
            onClick={() => setFilter(value)}
            size="small"
            variant="secondary"
          >
            {label}
          </Button>
        ))}
      </div>

      {empty ? (
        <p className="empty-state">Automation and recorder events will appear here.</p>
      ) : groups.length === 0 ? (
        <p className="empty-state">No events match this filter.</p>
      ) : (
        <div className="log-tab-list">
          {groups.map((tabGroup) => (
            <section className="log-tab-group" key={tabGroup.key}>
              <div className="log-group-heading">
                <h3>{tabGroup.label}</h3>
                <span>{eventCount(tabGroup.runs.flatMap(({ items }) => items))}</span>
              </div>

              <div className="log-run-list">
                {tabGroup.runs.map((run) => (
                  <section className={`log-run-group log-source-${run.source}`} key={run.key}>
                    <h4>{run.label}</h4>
                    <ol className="log-list">
                      {run.items.map((item) => (
                        <RunLogEntryView item={item} key={item.id} />
                      ))}
                    </ol>
                  </section>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

function RunLogEntryView({ item }: { readonly item: RunLogItem }) {
  return (
    <li className={`log-entry log-entry--${item.severity}`}>
      <div className="log-entry-header">
        <time dateTime={item.recordedAt}>{formatRunLogTime(item.recordedAt)}</time>
        <span className="log-entry-state">{item.state}</span>
        <span className="log-entry-action">{item.action}</span>
      </div>
      <p>{item.message}</p>
      {item.technicalDetails !== undefined && item.technicalDetails.length > 0 && (
        <details className="log-details">
          <summary>Technical details</summary>
          <pre>{item.technicalDetails}</pre>
        </details>
      )}
    </li>
  );
}

function eventCount(items: readonly RunLogItem[]): string {
  return `${items.length} ${items.length === 1 ? "event" : "events"}`;
}
