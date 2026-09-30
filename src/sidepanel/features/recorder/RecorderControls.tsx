import type { RecorderPanelStatus } from "../../../core/application/recorder-panel-controller";
import { Button } from "../../components";

export interface RecorderControlsProps {
  readonly status?: RecorderPanelStatus;
  readonly hostname?: string;
  readonly busyAction?: string;
  readonly canRecord: boolean;
  readonly onRecord: () => void;
  readonly onStopRecording: () => void;
}

export function RecorderControls({
  status,
  hostname,
  busyAction,
  canRecord,
  onRecord,
  onStopRecording
}: RecorderControlsProps) {
  const active = status?.state === "recording" || status?.state === "stopping";
  const displayedHostname = status?.hostname ?? hostname ?? "this site";

  return (
    <div className={`recorder-controls${active ? " is-recording" : ""}`}>
      <div className="recorder-summary" aria-live="polite">
        <div>
          <span className={`recorder-state ${status?.state ?? "idle"}`} />
          <div className="recorder-summary-copy">
            <strong>{active ? `Recording ${displayedHostname}` : "Automation Recorder"}</strong>
            <span>{status?.message ?? "Checking recorder state…"}</span>
          </div>
        </div>
        {active && (
          <span className="recorder-step-counter">
            <strong>{status?.stepCount ?? 0}</strong>
            <span>{status?.stepCount === 1 ? "step" : "steps"}</span>
          </span>
        )}
      </div>
      <div className="button-grid recorder-actions">
        <Button
          className="record-button"
          disabled={!canRecord}
          onClick={onRecord}
          variant="danger"
        >
          {busyAction === "record" ? "Starting…" : "Record"}
        </Button>
        <Button
          disabled={status?.canStop !== true || busyAction === "stop-recording"}
          onClick={onStopRecording}
          variant={active ? "danger" : "secondary"}
        >
          {busyAction === "stop-recording" ? "Stopping…" : "Stop recording"}
        </Button>
      </div>
    </div>
  );
}
