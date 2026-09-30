import { useMemo, useState, type FormEvent } from "react";

import {
  createPresetV1,
  type PresetEditableFields
} from "../../../core/application/preset-editor";
import {
  validatePreset,
  type PresetValidationIssue
} from "../../../core/domain/preset-validator";
import type { SiteProtocol } from "../../../core/domain/site-binding";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmationDialog,
  Input,
  Textarea
} from "../../components";
import { StructuredStepsEditor } from "./StructuredStepsEditor";

type PresetEditorProps = {
  readonly initialFields: PresetEditableFields;
  readonly mode: "create" | "edit" | "duplicate";
  readonly saving: boolean;
  readonly saveError?: string;
  readonly onCancel: () => void;
  readonly onSave: (fields: PresetEditableFields) => void;
};

export function PresetEditor({
  initialFields,
  mode,
  saving,
  saveError,
  onCancel,
  onSave
}: PresetEditorProps) {
  const [fields, setFields] = useState(() => structuredClone(initialFields));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const validation = useMemo(() => validatePresetEditorFields(fields), [fields]);
  const dirty = isPresetEditorDirty(initialFields, fields);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (validation.issues.length > 0) return;
    onSave(validation.fields);
  };

  const requestCancel = () => {
    if (dirty) setConfirmDiscard(true);
    else onCancel();
  };

  const toggleProtocol = (protocol: SiteProtocol, checked: boolean) => {
    setFields((current) => ({
      ...current,
      site: {
        ...current.site,
        protocols: checked
          ? [...new Set([...current.site.protocols, protocol])]
          : current.site.protocols.filter((value) => value !== protocol)
      }
    }));
  };

  return (
    <form className="preset-editor" onSubmit={submit}>
      <div className="editor-heading">
        <div>
          <p className="section-label">
            {mode === "create"
              ? "New automation"
              : mode === "duplicate"
                ? "Duplicate preset"
                : "Editing preset"}
          </p>
          <h3 title={mode === "create" ? undefined : fields.name}>
            {mode === "create" ? "Create preset" : fields.name}
          </h3>
        </div>
        <div className="editor-heading-actions">
          <Badge tone={validation.issues.length === 0 ? "success" : "warning"}>
            {validation.issues.length === 0
              ? "Valid preset"
              : `${validation.issues.length} ${validation.issues.length === 1 ? "issue" : "issues"}`}
          </Badge>
          <Button
            disabled={saving}
            onClick={requestCancel}
            size="small"
            variant="secondary"
          >
            Close
          </Button>
        </div>
      </div>

      <Alert
        className="editor-validity"
        tone={validation.issues.length === 0 ? "success" : "warning"}
      >
        {validation.issues.length === 0
          ? "Preset is valid and ready to save."
          : `Resolve ${validation.issues.length} validation ${validation.issues.length === 1 ? "issue" : "issues"} before saving.`}
      </Alert>

      <fieldset className="editor-section editor-section--metadata">
        <legend>Metadata</legend>
        <p className="editor-section-description">Name and describe this automation.</p>
        <label className="editor-field">
          <span>Name</span>
          <Input
            {...fieldAccessibility(validation.issues, "/name")}
            autoFocus
            maxLength={120}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                name: event.target.value
              }))
            }
            placeholder="Example automation"
            required
            value={fields.name}
          />
          <FieldIssues issues={validation.issues} path="/name" />
        </label>
        <label className="editor-field">
          <span>Description</span>
          <Textarea
            {...fieldAccessibility(validation.issues, "/description")}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                description: event.target.value
              }))
            }
            placeholder="What does this automation do?"
            rows={2}
            value={fields.description ?? ""}
          />
          <FieldIssues issues={validation.issues} path="/description" />
        </label>
      </fieldset>

      {mode === "duplicate" && fields.site.hostname.length === 0 && (
        <p className="editor-help duplicate-hint">
          Choose a different hostname before saving. One hostname can only have
          one active automation.
        </p>
      )}

      <fieldset className="editor-section editor-section--site">
        <legend>Site settings</legend>
        <p className="editor-section-description">Choose the exact site and runtime behavior.</p>
        <label className="editor-field">
          <span>Hostname</span>
          <Input
            {...fieldAccessibility(validation.issues, "/site/hostname")}
            autoCapitalize="none"
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                site: { ...current.site, hostname: event.target.value }
              }))
            }
            placeholder="example.com"
            required
            spellCheck={false}
            value={fields.site.hostname}
          />
          <FieldIssues issues={validation.issues} path="/site/hostname" />
        </label>

        <div className="editor-check-row" aria-label="Allowed protocols">
          {(["https", "http"] as const).map((protocol) => (
            <Checkbox
              checked={fields.site.protocols.includes(protocol)}
              key={protocol}
              label={protocol.toUpperCase()}
              onChange={(event) => toggleProtocol(protocol, event.target.checked)}
            />
          ))}
        </div>
        <FieldIssues issues={validation.issues} path="/site/protocols" />

        <div className="editor-check-row">
          <Checkbox
            checked={fields.siteSettings.enabled}
            label="Preset enabled"
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                siteSettings: {
                  ...current.siteSettings,
                  enabled: event.target.checked
                }
              }))
            }
          />
          <Checkbox
            checked={fields.siteSettings.repeat.enabled}
            label="Repeat after completion"
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                siteSettings: {
                  ...current.siteSettings,
                  repeat: {
                    ...current.siteSettings.repeat,
                    enabled: event.target.checked
                  }
                }
              }))
            }
          />
        </div>

        <label className="editor-field compact-field">
          <span>Repeat interval, minutes</span>
          <Input
            {...fieldAccessibility(
              validation.issues,
              "/siteSettings/repeat/intervalMinutes"
            )}
            min={1}
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                siteSettings: {
                  ...current.siteSettings,
                  repeat: {
                    ...current.siteSettings.repeat,
                    intervalMinutes: event.target.valueAsNumber
                  }
                }
              }))
            }
            required
            type="number"
            value={fields.siteSettings.repeat.intervalMinutes}
          />
          <FieldIssues
            issues={validation.issues}
            path="/siteSettings/repeat/intervalMinutes"
          />
        </label>
      </fieldset>

      <fieldset className="editor-section editor-section--defaults">
        <legend>Automation defaults</legend>
        <p className="editor-section-description">Set defaults inherited by individual steps.</p>
        <div className="editor-number-grid">
          <NumberField
            issues={validation.issues}
            label="Step timeout, ms"
            min={1}
            onChange={(value) =>
              setFields((current) => ({
                ...current,
                automation: {
                  ...current.automation,
                  defaults: { ...current.automation.defaults, timeoutMs: value }
                }
              }))
            }
            path="/automation/defaults/timeoutMs"
            value={fields.automation.defaults.timeoutMs}
          />
          <NumberField
            issues={validation.issues}
            label="Post-action delay, ms"
            min={0}
            onChange={(value) =>
              setFields((current) => ({
                ...current,
                automation: {
                  ...current.automation,
                  defaults: {
                    ...current.automation.defaults,
                    postActionDelayMs: value
                  }
                }
              }))
            }
            path="/automation/defaults/postActionDelayMs"
            value={fields.automation.defaults.postActionDelayMs}
          />
          <NumberField
            issues={validation.issues}
            label="Min typing delay, ms"
            min={0}
            onChange={(value) => updateHumanDelay(setFields, "minDelayMs", value)}
            path="/automation/defaults/humanInput/minDelayMs"
            value={fields.automation.defaults.humanInput.minDelayMs}
          />
          <NumberField
            issues={validation.issues}
            label="Max typing delay, ms"
            min={0}
            onChange={(value) => updateHumanDelay(setFields, "maxDelayMs", value)}
            path="/automation/defaults/humanInput/maxDelayMs"
            value={fields.automation.defaults.humanInput.maxDelayMs}
          />
        </div>
        <div className="editor-check-row">
          <Checkbox
            checked={fields.automation.defaults.humanInput.enabled}
            label="Human input by default"
            onChange={(event) =>
              setFields((current) => ({
                ...current,
                automation: {
                  ...current.automation,
                  defaults: {
                    ...current.automation.defaults,
                    humanInput: {
                      ...current.automation.defaults.humanInput,
                      enabled: event.target.checked
                    }
                  }
                }
              }))
            }
          />
        </div>
      </fieldset>

      <fieldset className="editor-section editor-section--steps">
        <legend>Step sequence</legend>
        <p className="editor-section-description">Build the automation from structured actions.</p>
        <StructuredStepsEditor
          disabled={saving}
          issues={validation.issues}
          onChange={(steps) => {
            setFields((current) => ({
              ...current,
              automation: { ...current.automation, steps }
            }));
          }}
          steps={fields.automation.steps}
        />

        <FieldIssues issues={validation.issues} path="/automation/steps" />
      </fieldset>

      {saveError !== undefined && (
        <Alert className="editor-error" tone="error">{saveError}</Alert>
      )}

      <div className="editor-actions">
        <Button
          disabled={saving}
          onClick={requestCancel}
          variant="secondary"
        >
          Cancel
        </Button>
        <Button
          disabled={saving || validation.issues.length > 0}
          title={
            validation.issues.length > 0
              ? "Resolve validation issues before saving"
              : undefined
          }
          type="submit"
        >
          {saving
            ? "Saving…"
            : mode === "create"
              ? "Create preset"
              : mode === "duplicate"
                ? "Save duplicate"
                : "Save changes"}
        </Button>
      </div>

      <ConfirmationDialog
        confirmLabel="Discard changes"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={onCancel}
        open={confirmDiscard}
        title="Discard unsaved changes?"
      >
        Your changes to this preset have not been saved and will be lost.
      </ConfirmationDialog>
    </form>
  );
}

type NumberFieldProps = {
  readonly label: string;
  readonly path: string;
  readonly issues: readonly PresetValidationIssue[];
  readonly min: number;
  readonly value: number;
  readonly onChange: (value: number) => void;
};

function NumberField({ label, path, issues, min, value, onChange }: NumberFieldProps) {
  return (
    <label className="editor-field compact-field">
      <span>{label}</span>
      <Input
        {...fieldAccessibility(issues, path)}
        min={min}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        required
        type="number"
        value={value}
      />
      <FieldIssues issues={issues} path={path} />
    </label>
  );
}

function FieldIssues({
  issues,
  path
}: {
  readonly issues: readonly PresetValidationIssue[];
  readonly path: string;
}) {
  const matches = issues.filter((issue) => issue.path === path);
  if (matches.length === 0) return null;
  return (
    <span
      aria-live="polite"
      className="field-error"
      data-error-path={path}
      id={fieldIssueId(path)}
      role="alert"
    >
      {matches.map((issue) => issue.message).join(" ")}
    </span>
  );
}

function fieldAccessibility(
  issues: readonly PresetValidationIssue[],
  path: string
) {
  return issues.some((issue) => issue.path === path)
    ? {
        "aria-describedby": fieldIssueId(path),
        "aria-invalid": true as const
      }
    : {};
}

function fieldIssueId(path: string): string {
  return `preset-field-error-${path.replaceAll(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`;
}

export function isPresetEditorDirty(
  initialFields: PresetEditableFields,
  currentFields: PresetEditableFields
): boolean {
  return JSON.stringify(initialFields) !== JSON.stringify(currentFields);
}

function updateHumanDelay(
  setFields: React.Dispatch<React.SetStateAction<PresetEditableFields>>,
  key: "minDelayMs" | "maxDelayMs",
  value: number
) {
  setFields((current) => ({
    ...current,
    automation: {
      ...current.automation,
      defaults: {
        ...current.automation.defaults,
        humanInput: {
          ...current.automation.defaults.humanInput,
          [key]: value
        }
      }
    }
  }));
}

function normalizeFields(fields: PresetEditableFields): PresetEditableFields {
  return {
    ...structuredClone(fields),
    name: fields.name.trim(),
    description: fields.description?.trim() ?? "",
    site: {
      ...fields.site,
      hostname: fields.site.hostname.trim().toLowerCase()
    }
  };
}

export function validatePresetEditorFields(fields: PresetEditableFields): {
  readonly fields: PresetEditableFields;
  readonly issues: readonly PresetValidationIssue[];
} {
  const normalized = normalizeFields(fields);
  const candidate = createPresetV1(normalized, {
    createId: () => "00000000-0000-4000-8000-000000000001",
    now: () => new Date("2026-01-01T00:00:00.000Z")
  });
  return { fields: normalized, issues: validatePreset(candidate) };
}
