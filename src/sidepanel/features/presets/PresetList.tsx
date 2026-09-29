import type { PresetV1 } from "../../../core/domain/preset";
import { Alert, Badge, Button, Confirmation } from "../../components";

export type PresetListState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly presets: readonly PresetV1[] };

export type PresetFilter = "all" | "enabled" | "disabled";

export type PresetListProps = {
  readonly state: PresetListState;
  readonly query?: string;
  readonly filter?: PresetFilter;
  readonly selectedPresetId?: string;
  readonly deleteConfirmationPresetId?: string;
  readonly deletingPresetId?: string;
  readonly exportingPresetId?: string;
  readonly onSelect: (presetId: string) => void;
  readonly onEdit: (preset: PresetV1) => void;
  readonly onDuplicate: (preset: PresetV1) => void;
  readonly onExport: (preset: PresetV1) => void;
  readonly onRequestDelete: (presetId: string) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: (preset: PresetV1) => void;
  readonly onRetry: () => void;
};

export function PresetList({
  state,
  query = "",
  filter = "all",
  selectedPresetId,
  deleteConfirmationPresetId,
  deletingPresetId,
  exportingPresetId,
  onSelect,
  onEdit,
  onDuplicate,
  onExport,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onRetry
}: PresetListProps) {
  if (state.status === "loading") {
    return (
      <Alert className="preset-library-state" tone="info">
        <span className="loading-indicator" aria-hidden="true" />
        <span>Loading presets…</span>
      </Alert>
    );
  }

  if (state.status === "error") {
    return (
      <Alert className="preset-library-state" tone="error">
        <span>{state.message}</span>
        <Button onClick={onRetry} size="small" variant="danger">
          Try again
        </Button>
      </Alert>
    );
  }

  if (state.presets.length === 0) {
    return (
      <Alert className="preset-library-state" tone="info">
        <span>
          <strong>No saved presets yet.</strong>
          <small>Create a preset or import a portable preset v1 file.</small>
        </span>
      </Alert>
    );
  }

  const visiblePresets = filterPresets(state.presets, query, filter);
  if (visiblePresets.length === 0) {
    return (
      <Alert className="preset-library-state" tone="info">
        <span>
          <strong>No presets match your search.</strong>
          <small>Try another name, hostname or status filter.</small>
        </span>
      </Alert>
    );
  }

  return (
    <div className="preset-card-list" aria-label="Saved presets">
      {visiblePresets.map((preset) => (
        <PresetCard
          confirmingDelete={deleteConfirmationPresetId === preset.id}
          deleting={deletingPresetId === preset.id}
          exporting={exportingPresetId === preset.id}
          key={preset.id}
          onCancelDelete={onCancelDelete}
          onConfirmDelete={onConfirmDelete}
          onDuplicate={onDuplicate}
          onExport={onExport}
          onEdit={onEdit}
          onRequestDelete={onRequestDelete}
          onSelect={onSelect}
          preset={preset}
          selected={selectedPresetId === preset.id}
        />
      ))}
    </div>
  );
}

export function filterPresets(
  presets: readonly PresetV1[],
  query: string,
  filter: PresetFilter
): readonly PresetV1[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("en");
  return presets.filter((preset) => {
    const enabled = preset.siteSettings.enabled;
    const matchesFilter =
      filter === "all" ||
      (filter === "enabled" && enabled) ||
      (filter === "disabled" && !enabled);
    const matchesQuery =
      normalizedQuery.length === 0 ||
      preset.name.toLocaleLowerCase("en").includes(normalizedQuery) ||
      preset.site.hostname.toLocaleLowerCase("en").includes(normalizedQuery);
    return matchesFilter && matchesQuery;
  });
}

function PresetCard({
  preset,
  selected,
  confirmingDelete,
  deleting,
  exporting,
  onSelect,
  onEdit,
  onDuplicate,
  onExport,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete
}: {
  readonly preset: PresetV1;
  readonly selected: boolean;
  readonly confirmingDelete: boolean;
  readonly deleting: boolean;
  readonly exporting: boolean;
  readonly onSelect: (presetId: string) => void;
  readonly onEdit: (preset: PresetV1) => void;
  readonly onDuplicate: (preset: PresetV1) => void;
  readonly onExport: (preset: PresetV1) => void;
  readonly onRequestDelete: (presetId: string) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: (preset: PresetV1) => void;
}) {
  const select = () => onSelect(preset.id);
  const perform = (action: (preset: PresetV1) => void) => {
    select();
    action(preset);
  };

  return (
    <article className={`preset-card${selected ? " selected" : ""}`}>
      <div className="preset-card-heading">
        <button
          aria-pressed={selected}
          className="preset-card-select"
          onClick={select}
          type="button"
        >
          <strong>{preset.name}</strong>
          <span>{preset.site.hostname}</span>
        </button>
        <Badge tone={preset.siteSettings.enabled ? "success" : "neutral"}>
          {preset.siteSettings.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>

      <dl className="preset-card-metadata">
        <div>
          <dt>Hostname</dt>
          <dd title={preset.site.hostname}>{preset.site.hostname}</dd>
        </div>
        <div>
          <dt>Protocol</dt>
          <dd>
            {preset.site.protocols
              .map((protocol) => protocol.toUpperCase())
              .join(" / ")}
          </dd>
        </div>
        <div>
          <dt>Steps</dt>
          <dd>{preset.automation.steps.length}</dd>
        </div>
      </dl>

      {confirmingDelete ? (
        <Confirmation
          busy={deleting}
          confirmLabel={deleting ? "Deleting…" : "Delete permanently"}
          onCancel={onCancelDelete}
          onConfirm={() => onConfirmDelete(preset)}
        >
          Delete <strong>“{preset.name}”</strong>? This cannot be undone.
        </Confirmation>
      ) : (
        <div className="preset-card-actions">
          <Button onClick={() => perform(onEdit)} size="small" variant="secondary">
            Edit
          </Button>
          <Button onClick={() => perform(onDuplicate)} size="small" variant="secondary">
            Duplicate
          </Button>
          <Button
            disabled={exporting}
            onClick={() => perform(onExport)}
            size="small"
            variant="secondary"
          >
            {exporting ? "Exporting…" : "Export"}
          </Button>
          <Button
            onClick={() => {
              select();
              onRequestDelete(preset.id);
            }}
            size="small"
            variant="danger"
          >
            Delete
          </Button>
        </div>
      )}
    </article>
  );
}
