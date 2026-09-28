import { useState, type FormEvent } from "react";

import {
  validateRecorderDraftSteps,
  type RecorderDraftView
} from "../../../core/application/recorder-draft-controller";
import type {
  AutomationStep,
  ElementTarget,
  InputStep
} from "../../../core/domain/automation-step";
import { createStepTemplate } from "../presets/step-template";

export interface RecordedStepsEditorProps {
  readonly draft: RecorderDraftView;
  readonly busy: boolean;
  readonly saveError?: string;
  readonly onSave: (steps: readonly AutomationStep[]) => void;
  readonly onCreatePreset: (fields: RecordedPresetFields) => void;
  readonly onDiscard: () => void;
  readonly creatingPreset?: boolean;
}

export interface RecordedPresetFields {
  readonly name: string;
  readonly description?: string;
  readonly steps: readonly AutomationStep[];
}

export function RecordedStepsEditor({
  draft,
  busy,
  saveError,
  onSave,
  onCreatePreset,
  onDiscard,
  creatingPreset = false
}: RecordedStepsEditorProps) {
  const [steps, setSteps] = useState<AutomationStep[]>(() =>
    [...structuredClone(draft.steps)]
  );
  const [newStepType, setNewStepType] =
    useState<"wait" | "customCode">("wait");
  const [targetSources, setTargetSources] = useState<Record<string, string>>(
    () => targetJsonSources(draft.steps)
  );
  const [targetErrors, setTargetErrors] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [presetName, setPresetName] = useState(
    `Recorded automation for ${draft.hostname}`
  );
  const [presetDescription, setPresetDescription] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateStepsForAction()) {
      return;
    }
    onSave(structuredClone(steps));
  };

  const validateStepsForAction = (): boolean => {
    if (Object.keys(targetErrors).length > 0) {
      setValidationErrors([
        "Fix invalid locator JSON before saving the draft."
      ]);
      return false;
    }
    const issues = validateRecorderDraftSteps(
      steps,
      draft.hostname,
      draft.protocol
    );
    if (issues.length > 0) {
      setValidationErrors(
        issues.map((issue) => `${issue.path}: ${issue.message}`)
      );
      return false;
    }
    setValidationErrors([]);
    return true;
  };

  const createPreset = () => {
    if (!validateStepsForAction()) {
      return;
    }
    if (presetName.trim().length === 0) {
      setValidationErrors(["/name: Preset name is required."]);
      return;
    }
    onCreatePreset({
      name: presetName.trim(),
      ...(presetDescription.trim().length === 0
        ? {}
        : { description: presetDescription.trim() }),
      steps: structuredClone(steps)
    });
  };

  const updateStep = (
    index: number,
    update: (step: AutomationStep) => AutomationStep
  ) => {
    setSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index ? update(step) : step
      )
    );
    setValidationErrors([]);
  };

  const moveStep = (index: number, offset: -1 | 1) => {
    setSteps((current) => {
      const destination = index + offset;
      if (destination < 0 || destination >= current.length) {
        return current;
      }
      const moved = [...current];
      [moved[index], moved[destination]] = [moved[destination], moved[index]];
      return moved;
    });
  };

  const removeStep = (index: number, stepId: string) => {
    setSteps((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setTargetSources(({ [stepId]: _removed, ...remaining }) => remaining);
    setTargetErrors(({ [stepId]: _removed, ...remaining }) => remaining);
  };

  const addStep = () => {
    const step = createStepTemplate(newStepType);
    setSteps((current) => [...current, step]);
  };

  const updateTarget = (index: number, stepId: string, source: string) => {
    setTargetSources((current) => ({ ...current, [stepId]: source }));
    try {
      const target = JSON.parse(source) as unknown;
      if (!isObject(target)) {
        throw new Error("Target must be an object.");
      }
      setTargetErrors(({ [stepId]: _removed, ...remaining }) => remaining);
      updateStep(index, (step) =>
        hasTarget(step)
          ? { ...step, target: target as unknown as ElementTarget }
          : step
      );
    } catch (error) {
      setTargetErrors((current) => ({
        ...current,
        [stepId]: error instanceof Error ? error.message : "Invalid JSON."
      }));
    }
  };

  return (
    <form className="recorded-steps-editor" onSubmit={submit}>
      <div className="editor-heading">
        <div>
          <p className="section-label">Recorded draft</p>
          <h3>Review recorded steps</h3>
        </div>
        <span className="recorded-step-count">
          {steps.length} {steps.length === 1 ? "step" : "steps"}
        </span>
      </div>

      <p className="editor-help">
        Changes stay in this draft and do not modify saved presets.
      </p>

      <fieldset className="editor-section recorded-preset-fields">
        <legend>Portable preset</legend>
        <label className="editor-field">
          <span>Preset name</span>
          <input
            maxLength={120}
            onChange={(event) => setPresetName(event.target.value)}
            required
            value={presetName}
          />
        </label>
        <label className="editor-field">
          <span>Description</span>
          <textarea
            onChange={(event) => setPresetDescription(event.target.value)}
            placeholder="What does this recorded automation do?"
            rows={2}
            value={presetDescription}
          />
        </label>
        <p className="editor-help">
          Site: {draft.protocol}://{draft.hostname}
        </p>
      </fieldset>

      <div className="step-toolbar recorder-step-toolbar">
        <select
          aria-label="New recorded step type"
          onChange={(event) =>
            setNewStepType(event.target.value as "wait" | "customCode")
          }
          value={newStepType}
        >
          <option value="wait">wait</option>
          <option value="customCode">customCode</option>
        </select>
        <button
          className="inline-button neutral"
          disabled={busy}
          onClick={addStep}
          type="button"
        >
          Add step
        </button>
      </div>

      {steps.length === 0 ? (
        <p className="empty-state">No recorded steps yet.</p>
      ) : (
        <ol className="recorded-step-list">
          {steps.map((step, index) => (
            <li className="recorded-step-card" key={`${step.id}-${index}`}>
              <div className="recorded-step-header">
                <span>{index + 1}</span>
                <strong>{step.type}</strong>
                <label>
                  <input
                    checked={step.enabled}
                    onChange={(event) =>
                      updateStep(index, (current) => ({
                        ...current,
                        enabled: event.target.checked
                      }))
                    }
                    type="checkbox"
                  />
                  Enabled
                </label>
              </div>

              <label className="editor-field">
                <span>Step name</span>
                <input
                  maxLength={120}
                  onChange={(event) => {
                    const name = event.target.value;
                    updateStep(index, (current) => {
                      if (name.length === 0) {
                        const { name: _removed, ...withoutName } = current;
                        return withoutName as AutomationStep;
                      }
                      return { ...current, name };
                    });
                  }}
                  placeholder={`Step ${index + 1}`}
                  value={step.name ?? ""}
                />
              </label>

              {hasTarget(step) && (
                <label className="editor-field">
                  <span>Locators JSON</span>
                  <textarea
                    className="locator-editor"
                    onChange={(event) =>
                      updateTarget(index, step.id, event.target.value)
                    }
                    rows={6}
                    spellCheck={false}
                    value={
                      targetSources[step.id] ?? JSON.stringify(step.target, null, 2)
                    }
                  />
                  {targetErrors[step.id] !== undefined && (
                    <small className="field-error">
                      /automation/steps/{index}/target: {targetErrors[step.id]}
                    </small>
                  )}
                </label>
              )}

              {step.type === "input" && (
                <InputFields
                  onChange={(updated) =>
                    updateStep(index, () => updated)
                  }
                  step={step}
                />
              )}

              {step.type === "wait" && step.condition.type === "timeout" && (
                <label className="editor-field compact-field">
                  <span>Wait duration, ms</span>
                  <input
                    min={0}
                    onChange={(event) =>
                      updateStep(index, (current) =>
                        current.type === "wait"
                          ? {
                              ...current,
                              condition: {
                                type: "timeout",
                                durationMs: event.target.valueAsNumber
                              }
                            }
                          : current
                      )
                    }
                    type="number"
                    value={step.condition.durationMs}
                  />
                </label>
              )}

              {step.type === "customCode" && (
                <label className="editor-field">
                  <span>JavaScript</span>
                  <textarea
                    className="code-editor recorded-code-editor"
                    onChange={(event) =>
                      updateStep(index, (current) =>
                        current.type === "customCode"
                          ? { ...current, source: event.target.value }
                          : current
                      )
                    }
                    rows={8}
                    spellCheck={false}
                    value={step.source}
                  />
                </label>
              )}

              <div className="step-order-actions recorded-step-actions">
                <button
                  aria-label={`Move step ${index + 1} up`}
                  disabled={busy || index === 0}
                  onClick={() => moveStep(index, -1)}
                  type="button"
                >
                  ↑ Up
                </button>
                <button
                  aria-label={`Move step ${index + 1} down`}
                  disabled={busy || index === steps.length - 1}
                  onClick={() => moveStep(index, 1)}
                  type="button"
                >
                  ↓ Down
                </button>
                <button
                  className="danger-text"
                  disabled={busy}
                  onClick={() => removeStep(index, step.id)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {validationErrors.length > 0 && (
        <div className="editor-error" role="alert">
          {validationErrors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
      {saveError !== undefined && (
        <p className="editor-error" role="alert">{saveError}</p>
      )}

      {confirmDiscard && (
        <div className="delete-confirmation recorder-discard-confirmation">
          <p>
            Discard this recording? All captured and edited steps will be lost.
          </p>
          <div>
            <button
              className="inline-button neutral"
              disabled={busy}
              onClick={() => setConfirmDiscard(false)}
              type="button"
            >
              Keep draft
            </button>
            <button
              className="inline-button destructive"
              disabled={busy}
              onClick={onDiscard}
              type="button"
            >
              Discard draft
            </button>
          </div>
        </div>
      )}

      <div className="editor-actions recorded-editor-actions">
        <button
          className="action-button secondary"
          disabled={busy}
          onClick={() => setConfirmDiscard(true)}
          type="button"
        >
          Cancel creation
        </button>
        <button className="action-button" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save draft"}
        </button>
        <button
          className="action-button create-recorded-preset-button"
          disabled={busy}
          onClick={createPreset}
          type="button"
        >
          {creatingPreset ? "Creating preset…" : "Create preset"}
        </button>
      </div>
    </form>
  );
}

function InputFields({
  step,
  onChange
}: {
  readonly step: InputStep;
  readonly onChange: (step: InputStep) => void;
}) {
  return (
    <>
      <label className="editor-field">
        <span>Input value</span>
        <textarea
          onChange={(event) => onChange({ ...step, value: event.target.value })}
          rows={3}
          value={step.value}
        />
      </label>
      <div className="editor-check-row">
        <label>
          <input
            checked={step.clearFirst}
            onChange={(event) =>
              onChange({ ...step, clearFirst: event.target.checked })
            }
            type="checkbox"
          />
          Clear before input
        </label>
        <label>
          Input mode
          <select
            onChange={(event) =>
              onChange({
                ...step,
                inputMode: event.target.value as InputStep["inputMode"]
              })
            }
            value={step.inputMode}
          >
            <option value="default">default</option>
            <option value="instant">instant</option>
            <option value="human">human</option>
          </select>
        </label>
      </div>
    </>
  );
}

function targetJsonSources(
  steps: readonly AutomationStep[]
): Record<string, string> {
  return Object.fromEntries(
    steps
      .filter(hasTarget)
      .map((step) => [step.id, JSON.stringify(step.target, null, 2)])
  );
}

function hasTarget(
  step: AutomationStep
): step is Extract<AutomationStep, { target: ElementTarget }> {
  return "target" in step;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
