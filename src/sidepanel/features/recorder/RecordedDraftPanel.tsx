import type { RecorderPanelStatus } from "../../../core/application/recorder-panel-controller";
import type { AutomationStep } from "../../../core/domain/automation-step";
import type { RecorderDraftView } from "../../../core/application/recorder-draft-controller";
import {
  RecordedStepsEditor,
  type RecordedPresetFields
} from "./RecordedStepsEditor";
import type { PendingRecordedPresetConflict } from "./use-recorder-controller";

export interface RecordedDraftPanelProps {
  readonly status?: RecorderPanelStatus;
  readonly draft?: RecorderDraftView;
  readonly loading: boolean;
  readonly error?: string;
  readonly busyAction?: string;
  readonly conflict?: PendingRecordedPresetConflict;
  readonly onSave: (steps: readonly AutomationStep[]) => void;
  readonly onDiscard: () => void;
  readonly onCreatePreset: (
    fields: RecordedPresetFields,
    confirmedActivePresetIds?: readonly string[]
  ) => void;
  readonly onCancelConflict: () => void;
}

export function RecordedDraftPanel({
  status,
  draft,
  loading,
  error,
  busyAction,
  conflict,
  onSave,
  onDiscard,
  onCreatePreset,
  onCancelConflict
}: RecordedDraftPanelProps) {
  if (status?.state !== "stopped" && status?.state !== "failed") {
    return null;
  }

  return (
    <section className="card" aria-labelledby="recorded-draft-title">
      <div className="section-heading recorded-draft-heading">
        <div>
          <p className="section-label">Recorder</p>
          <h2 id="recorded-draft-title">Recorded steps</h2>
        </div>
      </div>

      {loading ? (
        <div className="preset-list-state">
          <span className="loading-indicator" />
          <p>Loading recorded steps…</p>
        </div>
      ) : draft === undefined ? (
        <p className="editor-error" role="alert">
          {error ?? "The recorded draft is unavailable."}
        </p>
      ) : (
        <RecordedStepsEditor
          busy={
            busyAction === "save-recorder-draft" ||
            busyAction === "discard-recorder-draft" ||
            busyAction === "save-recorded-preset"
          }
          draft={draft}
          key={draft.sessionId}
          creatingPreset={busyAction === "save-recorded-preset"}
          onCreatePreset={(fields) => onCreatePreset(fields)}
          onDiscard={onDiscard}
          onSave={onSave}
          saveError={error}
        />
      )}

      {conflict !== undefined && (
        <div className="delete-confirmation recorder-preset-conflict">
          <p>
            {conflict.hostname} is already assigned to{" "}
            {conflict.activePresets
              .map(({ name }) => `“${name}”`)
              .join(", ")}
            . Replace the active assignment? The existing preset will be kept
            but disabled.
          </p>
          <div>
            <button
              className="inline-button neutral"
              disabled={busyAction !== undefined}
              onClick={onCancelConflict}
              type="button"
            >
              Cancel
            </button>
            <button
              className="inline-button destructive"
              disabled={busyAction !== undefined}
              onClick={() =>
                onCreatePreset(
                  conflict.fields,
                  conflict.activePresets.map(({ id }) => id)
                )
              }
              type="button"
            >
              Replace assignment
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
