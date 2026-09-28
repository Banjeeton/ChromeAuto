import { useMemo, useState, type FormEvent } from "react";

import type { PresetEditableFields } from "../../../core/application/preset-editor";
import type { AutomationStep } from "../../../core/domain/automation-step";
import type { SiteProtocol } from "../../../core/domain/site-binding";
import { createStepTemplate, STEP_TYPES } from "./step-template";

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
  const [stepsJson, setStepsJson] = useState(() =>
    formatSteps(initialFields.automation.steps)
  );
  const [stepType, setStepType] = useState<AutomationStep["type"]>("click");
  const [stepsError, setStepsError] = useState<string>();
  const parsedSteps = useMemo(() => tryParseSteps(stepsJson), [stepsJson]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const steps = requireSteps(stepsJson, setStepsError);
    if (steps === undefined) {
      return;
    }

    onSave({
      ...structuredClone(fields),
      name: fields.name.trim(),
      description: fields.description?.trim() ?? "",
      site: {
        ...fields.site,
        hostname: fields.site.hostname.trim().toLowerCase()
      },
      automation: {
        ...fields.automation,
        steps: steps as AutomationStep[]
      }
    });
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

  const changeSteps = (operation: (steps: unknown[]) => unknown[]) => {
    const steps = requireSteps(stepsJson, setStepsError);
    if (steps === undefined) {
      return;
    }
    setStepsJson(formatSteps(operation(steps)));
    setStepsError(undefined);
  };

  const addStep = () => {
    changeSteps((steps) => [...steps, createStepTemplate(stepType)]);
  };

  const moveStep = (index: number, offset: -1 | 1) => {
    changeSteps((steps) => {
      const targetIndex = index + offset;
      if (targetIndex < 0 || targetIndex >= steps.length) {
        return steps;
      }
      const reordered = [...steps];
      [reordered[index], reordered[targetIndex]] = [
        reordered[targetIndex],
        reordered[index]
      ];
      return reordered;
    });
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

      {mode === "duplicate" && (
        <p className="editor-help duplicate-hint">
          Choose a different hostname before saving. One hostname can only have
          one automation.
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
        <div className="step-toolbar">
          <select
            aria-label="New step type"
            onChange={(event) =>
              setStepType(event.target.value as AutomationStep["type"])
            }
            value={stepType}
          >
            {STEP_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <button className="inline-button neutral" onClick={addStep} type="button">
            Add step
          </button>
        </div>

        {parsedSteps.ok && parsedSteps.value.length > 0 ? (
          <ol className="editor-step-list">
            {parsedSteps.value.map((step, index) => {
              const summary = summarizeStep(step, index);
              return (
                <li key={`${summary.id}-${index}`}>
                  <div>
                    <strong>{summary.name}</strong>
                    <small>{summary.type}</small>
                  </div>
                  <div className="step-order-actions">
                    <button
                      aria-label={`Move ${summary.name} up`}
                      disabled={index === 0}
                      onClick={() => moveStep(index, -1)}
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`Move ${summary.name} down`}
                      disabled={index === parsedSteps.value.length - 1}
                      onClick={() => moveStep(index, 1)}
                      type="button"
                    >
                      ↓
                    </button>
                    <button
                      aria-label={`Delete ${summary.name}`}
                      className="danger-text"
                      onClick={() =>
                        changeSteps((steps) =>
                          steps.filter((_, stepIndex) => stepIndex !== index)
                        )
                      }
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="editor-help">No steps. Add one or edit the JSON below.</p>
        )}

        <label className="editor-field">
          <span>Steps JSON</span>
          <textarea
            className="code-editor"
            onChange={(event) => {
              setStepsJson(event.target.value);
              setStepsError(undefined);
            }}
            rows={12}
            spellCheck={false}
            value={stepsJson}
          />
        </label>
        <p className="editor-help">
          Edit complete preset v1 step objects here. Use the arrows above to
          change execution order.
        </p>
        {stepsError !== undefined && (
          <p className="editor-error" role="alert">{stepsError}</p>
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

type ParsedSteps =
  | { readonly ok: true; readonly value: unknown[] }
  | { readonly ok: false; readonly message: string };

function tryParseSteps(source: string): ParsedSteps {
  try {
    const value = JSON.parse(source) as unknown;
    if (!Array.isArray(value)) {
      return { ok: false, message: "Steps JSON must be an array." };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, message: "Steps must contain valid JSON." };
  }
}

function requireSteps(
  source: string,
  setError: (message: string | undefined) => void
): unknown[] | undefined {
  const parsed = tryParseSteps(source);
  if (!parsed.ok) {
    setError(parsed.message);
    return undefined;
  }
  return parsed.value;
}

function formatSteps(steps: readonly unknown[]): string {
  return JSON.stringify(steps, null, 2);
}

function summarizeStep(
  value: unknown,
  index: number
): { id: string; name: string; type: string } {
  if (typeof value !== "object" || value === null) {
    return {
      id: `invalid-${index}`,
      name: `Invalid step ${index + 1}`,
      type: "Invalid value"
    };
  }

  const candidate = value as Record<string, unknown>;
  const type = typeof candidate.type === "string" ? candidate.type : "Unknown";
  const id = typeof candidate.id === "string" ? candidate.id : `step-${index}`;
  const name =
    typeof candidate.name === "string" && candidate.name.length > 0
      ? candidate.name
      : `Step ${index + 1}`;
  return { id, name, type };
}
