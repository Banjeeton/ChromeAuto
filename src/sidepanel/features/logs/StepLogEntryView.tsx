import type { StepLogEntry } from "../../../core/domain/step-log-entry";
import { formatStepLogDetails } from "./step-log-format";

export function StepLogEntryView({ entry }: { readonly entry: StepLogEntry }) {
  return (
    <li className={`log-entry ${entry.status}`}>
      <span>{entry.status.toUpperCase()}</span>
      <div className="log-entry-content">
        <p>
          Step {entry.stepNumber} · {entry.stepType}
          {entry.stepName === undefined ? "" : ` · ${entry.stepName}`}
          {entry.error === undefined
            ? ""
            : ` — ${entry.error.action} failed: ${entry.error.reason}`}
        </p>
        {entry.error !== undefined && (
          <details className="log-details">
            <summary>Technical details</summary>
            <pre>{formatStepLogDetails(entry)}</pre>
          </details>
        )}
      </div>
    </li>
  );
}
