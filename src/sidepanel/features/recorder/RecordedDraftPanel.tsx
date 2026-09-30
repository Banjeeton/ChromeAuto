import { useEffect, useRef } from "react";

import type { RecorderDraftView } from "../../../core/application/recorder-draft-controller";
import type { RecorderPanelStatus } from "../../../core/application/recorder-panel-controller";
import type { AutomationStep } from "../../../core/domain/automation-step";
import { Alert, Card, Confirmation } from "../../components";
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
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (draft === undefined || loading) return;
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    panelRef.current?.focus({ preventScroll: true });
  }, [draft?.sessionId, loading]);

  if (status?.state !== "stopped" && status?.state !== "failed") {
    return null;
  }

  return (
    <div
      className="recorded-draft-anchor"
      data-recorder-editor-state="open"
      ref={panelRef}
      tabIndex={-1}
    >
      <Card className="card" aria-labelledby="recorded-draft-title">
        <div className="section-heading recorded-draft-heading">
          <div>
            <p className="section-label">Recorder</p>
            <h2 id="recorded-draft-title">Recorded steps</h2>
          </div>
        </div>

        {draftStateMessage(status) !== undefined && (
          <Alert className="recorded-draft-reason" tone="warning">
            {draftStateMessage(status)}
          </Alert>
        )}

        {loading ? (
          <div className="preset-list-state">
            <span className="loading-indicator" />
            <p>Loading recorded steps…</p>
          </div>
        ) : draft === undefined ? (
          <Alert className="editor-error" tone="error">
            {error ?? "The recorded draft is unavailable."}
          </Alert>
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
          <Confirmation
            busy={busyAction !== undefined}
            className="delete-confirmation recorder-preset-conflict"
            confirmLabel="Replace assignment"
            onCancel={onCancelConflict}
            onConfirm={() =>
              onCreatePreset(
                conflict.fields,
                conflict.activePresets.map(({ id }) => id)
              )
            }
          >
            {conflict.hostname} is already assigned to{" "}
            {conflict.activePresets
              .map(({ name }) => `“${name}”`)
              .join(", ")}. Replace the active assignment? The existing preset
            will be kept but disabled.
          </Confirmation>
        )}
      </Card>
    </div>
  );
}

function draftStateMessage(status: RecorderPanelStatus): string | undefined {
  if (status.state === "failed") {
    return "Recording failed. The captured steps are still available for review.";
  }
  if (status.stopReason === "tab-context-changed") {
    return `Recording stopped because the tab left ${status.hostname ?? "the original hostname"}. The draft was preserved.`;
  }
  if (status.stopReason === "tab-closed") {
    return "Recording stopped because its browser tab was closed. The draft was preserved.";
  }
  return undefined;
}
