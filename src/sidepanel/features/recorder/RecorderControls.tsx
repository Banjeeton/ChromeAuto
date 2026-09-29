import type { RecorderPanelStatus } from "../../../core/application/recorder-panel-controller";
import { Button } from "../../components";

export interface RecorderControlsProps {
  readonly status?: RecorderPanelStatus;
  readonly busyAction?: string;
  readonly canRecord: boolean;
  readonly onRecord: () => void;
  readonly onStopRecording: () => void;
}

export function RecorderControls({
  status,
  busyAction,
  canRecord,
  onRecord,
  onStopRecording
}: RecorderControlsProps) {
  return (
    <div className="recorder-controls">
      <div className="recorder-summary" aria-live="polite">
        <div>
          <span className={`recorder-state ${status?.state ?? "idle"}`} />
          <strong>Recorder</strong>
        </div>
        <span>{status?.message ?? "Checking recorder state…"}</span>
      </div>
      <div className="button-grid recorder-actions">
        <Button
          className="action-button record-button"
          disabled={!canRecord}
          onClick={onRecord}
          variant="danger"
        >
          {busyAction === "record" ? "Starting…" : "Record"}
        </Button>
        <Button
          className="action-button secondary"
          disabled={status?.canStop !== true || busyAction !== undefined}
          onClick={onStopRecording}
          variant="secondary"
        >
          {busyAction === "stop-recording" ? "Stopping…" : "Stop recording"}
        </Button>
      </div>
    </div>
  );
}
