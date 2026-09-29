import { useRef } from "react";

import type { PresetEditableFields } from "../../../core/application/preset-editor";
import type { PresetV1 } from "../../../core/domain/preset";
import { Alert, Button, Card, Confirmation, Input } from "../../components";
import { PresetEditor } from "./PresetEditor";
import { PresetList, type PresetListState } from "./PresetList";
import type {
  PendingPresetImport,
  PresetEditorState
} from "./use-preset-management";

export interface PresetManagementPanelProps {
  readonly busyAction?: string;
  readonly listState: PresetListState;
  readonly selectedPresetId?: string;
  readonly editor?: PresetEditorState;
  readonly saveError?: string;
  readonly operationError?: string;
  readonly deleteConfirmationPresetId?: string;
  readonly deletingPresetId?: string;
  readonly pendingImport?: PendingPresetImport;
  readonly onRefresh: () => void;
  readonly onNew: () => void;
  readonly onSelect: (presetId: string) => void;
  readonly onEdit: (preset: PresetV1) => void;
  readonly onDuplicate: (preset: PresetV1) => void;
  readonly onExport: (preset: PresetV1) => void;
  readonly onRequestDelete: (presetId: string) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: (preset: PresetV1) => void;
  readonly onImport: (source: File | string, overwrite?: string) => void;
  readonly onCancelImport: () => void;
  readonly onSave: (fields: PresetEditableFields) => void;
  readonly onCancelEditor: () => void;
}

export function PresetManagementPanel(props: PresetManagementPanelProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  return (
    <Card className="card" aria-labelledby="presets-title">
      <div className="section-heading">
        <div>
          <p className="section-label">Automation library</p>
          <h2 id="presets-title">Saved presets</h2>
        </div>
        <div className="header-actions">
          <Button className="icon-button" onClick={props.onRefresh} size="small" variant="secondary">
            Refresh
          </Button>
          <Button
            className="inline-button neutral"
            disabled={props.busyAction !== undefined}
            onClick={() => importInputRef.current?.click()}
            size="small"
            variant="secondary"
          >
            {props.busyAction === "import-preset" ? "Importing…" : "Import JSON"}
          </Button>
          <Input
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file !== undefined) props.onImport(file);
            }}
            ref={importInputRef}
            type="file"
          />
          <Button
            className="inline-button neutral"
            disabled={props.busyAction !== undefined}
            onClick={props.onNew}
            size="small"
            variant="secondary"
          >
            New preset
          </Button>
        </div>
      </div>

      <PresetList
        deleteConfirmationPresetId={props.deleteConfirmationPresetId}
        deletingPresetId={props.deletingPresetId}
        exportingPresetId={
          props.busyAction === "export-preset" ? props.selectedPresetId : undefined
        }
        onEdit={props.onEdit}
        onDuplicate={props.onDuplicate}
        onExport={props.onExport}
        onRequestDelete={props.onRequestDelete}
        onCancelDelete={props.onCancelDelete}
        onConfirmDelete={props.onConfirmDelete}
        onRetry={props.onRefresh}
        onSelect={props.onSelect}
        selectedPresetId={props.selectedPresetId}
        state={props.listState}
      />

      {props.pendingImport !== undefined && (
        <PresetOverwriteConfirmation
          busy={props.busyAction === "import-preset"}
          existingPresetName={props.pendingImport.existingPresetName}
          incomingPresetName={props.pendingImport.incomingPresetName}
          onCancel={props.onCancelImport}
          onConfirm={() =>
            props.onImport(
              props.pendingImport!.source,
              props.pendingImport!.existingUpdatedAt
            )
          }
        />
      )}

      {props.operationError !== undefined && (
        <Alert className="editor-error preset-operation-error" tone="error">
          {props.operationError}
        </Alert>
      )}

      {props.editor !== undefined && (
        <PresetEditor
          initialFields={props.editor.fields}
          key={`${props.editor.mode}-${props.editor.presetId ?? "new"}`}
          mode={props.editor.mode}
          onCancel={props.onCancelEditor}
          onSave={props.onSave}
          saveError={props.saveError}
          saving={props.busyAction === "save-preset"}
        />
      )}
    </Card>
  );
}

export interface PresetOverwriteConfirmationProps {
  readonly busy: boolean;
  readonly existingPresetName: string;
  readonly incomingPresetName: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function PresetOverwriteConfirmation({
  busy,
  existingPresetName,
  incomingPresetName,
  onCancel,
  onConfirm
}: PresetOverwriteConfirmationProps) {
  return (
    <Confirmation
      busy={busy}
      className="delete-confirmation overwrite-confirmation"
      confirmLabel={busy ? "Replacing…" : "Replace preset"}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      Replace saved preset <strong>“{existingPresetName}”</strong> with imported
      preset <strong>“{incomingPresetName}”</strong>? The saved preset with this
      ID will be overwritten.
    </Confirmation>
  );
}
