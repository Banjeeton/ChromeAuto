import { useState } from "react";

import type {
  AutomationStep,
  ElementLocator,
  ElementTarget,
  InputStep,
  PressKeyStep,
  SelectStep,
  WaitCondition,
  WaitStep
} from "../../../core/domain/automation-step";
import type { PresetValidationIssue } from "../../../core/domain/preset-validator";
import { createStepTemplate, STEP_TYPES } from "./step-template";

export interface StructuredStepsEditorProps {
  readonly steps: readonly AutomationStep[];
  readonly disabled?: boolean;
  readonly issues?: readonly PresetValidationIssue[];
  readonly onChange: (steps: AutomationStep[]) => void;
}

export function StructuredStepsEditor({
  steps,
  disabled = false,
  issues = [],
  onChange
}: StructuredStepsEditorProps) {
  const [newStepType, setNewStepType] =
    useState<AutomationStep["type"]>("click");

  const updateStep = (
    index: number,
    update: (step: AutomationStep) => AutomationStep
  ) => {
    onChange(
      steps.map((step, stepIndex) =>
        stepIndex === index ? update(structuredClone(step)) : structuredClone(step)
      )
    );
  };

  const moveStep = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= steps.length) return;
    const reordered = structuredClone(steps) as AutomationStep[];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    onChange(reordered);
  };

  const removeStep = (index: number) => {
    onChange(
      steps
        .filter((_, stepIndex) => stepIndex !== index)
        .map((step) => structuredClone(step))
    );
  };

  return (
    <div className="structured-steps-editor">
      <div className="step-toolbar">
        <select
          aria-label="New step type"
          disabled={disabled}
          onChange={(event) =>
            setNewStepType(event.target.value as AutomationStep["type"])
          }
          value={newStepType}
        >
          {STEP_TYPES.map((type) => (
            <option key={type} value={type}>{stepTypeLabel(type)}</option>
          ))}
        </select>
        <button
          className="inline-button neutral"
          disabled={disabled}
          onClick={() => onChange([...structuredClone(steps), createStepTemplate(newStepType)])}
          type="button"
        >
          Add step
        </button>
      </div>

      {steps.length === 0 ? (
        <p className="editor-help">No steps yet. Choose an action and add it.</p>
      ) : (
        <ol className="structured-step-list">
          {steps.map((step, index) => {
            const stepIssues = issues.filter((issue) =>
              issue.path.startsWith(`/automation/steps/${index}`)
            );
            return (
              <li className="structured-step-card" key={step.id}>
                <div className="structured-step-header">
                  <span>{index + 1}</span>
                  <div className="structured-step-title">
                    <strong>{step.name || stepTypeLabel(step.type)}</strong>
                    <small>{step.id}</small>
                  </div>
                  <em>{step.type}</em>
                  <label>
                    <input
                      checked={step.enabled}
                      disabled={disabled}
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

                <CommonStepFields
                  disabled={disabled}
                  onChange={(updated) => updateStep(index, () => updated)}
                  step={step}
                />
                <ActionFields
                  disabled={disabled}
                  onChange={(updated) => updateStep(index, () => updated)}
                  path={`/automation/steps/${index}`}
                  step={step}
                />

                {stepIssues.length > 0 && (
                  <div className="step-validation-errors" role="alert">
                    {stepIssues.map((issue, issueIndex) => (
                      <p key={`${issue.path}-${issue.code}-${issueIndex}`}>
                        <code>{issue.path}</code>: {issue.message}
                      </p>
                    ))}
                  </div>
                )}

                <div className="step-order-actions structured-step-actions">
                  <button
                    aria-label={`Move step ${index + 1} up`}
                    disabled={disabled || index === 0}
                    onClick={() => moveStep(index, -1)}
                    type="button"
                  >
                    ↑ Up
                  </button>
                  <button
                    aria-label={`Move step ${index + 1} down`}
                    disabled={disabled || index === steps.length - 1}
                    onClick={() => moveStep(index, 1)}
                    type="button"
                  >
                    ↓ Down
                  </button>
                  <button
                    aria-label={`Delete step ${index + 1}`}
                    className="danger-text"
                    disabled={disabled}
                    onClick={() => removeStep(index)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function CommonStepFields({
  step,
  disabled,
  onChange
}: {
  readonly step: AutomationStep;
  readonly disabled: boolean;
  readonly onChange: (step: AutomationStep) => void;
}) {
  return (
    <>
      <label className="editor-field">
        <span>Name (optional)</span>
        <input
          disabled={disabled}
          onChange={(event) => {
            const name = event.target.value;
            if (name.length === 0) {
              const { name: _name, ...withoutName } = step;
              onChange(withoutName as AutomationStep);
            } else {
              onChange({ ...step, name });
            }
          }}
          placeholder="Describe this step"
          value={step.name ?? ""}
        />
      </label>
      <div className="optional-number-grid">
        <OptionalNumberField
          disabled={disabled}
          label="Timeout override, ms"
          min={1}
          onChange={(value) => onChange(withOptionalNumber(step, "timeoutMs", value))}
          value={step.timeoutMs}
        />
        <OptionalNumberField
          disabled={disabled}
          label="Post-action delay, ms"
          min={0}
          onChange={(value) =>
            onChange(withOptionalNumber(step, "postActionDelayMs", value))
          }
          value={step.postActionDelayMs}
        />
      </div>
    </>
  );
}

function ActionFields({
  step,
  path,
  disabled,
  onChange
}: {
  readonly step: AutomationStep;
  readonly path: string;
  readonly disabled: boolean;
  readonly onChange: (step: AutomationStep) => void;
}) {
  switch (step.type) {
    case "click":
      return (
        <>
          <TargetEditor
            disabled={disabled}
            onChange={(target) => onChange({ ...step, target })}
            path={`${path}/target`}
            target={step.target}
          />
          <div className="editor-number-grid">
            <label className="editor-field">
              <span>Mouse button</span>
              <select
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...step, button: event.target.value as typeof step.button })
                }
                value={step.button}
              >
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="middle">Middle</option>
              </select>
            </label>
            <NumberInput
              disabled={disabled}
              label="Click count"
              min={1}
              onChange={(clickCount) => onChange({ ...step, clickCount })}
              value={step.clickCount}
            />
          </div>
        </>
      );
    case "input":
      return <InputFields disabled={disabled} onChange={onChange} path={path} step={step} />;
    case "select":
      return <SelectFields disabled={disabled} onChange={onChange} path={path} step={step} />;
    case "check":
    case "uncheck":
      return (
        <TargetEditor
          disabled={disabled}
          onChange={(target) => onChange({ ...step, target })}
          path={`${path}/target`}
          target={step.target}
        />
      );
    case "pressKey":
      return <PressKeyFields disabled={disabled} onChange={onChange} path={path} step={step} />;
    case "wait":
      return <WaitFields disabled={disabled} onChange={onChange} path={path} step={step} />;
    case "reload":
      return (
        <label className="editor-field">
          <span>Wait until</span>
          <select
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...step, waitUntil: event.target.value as typeof step.waitUntil })
            }
            value={step.waitUntil}
          >
            <option value="domcontentloaded">DOM content loaded</option>
            <option value="load">Page loaded</option>
            <option value="networkidle">Network idle</option>
            <option value="none">Do not wait</option>
          </select>
        </label>
      );
    case "customCode":
      return (
        <label className="editor-field">
          <span>JavaScript</span>
          <textarea
            className="code-editor structured-code-editor"
            disabled={disabled}
            onChange={(event) => onChange({ ...step, source: event.target.value })}
            rows={8}
            spellCheck={false}
            value={step.source}
          />
        </label>
      );
  }
}

function InputFields({ step, path, disabled, onChange }: {
  readonly step: InputStep;
  readonly path: string;
  readonly disabled: boolean;
  readonly onChange: (step: AutomationStep) => void;
}) {
  return (
    <>
      <TargetEditor disabled={disabled} onChange={(target) => onChange({ ...step, target })} path={`${path}/target`} target={step.target} />
      <label className="editor-field">
        <span>Input value</span>
        <textarea disabled={disabled} onChange={(event) => onChange({ ...step, value: event.target.value })} rows={3} value={step.value} />
      </label>
      <div className="editor-check-row">
        <label><input checked={step.clearFirst} disabled={disabled} onChange={(event) => onChange({ ...step, clearFirst: event.target.checked })} type="checkbox" />Clear before input</label>
        <label>
          Input mode
          <select disabled={disabled} onChange={(event) => onChange({ ...step, inputMode: event.target.value as InputStep["inputMode"] })} value={step.inputMode}>
            <option value="default">Default</option>
            <option value="instant">Instant</option>
            <option value="human">Human</option>
          </select>
        </label>
        <label><input checked={step.humanInput !== undefined} disabled={disabled} onChange={(event) => onChange(event.target.checked ? { ...step, humanInput: { minDelayMs: 40, maxDelayMs: 120 } } : withoutProperty(step, "humanInput"))} type="checkbox" />Override human delays</label>
      </div>
      {step.humanInput !== undefined && (
        <div className="editor-number-grid">
          <NumberInput disabled={disabled} label="Min typing delay, ms" min={0} onChange={(minDelayMs) => onChange({ ...step, humanInput: { ...step.humanInput!, minDelayMs } })} value={step.humanInput.minDelayMs} />
          <NumberInput disabled={disabled} label="Max typing delay, ms" min={0} onChange={(maxDelayMs) => onChange({ ...step, humanInput: { ...step.humanInput!, maxDelayMs } })} value={step.humanInput.maxDelayMs} />
        </div>
      )}
    </>
  );
}

function SelectFields({ step, path, disabled, onChange }: {
  readonly step: SelectStep;
  readonly path: string;
  readonly disabled: boolean;
  readonly onChange: (step: AutomationStep) => void;
}) {
  return (
    <>
      <TargetEditor disabled={disabled} onChange={(target) => onChange({ ...step, target })} path={`${path}/target`} target={step.target} />
      <div className="editor-number-grid">
        <label className="editor-field">
          <span>Selection method</span>
          <select disabled={disabled} onChange={(event) => {
            const by = event.target.value as SelectStep["option"]["by"];
            onChange({ ...step, option: by === "index" ? { by, value: 0 } : { by, value: "" } });
          }} value={step.option.by}>
            <option value="value">Value</option><option value="label">Visible label</option><option value="index">Index</option>
          </select>
        </label>
        <NumberOrTextOption disabled={disabled} onChange={onChange} step={step} />
      </div>
    </>
  );
}

function NumberOrTextOption({ step, disabled, onChange }: { readonly step: SelectStep; readonly disabled: boolean; readonly onChange: (step: AutomationStep) => void }) {
  const label = step.option.by === "index" ? "Option index" : step.option.by === "label" ? "Option label" : "Option value";
  return (
    <label className="editor-field"><span>{label}</span><input disabled={disabled} min={step.option.by === "index" ? 0 : undefined} onChange={(event) => onChange({ ...step, option: step.option.by === "index" ? { by: "index", value: event.target.valueAsNumber } : { ...step.option, value: event.target.value } })} type={step.option.by === "index" ? "number" : "text"} value={step.option.value} /></label>
  );
}

function PressKeyFields({ step, path, disabled, onChange }: { readonly step: PressKeyStep; readonly path: string; readonly disabled: boolean; readonly onChange: (step: AutomationStep) => void }) {
  return (
    <>
      <label className="editor-field"><span>Key or shortcut</span><input disabled={disabled} onChange={(event) => onChange({ ...step, key: event.target.value })} placeholder="Enter or Control+Enter" value={step.key} /></label>
      <label className="editor-checkbox-field"><input checked={step.target !== undefined} disabled={disabled} onChange={(event) => onChange(event.target.checked ? { ...step, target: defaultTarget() } : withoutProperty(step, "target"))} type="checkbox" />Target a specific element</label>
      {step.target !== undefined && <TargetEditor disabled={disabled} onChange={(target) => onChange({ ...step, target })} path={`${path}/target`} target={step.target} />}
    </>
  );
}

function WaitFields({ step, path, disabled, onChange }: { readonly step: WaitStep; readonly path: string; readonly disabled: boolean; readonly onChange: (step: AutomationStep) => void }) {
  const condition = step.condition;
  return (
    <>
      <label className="editor-field">
        <span>Wait condition</span>
        <select disabled={disabled} onChange={(event) => onChange({ ...step, condition: createWaitCondition(event.target.value as WaitCondition["type"]) })} value={condition.type}>
          <option value="timeout">Duration</option><option value="element">Element state</option><option value="url">URL</option><option value="pageLoad">Page load</option>
        </select>
      </label>
      {condition.type === "timeout" && <NumberInput disabled={disabled} label="Duration, ms" min={0} onChange={(durationMs) => onChange({ ...step, condition: { type: "timeout", durationMs } })} value={condition.durationMs} />}
      {condition.type === "element" && (
        <><label className="editor-field"><span>Element state</span><select disabled={disabled} onChange={(event) => onChange({ ...step, condition: { ...condition, state: event.target.value as typeof condition.state } })} value={condition.state}><option value="attached">Attached</option><option value="detached">Detached</option><option value="visible">Visible</option><option value="hidden">Hidden</option></select></label><TargetEditor disabled={disabled} onChange={(target) => onChange({ ...step, condition: { ...condition, target } })} path={`${path}/condition/target`} target={condition.target} /></>
      )}
      {condition.type === "url" && <div className="editor-number-grid"><label className="editor-field"><span>URL match</span><select disabled={disabled} onChange={(event) => onChange({ ...step, condition: { ...condition, match: event.target.value as typeof condition.match } })} value={condition.match}><option value="exact">Exact</option><option value="contains">Contains</option><option value="regex">Regular expression</option></select></label><label className="editor-field"><span>URL value</span><input disabled={disabled} onChange={(event) => onChange({ ...step, condition: { ...condition, value: event.target.value } })} value={condition.value} /></label></div>}
      {condition.type === "pageLoad" && <label className="editor-field"><span>Load state</span><select disabled={disabled} onChange={(event) => onChange({ ...step, condition: { type: "pageLoad", state: event.target.value as typeof condition.state } })} value={condition.state}><option value="domcontentloaded">DOM content loaded</option><option value="load">Page loaded</option><option value="networkidle">Network idle</option></select></label>}
    </>
  );
}

function TargetEditor({ target, path, disabled, onChange }: { readonly target: ElementTarget; readonly path: string; readonly disabled: boolean; readonly onChange: (target: ElementTarget) => void }) {
  return (
    <fieldset className="target-editor">
      <legend>Target locators</legend>
      <LocatorEditor disabled={disabled} label="Primary locator" locator={target.primary} onChange={(primary) => onChange({ ...target, primary })} path={`${path}/primary`} />
      {target.fallbacks.map((locator, index) => (
        <div className="fallback-locator" key={`${index}-${locator.type}`}>
          <LocatorEditor disabled={disabled} label={`Fallback ${index + 1}`} locator={locator} onChange={(updated) => onChange({ ...target, fallbacks: target.fallbacks.map((current, fallbackIndex) => fallbackIndex === index ? updated : current) })} path={`${path}/fallbacks/${index}`} />
          <button className="danger-text locator-remove-button" disabled={disabled} onClick={() => onChange({ ...target, fallbacks: target.fallbacks.filter((_, fallbackIndex) => fallbackIndex !== index) })} type="button">Remove fallback</button>
        </div>
      ))}
      <button className="inline-button neutral add-fallback-button" disabled={disabled} onClick={() => onChange({ ...target, fallbacks: [...target.fallbacks, { type: "css", value: "body" }] })} type="button">Add fallback locator</button>
    </fieldset>
  );
}

function LocatorEditor({ locator, label, path, disabled, onChange }: { readonly locator: ElementLocator; readonly label: string; readonly path: string; readonly disabled: boolean; readonly onChange: (locator: ElementLocator) => void }) {
  return (
    <div className="locator-fields" data-path={path}>
      <strong>{label}</strong>
      <label className="editor-field"><span>Locator type</span><select aria-label={`${label} type`} disabled={disabled} onChange={(event) => onChange(createLocator(event.target.value as ElementLocator["type"]))} value={locator.type}>{LOCATOR_TYPES.map((type) => <option key={type} value={type}>{locatorTypeLabel(type)}</option>)}</select></label>
      {locator.type === "role" ? (
        <><label className="editor-field"><span>ARIA role</span><input disabled={disabled} onChange={(event) => onChange({ ...locator, role: event.target.value })} value={locator.role} /></label><label className="editor-field"><span>Accessible name</span><input disabled={disabled} onChange={(event) => onChange({ ...locator, name: event.target.value })} value={locator.name} /></label><ExactField disabled={disabled} exact={locator.exact} onChange={(exact) => onChange({ ...locator, exact })} /></>
      ) : (
        <><label className="editor-field"><span>{locatorValueLabel(locator.type)}</span><input disabled={disabled} onChange={(event) => onChange({ ...locator, value: event.target.value })} spellCheck={false} value={locator.value} /></label>{"exact" in locator && <ExactField disabled={disabled} exact={locator.exact} onChange={(exact) => onChange({ ...locator, exact })} />}</>
      )}
    </div>
  );
}

function ExactField({ exact, disabled, onChange }: { readonly exact: boolean; readonly disabled: boolean; readonly onChange: (exact: boolean) => void }) {
  return <label className="editor-checkbox-field"><input checked={exact} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />Exact match</label>;
}

function OptionalNumberField({ label, value, min, disabled, onChange }: { readonly label: string; readonly value?: number; readonly min: number; readonly disabled: boolean; readonly onChange: (value: number | undefined) => void }) {
  const enabled = value !== undefined;
  return (
    <div className="optional-number-field"><label className="editor-checkbox-field"><input checked={enabled} disabled={disabled} onChange={(event) => onChange(event.target.checked ? min : undefined)} type="checkbox" />{label}</label>{enabled && <input aria-label={label} disabled={disabled} min={min} onChange={(event) => onChange(event.target.valueAsNumber)} type="number" value={value} />}</div>
  );
}

function NumberInput({ label, value, min, disabled, onChange }: { readonly label: string; readonly value: number; readonly min: number; readonly disabled: boolean; readonly onChange: (value: number) => void }) {
  return <label className="editor-field compact-field"><span>{label}</span><input disabled={disabled} min={min} onChange={(event) => onChange(event.target.valueAsNumber)} required type="number" value={value} /></label>;
}

const LOCATOR_TYPES = ["css", "xpath", "testId", "text", "label", "placeholder", "role"] as const satisfies readonly ElementLocator["type"][];

function createLocator(type: ElementLocator["type"]): ElementLocator {
  if (type === "role") return { type, role: "button", name: "", exact: true };
  if (type === "text" || type === "label" || type === "placeholder") return { type, value: "", exact: true };
  return { type, value: "" };
}

function defaultTarget(): ElementTarget { return { primary: { type: "css", value: "body" }, fallbacks: [] }; }

function createWaitCondition(type: WaitCondition["type"]): WaitCondition {
  switch (type) {
    case "timeout": return { type, durationMs: 1_000 };
    case "element": return { type, state: "visible", target: defaultTarget() };
    case "url": return { type, match: "contains", value: "https://" };
    case "pageLoad": return { type, state: "domcontentloaded" };
  }
}

function withOptionalNumber(step: AutomationStep, key: "timeoutMs" | "postActionDelayMs", value: number | undefined): AutomationStep {
  if (value === undefined) return withoutProperty(step, key) as AutomationStep;
  return { ...step, [key]: value };
}

function withoutProperty<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const clone = { ...value };
  delete clone[key];
  return clone;
}

function stepTypeLabel(type: AutomationStep["type"]): string {
  return ({ click: "Click", input: "Input text", select: "Select option", check: "Check", uncheck: "Uncheck", pressKey: "Press key", wait: "Wait", reload: "Reload page", customCode: "Custom JavaScript" })[type];
}

function locatorTypeLabel(type: ElementLocator["type"]): string {
  return ({ css: "CSS", xpath: "XPath", testId: "Test ID", text: "Text", label: "Label", placeholder: "Placeholder", role: "ARIA role" })[type];
}

function locatorValueLabel(type: Exclude<ElementLocator["type"], "role">): string {
  return ({ css: "CSS selector", xpath: "XPath", testId: "Test ID", text: "Text", label: "Label", placeholder: "Placeholder" })[type];
}
