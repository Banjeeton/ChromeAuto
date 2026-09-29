import { useState, type FormEvent } from "react";

import {
  createPresetV1,
  type PresetEditableFields
} from "../../../core/application/preset-editor";
import {
  validatePreset,
  type PresetValidationIssue
} from "../../../core/domain/preset-validator";
import type { SiteProtocol } from "../../../core/domain/site-binding";
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
  const [validationIssues, setValidationIssues] =
    useState<readonly PresetValidationIssue[]>([]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { fields: normalized, issues } = validatePresetEditorFields(fields);
    setValidationIssues(issues);
    if (issues.length > 0) {
      return;
    }
    onSave(normalized);
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
          <h3>{mode === "create" ? "Create preset" : fields.name}</h3>
        </div>
        <button
          className="icon-button"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Close
        </button>
      </div>

      <fieldset className="editor-section">
        <legend>Metadata</legend>
        <label className="editor-field">
          <span>Name</span>
          <input
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
        </label>
        <label className="editor-field">
          <span>Description</span>
          <textarea
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
        </label>
      </fieldset>

      {mode === "duplicate" && fields.site.hostname.length === 0 && (
        <p className="editor-help duplicate-hint">
          Choose a different hostname before saving. One hostname can only have
          one active automation.
        </p>
      )}

      <fieldset className="editor-section">
        <legend>Site settings</legend>
        <label className="editor-field">
          <span>Hostname</span>
          <input
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
        </label>

        <div className="editor-check-row" aria-label="Allowed protocols">
          {(["https", "http"] as const).map((protocol) => (
            <label key={protocol}>
              <input
                checked={fields.site.protocols.includes(protocol)}
                onChange={(event) =>
                  toggleProtocol(protocol, event.target.checked)
                }
                type="checkbox"
              />
              {protocol.toUpperCase()}
            </label>
          ))}
        </div>

        <div className="editor-check-row">
          <label>
            <input
              checked={fields.siteSettings.enabled}
              onChange={(event) =>
                setFields((current) => ({
                  ...current,
                  siteSettings: {
                    ...current.siteSettings,
                    enabled: event.target.checked
                  }
                }))
              }
              type="checkbox"
            />
            Preset enabled
          </label>
          <label>
            <input
              checked={fields.siteSettings.repeat.enabled}
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
              type="checkbox"
            />
            Repeat after completion
          </label>
        </div>

        <label className="editor-field compact-field">
          <span>Repeat interval, minutes</span>
          <input
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
        </label>
      </fieldset>

      <fieldset className="editor-section">
        <legend>Automation defaults</legend>
        <div className="editor-number-grid">
          <NumberField
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
            value={fields.automation.defaults.timeoutMs}
          />
          <NumberField
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
            value={fields.automation.defaults.postActionDelayMs}
          />
          <NumberField
            label="Min typing delay, ms"
            min={0}
            onChange={(value) => updateHumanDelay(setFields, "minDelayMs", value)}
            value={fields.automation.defaults.humanInput.minDelayMs}
          />
          <NumberField
            label="Max typing delay, ms"
            min={0}
            onChange={(value) => updateHumanDelay(setFields, "maxDelayMs", value)}
            value={fields.automation.defaults.humanInput.maxDelayMs}
          />
        </div>
        <div className="editor-check-row">
          <label>
            <input
              checked={fields.automation.defaults.humanInput.enabled}
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
              type="checkbox"
            />
            Human input by default
          </label>
        </div>
      </fieldset>

      <fieldset className="editor-section">
        <legend>Step sequence</legend>
        <StructuredStepsEditor
          disabled={saving}
          issues={validationIssues}
          onChange={(steps) => {
            setFields((current) => ({
              ...current,
              automation: { ...current.automation, steps }
            }));
            setValidationIssues([]);
          }}
          steps={fields.automation.steps}
        />

        {validationIssues.some(
          (issue) => !issue.path.startsWith("/automation/steps/")
        ) && (
          <div className="editor-error" role="alert">
            {validationIssues
              .filter((issue) => !issue.path.startsWith("/automation/steps/"))
              .map((issue, index) => (
                <p key={`${issue.path}-${issue.code}-${index}`}>
                  <code>{issue.path}</code>: {issue.message}
                </p>
              ))}
          </div>
        )}
      </fieldset>

      {saveError !== undefined && (
        <p className="editor-error" role="alert">{saveError}</p>
      )}

      <div className="editor-actions">
        <button
          className="action-button secondary"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button className="action-button" disabled={saving} type="submit">
          {saving
            ? "Saving…"
            : mode === "create"
              ? "Create preset"
              : mode === "duplicate"
                ? "Save duplicate"
                : "Save changes"}
        </button>
      </div>
    </form>
  );
}

type NumberFieldProps = {
  readonly label: string;
  readonly min: number;
  readonly value: number;
  readonly onChange: (value: number) => void;
};

function NumberField({ label, min, value, onChange }: NumberFieldProps) {
  return (
    <label className="editor-field compact-field">
      <span>{label}</span>
      <input
        min={min}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        required
        type="number"
        value={value}
      />
    </label>
  );
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
