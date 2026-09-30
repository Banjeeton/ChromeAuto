import { useCallback, useEffect, useRef, useState } from "react";

import {
  createPresetEditorDefaults,
  duplicateFieldsFromPreset,
  editableFieldsFromPreset,
  type PresetEditableFields
} from "../../../core/application/preset-editor";
import type { PresetV1 } from "../../../core/domain/preset";
import {
  AUTOMATION_RUNTIME_MESSAGE,
  type AutomationRuntimeMessage
} from "../../../shared/types/automation-runtime";
import {
  errorMessage,
  errorTechnicalDetails,
  runtimeResponseError,
  sendRuntimeMessage
} from "../../runtime/runtime-client";
import type {
  ActiveTab,
  AddNotice,
  OperationState,
  RefreshWorkspace
} from "../../types";
import type { PresetListState } from "./PresetList";

export type PendingPresetImport = {
  readonly source: string;
  readonly incomingPresetName: string;
  readonly existingPresetName: string;
  readonly existingUpdatedAt: string;
};

export type PresetEditorState = {
  readonly mode: "create" | "edit" | "duplicate";
  readonly presetId?: string;
  readonly fields: PresetEditableFields;
};

export interface PresetManagementOptions {
  readonly activeTab?: ActiveTab;
  readonly addNotice: AddNotice;
  readonly operation: OperationState;
  readonly refreshWorkspace: RefreshWorkspace;
}

export function usePresetManagement({
  activeTab,
  addNotice,
  operation,
  refreshWorkspace
}: PresetManagementOptions) {
  const [listState, setListState] = useState<PresetListState>({
    status: "loading"
  });
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [editor, setEditor] = useState<PresetEditorState>();
  const [saveError, setSaveError] = useState<string>();
  const [deleteConfirmationPresetId, setDeleteConfirmationPresetId] =
    useState<string>();
  const [deletingPresetId, setDeletingPresetId] = useState<string>();
  const [operationError, setOperationError] = useState<string>();
  const [pendingImport, setPendingImport] = useState<PendingPresetImport>();
  const requestIdRef = useRef(0);

  const refresh = useCallback(
    async (showLoading = false) => {
      const requestId = ++requestIdRef.current;
      if (showLoading) setListState({ status: "loading" });

      try {
        const response = await sendRuntimeMessage({
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "presets"
        });
        if (!response.ok) throw runtimeResponseError(response);
        if (response.result.kind !== "presets") {
          throw new Error("The extension returned an unexpected preset response.");
        }

        const presets = sortPresets(response.result.presets);
        if (requestId !== requestIdRef.current) return;
        setListState({ status: "ready", presets });
        setSelectedPresetId((current) =>
          current !== undefined && presets.some((preset) => preset.id === current)
            ? current
            : presets[0]?.id
        );
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        const message = `Unable to load presets: ${errorMessage(error)}`;
        setListState({ status: "error", message });
        addNotice("error", message, errorTechnicalDetails(error));
      }
    },
    [addNotice]
  );

  useEffect(
    () => () => {
      requestIdRef.current += 1;
    },
    []
  );

  const refreshViews = useCallback(
    async (completedAction: string) => {
      await refresh();
      if (activeTab === undefined) return;
      try {
        await refreshWorkspace(activeTab.id);
      } catch (error) {
        addNotice(
          "error",
          `${completedAction}, but the active-site status could not be refreshed: ${errorMessage(error)}`,
          errorTechnicalDetails(error)
        );
      }
    },
    [activeTab, addNotice, refresh, refreshWorkspace]
  );

  const openNew = useCallback(() => {
    const site = defaultSiteFromUrl(activeTab?.url);
    setSaveError(undefined);
    setOperationError(undefined);
    setDeleteConfirmationPresetId(undefined);
    setEditor({
      mode: "create",
      fields: createPresetEditorDefaults(site.hostname, site.protocol)
    });
  }, [activeTab?.url]);

  const openEdit = useCallback((preset: PresetV1) => {
    setSaveError(undefined);
    setOperationError(undefined);
    setDeleteConfirmationPresetId(undefined);
    setEditor({
      mode: "edit",
      presetId: preset.id,
      fields: editableFieldsFromPreset(preset)
    });
  }, []);

  const openDuplicate = useCallback((preset: PresetV1) => {
    setSaveError(undefined);
    setOperationError(undefined);
    setDeleteConfirmationPresetId(undefined);
    setEditor({
      mode: "duplicate",
      presetId: preset.id,
      fields: duplicateFieldsFromPreset(preset)
    });
  }, []);

  const save = useCallback(
    async (fields: PresetEditableFields) => {
      if (editor === undefined) return;
      operation.begin("save-preset");
      setSaveError(undefined);
      try {
        const message: AutomationRuntimeMessage =
          editor.mode !== "edit"
            ? {
                type: AUTOMATION_RUNTIME_MESSAGE,
                action: "create-preset",
                fields
              }
            : {
                type: AUTOMATION_RUNTIME_MESSAGE,
                action: "update-preset",
                presetId: editor.presetId ?? "",
                fields
              };
        const response = await sendRuntimeMessage(message);
        if (!response.ok) throw runtimeResponseError(response);
        if (response.result.kind !== "preset-saved") {
          throw new Error("The extension returned an unexpected save response.");
        }

        setSelectedPresetId(response.result.preset.id);
        setEditor(undefined);
        addNotice(
          "success",
          editor.mode === "edit"
            ? `Preset “${response.result.preset.name}” was updated.`
            : editor.mode === "duplicate"
              ? `Preset “${response.result.preset.name}” was duplicated.`
              : `Preset “${response.result.preset.name}” was created.`
        );
        void refreshViews("The preset was saved");
      } catch (error) {
        const message = `Unable to save preset: ${errorMessage(error)}`;
        setSaveError(message);
        addNotice("error", message, errorTechnicalDetails(error));
      } finally {
        operation.finish();
      }
    },
    [addNotice, editor, operation, refreshViews]
  );

  const remove = useCallback(
    async (preset: PresetV1) => {
      setDeletingPresetId(preset.id);
      setOperationError(undefined);
      try {
        const response = await sendRuntimeMessage({
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "delete-preset",
          presetId: preset.id
        });
        if (!response.ok) throw runtimeResponseError(response);
        if (response.result.kind !== "preset-deleted") {
          throw new Error("The extension returned an unexpected delete response.");
        }

        setDeleteConfirmationPresetId(undefined);
        setEditor((current) =>
          current?.mode === "edit" && current.presetId === preset.id
            ? undefined
            : current
        );
        addNotice("success", `Preset “${preset.name}” was deleted.`);
        void refreshViews("The preset was deleted");
      } catch (error) {
        const message = `Unable to delete preset: ${errorMessage(error)}`;
        setOperationError(message);
        addNotice("error", message, errorTechnicalDetails(error));
      } finally {
        setDeletingPresetId(undefined);
      }
    },
    [addNotice, refreshViews]
  );

  const importPreset = useCallback(
    async (source: File | string, overwriteExistingUpdatedAt?: string) => {
      operation.begin("import-preset");
      setOperationError(undefined);
      if (overwriteExistingUpdatedAt === undefined) setPendingImport(undefined);
      try {
        const json = typeof source === "string" ? source : await source.text();
        const response = await sendRuntimeMessage({
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "import-preset",
          source: json,
          ...(overwriteExistingUpdatedAt === undefined
            ? {}
            : { overwriteExistingUpdatedAt })
        });
        if (!response.ok) throw runtimeResponseError(response);
        if (response.result.kind === "preset-import-confirmation-required") {
          setPendingImport({
            source: json,
            incomingPresetName: response.result.incomingPresetName,
            existingPresetName: response.result.existingPresetName,
            existingUpdatedAt: response.result.existingUpdatedAt
          });
          return;
        }
        if (response.result.kind !== "preset-imported") {
          throw new Error("The extension returned an unexpected import response.");
        }

        setPendingImport(undefined);
        setSelectedPresetId(response.result.preset.id);
        addNotice("success", `Preset “${response.result.preset.name}” was imported.`);
        void refreshViews("The preset was imported");
      } catch (error) {
        const message = `Unable to import preset: ${errorMessage(error)}`;
        setOperationError(message);
        addNotice("error", message, errorTechnicalDetails(error));
      } finally {
        operation.finish();
      }
    },
    [addNotice, operation, refreshViews]
  );

  const exportPreset = useCallback(
    async (preset: PresetV1) => {
      operation.begin("export-preset");
      setOperationError(undefined);
      try {
        const response = await sendRuntimeMessage({
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "export-preset",
          presetId: preset.id
        });
        if (!response.ok) throw runtimeResponseError(response);
        if (response.result.kind !== "preset-exported") {
          throw new Error("The extension returned an unexpected export response.");
        }

        downloadPresetJson(
          response.result.presetName,
          response.result.presetId,
          response.result.json
        );
        addNotice("success", `Preset “${preset.name}” was exported.`);
      } catch (error) {
        const message = `Unable to export preset: ${errorMessage(error)}`;
        setOperationError(message);
        addNotice("error", message, errorTechnicalDetails(error));
      } finally {
        operation.finish();
      }
    },
    [addNotice, operation]
  );

  return {
    cancelDelete: () => setDeleteConfirmationPresetId(undefined),
    cancelEditor: () => {
      setEditor(undefined);
      setSaveError(undefined);
    },
    cancelImport: () => setPendingImport(undefined),
    confirmDelete: setDeleteConfirmationPresetId,
    deleteConfirmationPresetId,
    deletingPresetId,
    editor,
    exportPreset,
    importPreset,
    listState,
    openDuplicate,
    openEdit,
    openNew,
    operationError,
    pendingImport,
    refresh,
    remove,
    save,
    saveError,
    selectPreset: setSelectedPresetId,
    selectedPresetId
  } as const;
}

function sortPresets(presets: readonly PresetV1[]): readonly PresetV1[] {
  return [...presets].sort((left, right) =>
    left.name.localeCompare(right.name, "en", { sensitivity: "base" })
  );
}

function defaultSiteFromUrl(url?: string): {
  hostname: string;
  protocol: "http" | "https";
} {
  if (url === undefined) return { hostname: "", protocol: "https" };
  try {
    const parsed = new URL(url);
    return {
      hostname: parsed.hostname,
      protocol: parsed.protocol === "http:" ? "http" : "https"
    };
  } catch {
    return { hostname: "", protocol: "https" };
  }
}

function downloadPresetJson(name: string, presetId: string, json: string) {
  const blobUrl = URL.createObjectURL(
    new Blob([json], { type: "application/json" })
  );
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = createPresetFilename(name, presetId);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}

export function createPresetFilename(name: string, presetId: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "preset"}-${presetId.slice(0, 8)}.preset.json`;
}
