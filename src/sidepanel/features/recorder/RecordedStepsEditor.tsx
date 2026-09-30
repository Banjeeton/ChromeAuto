import { useState, type FormEvent } from "react";

import {
  validateRecorderDraftSteps,
  type RecorderDraftView
} from "../../../core/application/recorder-draft-controller";
import type {
  AutomationStep,
  ElementTarget,
  InputStep,
  PressKeyStep,
  SelectStep
} from "../../../core/domain/automation-step";
import { Button, ConfirmationDialog } from "../../components";
import { createStepTemplate } from "../presets/step-template";

type ManualRecordedStepType =
  | "select"
  | "check"
  | "uncheck"
  | "pressKey"
  | "wait"
  | "customCode";

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
    useState<ManualRecordedStepType>("select");
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
  const presetNameError = validationErrors.some((message) =>
    message.startsWith("/name:")
  );

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
    if (hasTarget(step)) {
      setTargetSources((current) => ({
        ...current,
        [step.id]: JSON.stringify(step.target, null, 2)
      }));
    }
  };

  const updatePressKeyTarget = (
    index: number,
    stepId: string,
    enabled: boolean
  ) => {
    if (enabled) {
      const target = defaultTarget();
      setTargetSources((current) => ({
        ...current,
        [stepId]: JSON.stringify(target, null, 2)
      }));
      setTargetErrors(({ [stepId]: _removed, ...remaining }) => remaining);
      updateStep(index, (step) =>
        step.type === "pressKey" ? { ...step, target } : step
      );
      return;
    }

    setTargetSources(({ [stepId]: _removed, ...remaining }) => remaining);
    setTargetErrors(({ [stepId]: _removed, ...remaining }) => remaining);
    updateStep(index, (step) => {
      if (step.type !== "pressKey") {
        return step;
      }
      const { target: _removed, ...withoutTarget } = step;
      return withoutTarget;
    });
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
        Steps are shown in the order they were captured. Changes stay in this
        draft and do not modify saved presets.
      </p>

      <fieldset className="editor-section recorded-preset-fields">
        <legend>Portable preset</legend>
        <label className="editor-field">
          <span>Preset name</span>
          <input
            aria-describedby={
              presetNameError ? "recorded-preset-name-error" : undefined
            }
            aria-invalid={presetNameError || undefined}
            maxLength={120}
            onChange={(event) => setPresetName(event.target.value)}
            required
            value={presetName}
          />
          {presetNameError && (
            <small
              aria-live="polite"
              className="field-error"
              id="recorded-preset-name-error"
              role="alert"
            >
              Preset name is required.
            </small>
          )}
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
            setNewStepType(event.target.value as ManualRecordedStepType)
          }
          value={newStepType}
        >
          <option value="select">select</option>
          <option value="check">check</option>
          <option value="uncheck">uncheck</option>
          <option value="pressKey">pressKey</option>
          <option value="wait">wait</option>
          <option value="customCode">customCode</option>
        </select>
        <Button
          disabled={busy}
          onClick={addStep}
          size="small"
          variant="secondary"
        >
          Add step
        </Button>
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
                    aria-label={`Enable step ${index + 1}`}
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

              {step.type === "pressKey" && (
                <PressKeyFields
                  onChange={(updated) => updateStep(index, () => updated)}
                  onTargetChange={(enabled) =>
                    updatePressKeyTarget(index, step.id, enabled)
                  }
                  step={step}
                />
              )}

              {hasTarget(step) && (
                <label className="editor-field">
                  <span>Locators JSON</span>
                  <textarea
                    aria-describedby={
                      targetErrors[step.id] === undefined
                        ? undefined
                        : `recorded-target-error-${step.id}`
                    }
                    aria-invalid={targetErrors[step.id] !== undefined || undefined}
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
                    <small
                      aria-live="polite"
                      className="field-error"
                      id={`recorded-target-error-${step.id}`}
                      role="alert"
                    >
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

              {step.type === "select" && (
                <SelectFields
                  onChange={(updated) => updateStep(index, () => updated)}
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
                  aria-label={`Delete step ${index + 1}`}
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

      <ConfirmationDialog
        busy={busy}
        cancelLabel="Keep draft"
        confirmLabel="Discard draft"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={onDiscard}
        open={confirmDiscard}
        title="Discard recording?"
      >
        All captured and edited steps will be lost.
      </ConfirmationDialog>

      <div className="editor-actions recorded-editor-actions">
        <Button
          disabled={busy}
          onClick={() => setConfirmDiscard(true)}
          variant="secondary"
        >
          Cancel creation
        </Button>
        <Button disabled={busy} type="submit">
          {busy ? "Saving…" : "Save draft"}
        </Button>
        <Button
          className="create-recorded-preset-button"
          disabled={busy}
          onClick={createPreset}
        >
          {creatingPreset ? "Creating preset…" : "Create preset"}
        </Button>
      </div>
    </form>
  );
}

function SelectFields({
  step,
  onChange
}: {
  readonly step: SelectStep;
  readonly onChange: (step: SelectStep) => void;
}) {
  return (
    <div className="editor-check-row recorded-select-fields">
      <label>
        Selection method
        <select
          aria-label="Selection method"
          onChange={(event) => {
            const by = event.target.value as SelectStep["option"]["by"];
            onChange({
              ...step,
              option:
                by === "index"
                  ? {
                      by,
                      value:
                        step.option.by === "index" ? step.option.value : 0
                    }
                  : {
                      by,
                      value:
                        step.option.by === "index"
                          ? ""
                          : step.option.value
                    }
            });
          }}
          value={step.option.by}
        >
          <option value="value">value</option>
          <option value="label">label</option>
          <option value="index">index</option>
        </select>
      </label>
      <label>
        {step.option.by === "index"
          ? "Option index"
          : step.option.by === "label"
            ? "Option label"
            : "Option value"}
        <input
          aria-label={
            step.option.by === "index"
              ? "Option index"
              : step.option.by === "label"
                ? "Option label"
                : "Option value"
          }
          min={step.option.by === "index" ? 0 : undefined}
          onChange={(event) =>
            onChange({
              ...step,
              option:
                step.option.by === "index"
                  ? { by: "index", value: Number(event.target.value) }
                  : { ...step.option, value: event.target.value }
            })
          }
          type={step.option.by === "index" ? "number" : "text"}
          value={step.option.value}
        />
      </label>
    </div>
  );
}

function PressKeyFields({
  step,
  onChange,
  onTargetChange
}: {
  readonly step: PressKeyStep;
  readonly onChange: (step: PressKeyStep) => void;
  readonly onTargetChange: (enabled: boolean) => void;
}) {
  return (
    <div className="editor-check-row recorded-press-key-fields">
      <label>
        Key or shortcut
        <input
          aria-label="Key or shortcut"
          onChange={(event) => onChange({ ...step, key: event.target.value })}
          placeholder="Enter or Control+Enter"
          value={step.key}
        />
      </label>
      <label>
        <input
          checked={step.target !== undefined}
          onChange={(event) => onTargetChange(event.target.checked)}
          type="checkbox"
        />
        Target a specific element
      </label>
    </div>
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
): step is AutomationStep & { target: ElementTarget } {
  return "target" in step && step.target !== undefined;
}

function defaultTarget(): ElementTarget {
  return {
    primary: { type: "css", value: "body" },
    fallbacks: []
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
