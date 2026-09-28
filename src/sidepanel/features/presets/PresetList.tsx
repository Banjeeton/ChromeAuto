import type { PresetV1 } from "../../../core/domain/preset";

export type PresetListState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly presets: readonly PresetV1[] };

type PresetListProps = {
  readonly state: PresetListState;
  readonly selectedPresetId?: string;
  readonly deleteConfirmationPresetId?: string;
  readonly deletingPresetId?: string;
  readonly operationError?: string;
  readonly onSelect: (presetId: string) => void;
  readonly onEdit: (preset: PresetV1) => void;
  readonly onDuplicate: (preset: PresetV1) => void;
  readonly onRequestDelete: (presetId: string) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: (preset: PresetV1) => void;
  readonly onRetry: () => void;
};

export function PresetList({
  state,
  selectedPresetId,
  deleteConfirmationPresetId,
  deletingPresetId,
  operationError,
  onSelect,
  onEdit,
  onDuplicate,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onRetry
}: PresetListProps) {
  if (state.status === "loading") {
    return (
      <div className="preset-list-state" role="status">
        <span className="loading-indicator" aria-hidden="true" />
        <p>Loading presets…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="preset-list-state preset-list-error" role="alert">
        <p>{state.message}</p>
        <button className="inline-button" type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (state.presets.length === 0) {
    return (
      <div className="preset-list-state">
        <p>No saved presets yet.</p>
        <small>Saved automations will appear here.</small>
      </div>
    );
  }

  const selectedPreset = state.presets.find(
    (preset) => preset.id === selectedPresetId
  );

  return (
    <>
      <div className="preset-list" aria-label="Saved presets">
        {state.presets.map((preset) => {
          const selected = preset.id === selectedPresetId;
          return (
            <button
              aria-pressed={selected}
              className={`preset-list-item${selected ? " selected" : ""}`}
              key={preset.id}
              onClick={() => onSelect(preset.id)}
              type="button"
            >
              <span className="preset-list-copy">
                <strong>{preset.name}</strong>
                <small>{preset.site.hostname}</small>
              </span>
              <span
                className={`preset-state ${
                  preset.siteSettings.enabled ? "enabled" : "disabled"
                }`}
              >
                {preset.siteSettings.enabled ? "Enabled" : "Disabled"}
              </span>
            </button>
          );
        })}
      </div>

      {selectedPreset !== undefined && (
        <SelectedPresetDetails
          confirmingDelete={deleteConfirmationPresetId === selectedPreset.id}
          deleting={deletingPresetId === selectedPreset.id}
          onCancelDelete={onCancelDelete}
          onConfirmDelete={onConfirmDelete}
          onDuplicate={onDuplicate}
          onEdit={onEdit}
          onRequestDelete={onRequestDelete}
          preset={selectedPreset}
        />
      )}
      {operationError !== undefined && (
        <p className="editor-error preset-operation-error" role="alert">
          {operationError}
        </p>
      )}
    </>
  );
}

function SelectedPresetDetails({
  preset,
  confirmingDelete,
  deleting,
  onEdit,
  onDuplicate,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete
}: {
  readonly preset: PresetV1;
  readonly confirmingDelete: boolean;
  readonly deleting: boolean;
  readonly onEdit: (preset: PresetV1) => void;
  readonly onDuplicate: (preset: PresetV1) => void;
  readonly onRequestDelete: (presetId: string) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: (preset: PresetV1) => void;
}) {
  const repeat = preset.siteSettings.repeat;

  return (
    <div className="selected-preset" aria-label="Selected preset details">
      <div>
        <span>Selected preset</span>
        <strong>{preset.name}</strong>
      </div>
      <dl>
        <div>
          <dt>Steps</dt>
          <dd>{preset.automation.steps.length}</dd>
        </div>
        <div>
          <dt>Protocols</dt>
          <dd>{preset.site.protocols.join(", ")}</dd>
        </div>
        <div>
          <dt>Launch</dt>
          <dd>
            {repeat.enabled
              ? `Every ${repeat.intervalMinutes} min`
              : "Manual"}
          </dd>
        </div>
      </dl>
      {confirmingDelete ? (
        <div className="delete-confirmation" role="alert">
          <p>
            Delete <strong>“{preset.name}”</strong>? This cannot be undone.
          </p>
          <div>
            <button
              className="inline-button neutral"
              disabled={deleting}
              onClick={onCancelDelete}
              type="button"
            >
              Cancel
            </button>
            <button
              className="inline-button destructive"
              disabled={deleting}
              onClick={() => onConfirmDelete(preset)}
              type="button"
            >
              {deleting ? "Deleting…" : "Delete permanently"}
            </button>
          </div>
        </div>
      ) : (
        <div className="preset-management-actions">
          <button
            className="inline-button neutral"
            onClick={() => onEdit(preset)}
            type="button"
          >
            Edit
          </button>
          <button
            className="inline-button neutral"
            onClick={() => onDuplicate(preset)}
            type="button"
          >
            Duplicate
          </button>
          <button
            className="inline-button destructive"
            onClick={() => onRequestDelete(preset.id)}
            type="button"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
