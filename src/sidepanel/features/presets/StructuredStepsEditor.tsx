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
import { Alert, Badge, Button, Checkbox, Icon, Select } from "../../components";
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
  const [expandedStepIds, setExpandedStepIds] = useState<ReadonlySet<string>>(
    () => new Set(steps[0] === undefined ? [] : [steps[0].id])
  );

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

  const addStep = () => {
    const step = createStepTemplate(newStepType);
    setExpandedStepIds((current) => new Set([...current, step.id]));
    onChange([...structuredClone(steps), step]);
  };

  const duplicateStep = (index: number) => {
    const duplicate = duplicateAutomationStep(steps[index]);
    const updated = structuredClone(steps) as AutomationStep[];
    updated.splice(index + 1, 0, duplicate);
    setExpandedStepIds((current) => new Set([...current, duplicate.id]));
    onChange(updated);
  };

  return (
    <div className="structured-steps-editor">
      <div className="step-toolbar">
        <Select
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
        </Select>
        <Button
          disabled={disabled}
          onClick={addStep}
          size="small"
          variant="secondary"
        >
          <Icon name="add" />
          Add step
        </Button>
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
              <li key={step.id}>
                <details
                  className={`structured-step-card${stepIssues.length > 0 ? " has-errors" : ""}`}
                  onToggle={(event) => {
                    const open = event.currentTarget.open;
                    setExpandedStepIds((current) => {
                      const updated = new Set(current);
                      if (open) updated.add(step.id);
                      else updated.delete(step.id);
                      return updated;
                    });
                  }}
                  open={expandedStepIds.has(step.id)}
                >
                  <summary className="structured-step-header">
                    <span>{index + 1}</span>
                    <div className="structured-step-title">
                      <strong>{step.name || stepTypeLabel(step.type)}</strong>
                      <small>{step.id}</small>
                    </div>
                    <div className="structured-step-badges">
                      <Badge tone="info">{stepTypeLabel(step.type)}</Badge>
                      <Badge tone={step.enabled ? "success" : "neutral"}>
                        {step.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                      {stepIssues.length > 0 && (
                        <Badge tone="error">
                          {stepIssues.length} {stepIssues.length === 1 ? "issue" : "issues"}
                        </Badge>
                      )}
                    </div>
                  </summary>

                  <div className="structured-step-body">
                    <Checkbox
                      checked={step.enabled}
                      disabled={disabled}
                      label="Step enabled"
                      onChange={(event) =>
                        updateStep(index, (current) => ({
                          ...current,
                          enabled: event.target.checked
                        }))
                      }
                    />

                    <CommonStepFields
                      disabled={disabled}
                      issues={stepIssues}
                      onChange={(updated) => updateStep(index, () => updated)}
                      path={`/automation/steps/${index}`}
                      step={step}
                    />
                    <ActionFields
                      disabled={disabled}
                      issues={stepIssues}
                      onChange={(updated) => updateStep(index, () => updated)}
                      path={`/automation/steps/${index}`}
                      step={step}
                    />

                    {stepIssues.length > 0 && (
                      <div className="step-validation-summary" role="alert">
                        Review the highlighted fields in this step.
                      </div>
                    )}

                    <div className="step-order-actions structured-step-actions">
                      <button
                        aria-label={`Move step ${index + 1} up`}
                        disabled={disabled || index === 0}
                        onClick={() => moveStep(index, -1)}
                        type="button"
                      >
                        <Icon name="up" /> Up
                      </button>
                      <button
                        aria-label={`Duplicate step ${index + 1}`}
                        disabled={disabled}
                        onClick={() => duplicateStep(index)}
                        type="button"
                      >
                        <Icon name="duplicate" /> Duplicate
                      </button>
                      <button
                        aria-label={`Move step ${index + 1} down`}
                        disabled={disabled || index === steps.length - 1}
                        onClick={() => moveStep(index, 1)}
                        type="button"
                      >
                        <Icon name="down" /> Down
                      </button>
                      <button
                        aria-label={`Delete step ${index + 1}`}
                        className="danger-text"
                        disabled={disabled}
                        onClick={() => removeStep(index)}
                        type="button"
                      >
                        <Icon name="delete" /> Delete
                      </button>
                    </div>
                  </div>
                </details>
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
  path,
  issues,
  disabled,
  onChange
}: {
  readonly step: AutomationStep;
  readonly path: string;
  readonly issues: readonly PresetValidationIssue[];
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
        <FieldIssues issues={issues} path={`${path}/name`} />
      </label>
      <div className="optional-number-grid">
        <OptionalNumberField
          disabled={disabled}
          issues={issues}
          label="Timeout override, ms"
          min={1}
          onChange={(value) => onChange(withOptionalNumber(step, "timeoutMs", value))}
          path={`${path}/timeoutMs`}
          value={step.timeoutMs}
        />
        <OptionalNumberField
          disabled={disabled}
          issues={issues}
          label="Post-action delay, ms"
          min={0}
          onChange={(value) =>
            onChange(withOptionalNumber(step, "postActionDelayMs", value))
          }
          path={`${path}/postActionDelayMs`}
          value={step.postActionDelayMs}
        />
      </div>
    </>
  );
}

function ActionFields({
  step,
  path,
  issues,
  disabled,
  onChange
}: {
  readonly step: AutomationStep;
  readonly path: string;
  readonly issues: readonly PresetValidationIssue[];
  readonly disabled: boolean;
  readonly onChange: (step: AutomationStep) => void;
}) {
  switch (step.type) {
    case "click":
      return (
        <>
          <TargetEditor
            disabled={disabled}
            issues={issues}
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
              <FieldIssues issues={issues} path={`${path}/button`} />
            </label>
            <NumberInput
              disabled={disabled}
              issues={issues}
              label="Click count"
              min={1}
              onChange={(clickCount) => onChange({ ...step, clickCount })}
              path={`${path}/clickCount`}
              value={step.clickCount}
            />
          </div>
        </>
      );
    case "input":
      return <InputFields disabled={disabled} issues={issues} onChange={onChange} path={path} step={step} />;
    case "select":
      return <SelectFields disabled={disabled} issues={issues} onChange={onChange} path={path} step={step} />;
    case "check":
    case "uncheck":
      return (
        <TargetEditor
          disabled={disabled}
          issues={issues}
          onChange={(target) => onChange({ ...step, target })}
          path={`${path}/target`}
          target={step.target}
        />
      );
    case "pressKey":
      return <PressKeyFields disabled={disabled} issues={issues} onChange={onChange} path={path} step={step} />;
    case "wait":
      return <WaitFields disabled={disabled} issues={issues} onChange={onChange} path={path} step={step} />;
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
          <FieldIssues issues={issues} path={`${path}/waitUntil`} />
        </label>
      );
    case "customCode":
      return (
        <>
          <Alert tone="warning">
            Custom JavaScript runs with access to the current page. Add and run
            only code you trust. Do not include passwords, cookies or tokens.
          </Alert>
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
            <FieldIssues issues={issues} path={`${path}/source`} />
          </label>
        </>
      );
  }
}

function InputFields({ step, path, issues, disabled, onChange }: {
  readonly step: InputStep;
  readonly path: string;
  readonly issues: readonly PresetValidationIssue[];
  readonly disabled: boolean;
  readonly onChange: (step: AutomationStep) => void;
}) {
  return (
    <>
      <TargetEditor disabled={disabled} issues={issues} onChange={(target) => onChange({ ...step, target })} path={`${path}/target`} target={step.target} />
      <label className="editor-field">
        <span>Input value</span>
        <textarea disabled={disabled} onChange={(event) => onChange({ ...step, value: event.target.value })} rows={3} value={step.value} />
        <FieldIssues issues={issues} path={`${path}/value`} />
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
          <FieldIssues issues={issues} path={`${path}/inputMode`} />
        </label>
        <label><input checked={step.humanInput !== undefined} disabled={disabled} onChange={(event) => onChange(event.target.checked ? { ...step, humanInput: { minDelayMs: 40, maxDelayMs: 120 } } : withoutProperty(step, "humanInput"))} type="checkbox" />Override human delays</label>
      </div>
      {step.humanInput !== undefined && (
        <div className="editor-number-grid">
          <NumberInput disabled={disabled} issues={issues} label="Min typing delay, ms" min={0} onChange={(minDelayMs) => onChange({ ...step, humanInput: { ...step.humanInput!, minDelayMs } })} path={`${path}/humanInput/minDelayMs`} value={step.humanInput.minDelayMs} />
          <NumberInput disabled={disabled} issues={issues} label="Max typing delay, ms" min={0} onChange={(maxDelayMs) => onChange({ ...step, humanInput: { ...step.humanInput!, maxDelayMs } })} path={`${path}/humanInput/maxDelayMs`} value={step.humanInput.maxDelayMs} />
        </div>
      )}
    </>
  );
}

function SelectFields({ step, path, issues, disabled, onChange }: {
  readonly step: SelectStep;
  readonly path: string;
  readonly issues: readonly PresetValidationIssue[];
  readonly disabled: boolean;
  readonly onChange: (step: AutomationStep) => void;
}) {
  return (
    <>
      <TargetEditor disabled={disabled} issues={issues} onChange={(target) => onChange({ ...step, target })} path={`${path}/target`} target={step.target} />
      <div className="editor-number-grid">
        <label className="editor-field">
          <span>Selection method</span>
          <select disabled={disabled} onChange={(event) => {
            const by = event.target.value as SelectStep["option"]["by"];
            onChange({ ...step, option: by === "index" ? { by, value: 0 } : by === "attribute" ? { by, attribute: "data-name", value: "" } : { by, value: "" } });
          }} value={step.option.by}>
            <option value="value">Value</option><option value="label">Visible label</option><option value="index">Index</option><option value="attribute">Custom attribute</option>
          </select>
          <FieldIssues issues={issues} path={`${path}/option/by`} />
        </label>
        <NumberOrTextOption disabled={disabled} issues={issues} onChange={onChange} path={`${path}/option/value`} step={step} />
        {step.option.by === "attribute" && <label className="editor-field">
          <span>Option attribute</span>
          <input disabled={disabled} value={step.option.attribute} placeholder="data-name" onChange={(event) => {
            if (step.option.by === "attribute") onChange({ ...step, option: { ...step.option, attribute: event.target.value } });
          }} />
          <FieldIssues issues={issues} path={`${path}/option/attribute`} />
        </label>}
      </div>
    </>
  );
}

function NumberOrTextOption({ step, path, issues, disabled, onChange }: { readonly step: SelectStep; readonly path: string; readonly issues: readonly PresetValidationIssue[]; readonly disabled: boolean; readonly onChange: (step: AutomationStep) => void }) {
  const label = step.option.by === "index" ? "Option index" : step.option.by === "label" ? "Option label" : "Option value";
  return (
    <label className="editor-field"><span>{label}</span><input disabled={disabled} min={step.option.by === "index" ? 0 : undefined} onChange={(event) => onChange({ ...step, option: step.option.by === "index" ? { by: "index", value: event.target.valueAsNumber } : { ...step.option, value: event.target.value } })} type={step.option.by === "index" ? "number" : "text"} value={step.option.value} /><FieldIssues issues={issues} path={path} /></label>
  );
}

function PressKeyFields({ step, path, issues, disabled, onChange }: { readonly step: PressKeyStep; readonly path: string; readonly issues: readonly PresetValidationIssue[]; readonly disabled: boolean; readonly onChange: (step: AutomationStep) => void }) {
  return (
    <>
      <label className="editor-field"><span>Key or shortcut</span><input disabled={disabled} onChange={(event) => onChange({ ...step, key: event.target.value })} placeholder="Enter or Control+Enter" value={step.key} /><FieldIssues issues={issues} path={`${path}/key`} /></label>
      <label className="editor-checkbox-field"><input checked={step.target !== undefined} disabled={disabled} onChange={(event) => onChange(event.target.checked ? { ...step, target: defaultTarget() } : withoutProperty(step, "target"))} type="checkbox" />Target a specific element</label>
      {step.target !== undefined && <TargetEditor disabled={disabled} issues={issues} onChange={(target) => onChange({ ...step, target })} path={`${path}/target`} target={step.target} />}
    </>
  );
}

function WaitFields({ step, path, issues, disabled, onChange }: { readonly step: WaitStep; readonly path: string; readonly issues: readonly PresetValidationIssue[]; readonly disabled: boolean; readonly onChange: (step: AutomationStep) => void }) {
  const condition = step.condition;
  return (
    <>
      <label className="editor-field">
        <span>Wait condition</span>
        <select disabled={disabled} onChange={(event) => onChange({ ...step, condition: createWaitCondition(event.target.value as WaitCondition["type"]) })} value={condition.type}>
          <option value="timeout">Duration</option><option value="element">Element state</option><option value="url">URL</option><option value="pageLoad">Page load</option>
        </select>
        <FieldIssues issues={issues} path={`${path}/condition/type`} />
      </label>
      {condition.type === "timeout" && <NumberInput disabled={disabled} issues={issues} label="Duration, ms" min={0} onChange={(durationMs) => onChange({ ...step, condition: { type: "timeout", durationMs } })} path={`${path}/condition/durationMs`} value={condition.durationMs} />}
      {condition.type === "element" && (
        <><label className="editor-field"><span>Element state</span><select disabled={disabled} onChange={(event) => onChange({ ...step, condition: { ...condition, state: event.target.value as typeof condition.state } })} value={condition.state}><option value="attached">Attached</option><option value="detached">Detached</option><option value="visible">Visible</option><option value="hidden">Hidden</option></select><FieldIssues issues={issues} path={`${path}/condition/state`} /></label><TargetEditor disabled={disabled} issues={issues} onChange={(target) => onChange({ ...step, condition: { ...condition, target } })} path={`${path}/condition/target`} target={condition.target} /></>
      )}
      {condition.type === "url" && <div className="editor-number-grid"><label className="editor-field"><span>URL match</span><select disabled={disabled} onChange={(event) => onChange({ ...step, condition: { ...condition, match: event.target.value as typeof condition.match } })} value={condition.match}><option value="exact">Exact</option><option value="contains">Contains</option><option value="regex">Regular expression</option></select><FieldIssues issues={issues} path={`${path}/condition/match`} /></label><label className="editor-field"><span>URL value</span><input disabled={disabled} onChange={(event) => onChange({ ...step, condition: { ...condition, value: event.target.value } })} value={condition.value} /><FieldIssues issues={issues} path={`${path}/condition/value`} /></label></div>}
      {condition.type === "pageLoad" && <label className="editor-field"><span>Load state</span><select disabled={disabled} onChange={(event) => onChange({ ...step, condition: { type: "pageLoad", state: event.target.value as typeof condition.state } })} value={condition.state}><option value="domcontentloaded">DOM content loaded</option><option value="load">Page loaded</option><option value="networkidle">Network idle</option></select><FieldIssues issues={issues} path={`${path}/condition/state`} /></label>}
    </>
  );
}

function TargetEditor({ target, path, issues, disabled, onChange }: { readonly target: ElementTarget; readonly path: string; readonly issues: readonly PresetValidationIssue[]; readonly disabled: boolean; readonly onChange: (target: ElementTarget) => void }) {
  return (
    <fieldset className="target-editor">
      <legend>Target locators</legend>
      <LocatorEditor disabled={disabled} issues={issues} label="Primary locator" locator={target.primary} onChange={(primary) => onChange({ ...target, primary })} path={`${path}/primary`} />
      {target.fallbacks.map((locator, index) => (
        <div className="fallback-locator" key={`${index}-${locator.type}`}>
          <LocatorEditor disabled={disabled} issues={issues} label={`Fallback ${index + 1}`} locator={locator} onChange={(updated) => onChange({ ...target, fallbacks: target.fallbacks.map((current, fallbackIndex) => fallbackIndex === index ? updated : current) })} path={`${path}/fallbacks/${index}`} />
          <button className="danger-text locator-remove-button" disabled={disabled} onClick={() => onChange({ ...target, fallbacks: target.fallbacks.filter((_, fallbackIndex) => fallbackIndex !== index) })} type="button">Remove fallback</button>
        </div>
      ))}
      <Button className="add-fallback-button" disabled={disabled} onClick={() => onChange({ ...target, fallbacks: [...target.fallbacks, { type: "css", value: "body" }] })} size="small" variant="secondary"><Icon name="add" /> Add fallback locator</Button>
    </fieldset>
  );
}

function LocatorEditor({ locator, label, path, issues, disabled, onChange }: { readonly locator: ElementLocator; readonly label: string; readonly path: string; readonly issues: readonly PresetValidationIssue[]; readonly disabled: boolean; readonly onChange: (locator: ElementLocator) => void }) {
  return (
    <div className="locator-fields" data-path={path}>
      <strong>{label}</strong>
      <label className="editor-field"><span>Locator type</span><select aria-label={`${label} type`} disabled={disabled} onChange={(event) => onChange(createLocator(event.target.value as ElementLocator["type"]))} value={locator.type}>{LOCATOR_TYPES.map((type) => <option key={type} value={type}>{locatorTypeLabel(type)}</option>)}</select><FieldIssues issues={issues} path={`${path}/type`} /></label>
      {locator.type === "role" ? (
        <><label className="editor-field"><span>ARIA role</span><input disabled={disabled} onChange={(event) => onChange({ ...locator, role: event.target.value })} value={locator.role} /><FieldIssues issues={issues} path={`${path}/role`} /></label><label className="editor-field"><span>Accessible name</span><input disabled={disabled} onChange={(event) => onChange({ ...locator, name: event.target.value })} value={locator.name} /><FieldIssues issues={issues} path={`${path}/name`} /></label><ExactField disabled={disabled} exact={locator.exact} onChange={(exact) => onChange({ ...locator, exact })} /></>
      ) : (
        <><label className="editor-field"><span>{locatorValueLabel(locator.type)}</span><input disabled={disabled} onChange={(event) => onChange({ ...locator, value: event.target.value })} spellCheck={false} value={locator.value} /><FieldIssues issues={issues} path={`${path}/value`} /></label>{"exact" in locator && <ExactField disabled={disabled} exact={locator.exact} onChange={(exact) => onChange({ ...locator, exact })} />}</>
      )}
    </div>
  );
}

function ExactField({ exact, disabled, onChange }: { readonly exact: boolean; readonly disabled: boolean; readonly onChange: (exact: boolean) => void }) {
  return <label className="editor-checkbox-field"><input checked={exact} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />Exact match</label>;
}

function OptionalNumberField({ label, value, path, issues, min, disabled, onChange }: { readonly label: string; readonly value?: number; readonly path: string; readonly issues: readonly PresetValidationIssue[]; readonly min: number; readonly disabled: boolean; readonly onChange: (value: number | undefined) => void }) {
  const enabled = value !== undefined;
  return (
    <div className="optional-number-field"><label className="editor-checkbox-field"><input checked={enabled} disabled={disabled} onChange={(event) => onChange(event.target.checked ? min : undefined)} type="checkbox" />{label}</label>{enabled && <input aria-label={label} disabled={disabled} min={min} onChange={(event) => onChange(event.target.valueAsNumber)} type="number" value={value} />}<FieldIssues issues={issues} path={path} /></div>
  );
}

function NumberInput({ label, value, path, issues, min, disabled, onChange }: { readonly label: string; readonly value: number; readonly path: string; readonly issues: readonly PresetValidationIssue[]; readonly min: number; readonly disabled: boolean; readonly onChange: (value: number) => void }) {
  return <label className="editor-field compact-field"><span>{label}</span><input disabled={disabled} min={min} onChange={(event) => onChange(event.target.valueAsNumber)} required type="number" value={value} /><FieldIssues issues={issues} path={path} /></label>;
}

function FieldIssues({ issues, path }: { readonly issues: readonly PresetValidationIssue[]; readonly path: string }) {
  const matches = issues.filter((issue) => issue.path === path);
  if (matches.length === 0) return null;
  return (
    <span
      aria-live="polite"
      className="field-error"
      data-error-path={path}
      id={`step-field-error-${path.replaceAll(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`}
      role="alert"
    >
      {matches.map((issue) => issue.message).join(" ")}
    </span>
  );
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

export function duplicateAutomationStep(
  step: AutomationStep,
  createId: () => string = () => `step-${crypto.randomUUID()}`
): AutomationStep {
  return { ...structuredClone(step), id: createId() };
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
