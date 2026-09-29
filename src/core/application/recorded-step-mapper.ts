import type {
  AutomationStep,
  CheckStep,
  ClickStep,
  ElementLocator,
  ElementTarget,
  InputStep,
  MouseButton,
  PressKeyStep,
  ReloadStep,
  SelectOption,
  SelectStep,
  UncheckStep
} from "../domain/automation-step";
import {
  type PresetValidationIssue,
  validatePreset
} from "../domain/preset-validator";

export type RecordedEventSkipReason =
  | "invalid-event"
  | "unsupported-event-kind"
  | "unsupported-click-modifiers"
  | "duplicate-control-click"
  | "duplicate-navigation"
  | "invalid-generated-step";

export interface SkippedRecordedEvent {
  readonly eventId?: string;
  readonly kind?: string;
  readonly reason: RecordedEventSkipReason;
}

export interface RecordedStepMappingResult {
  readonly steps: readonly AutomationStep[];
  readonly skipped: readonly SkippedRecordedEvent[];
}

export interface RecordedStepMapperOptions {
  readonly createStepId?: (event: RecordedStepSourceEvent) => string;
}

export interface RecordedStepSourceEvent {
  readonly eventId: string;
  readonly kind:
    | "click"
    | "input"
    | "select"
    | "check"
    | "uncheck"
    | "pressKey"
    | "reload";
  readonly sessionId: string;
  readonly tabId: number;
  readonly documentId: string;
  readonly occurredAt: string;
  readonly url: string;
}

interface RecorderEventBaseValue {
  readonly version: 1;
  readonly eventId: string;
  readonly sessionId: string;
  readonly tabId: number;
  readonly documentId: string;
  readonly occurredAt: string;
  readonly url: string;
  readonly kind: string;
  readonly [key: string]: unknown;
}

export class RecordedStepMappingError extends Error {
  readonly issues: readonly PresetValidationIssue[];

  constructor(issues: readonly PresetValidationIssue[]) {
    super("Recorded steps did not produce a valid preset v1 automation.");
    this.name = "RecordedStepMappingError";
    this.issues = Object.freeze(issues.map((issue) => ({ ...issue })));
  }
}

/** Converts the accepted recorder-event order into portable preset-v1 steps. */
export class RecordedStepMapper {
  readonly #createStepId: (event: RecordedStepSourceEvent) => string;

  constructor(options: RecordedStepMapperOptions = {}) {
    this.#createStepId =
      options.createStepId ?? (() => `step-${crypto.randomUUID()}`);
  }

  map(events: readonly unknown[]): RecordedStepMappingResult {
    const steps: AutomationStep[] = [];
    const skipped: SkippedRecordedEvent[] = [];
    const usedStepIds = new Set<string>();
    const recordedReloads = new Set<string>();
    let previousInput:
      | { readonly key: string; readonly stepIndex: number }
      | undefined;
    let previousClick:
      | {
          readonly stepIndex: number;
          readonly targetKey: string;
          readonly event: Omit<SkippedRecordedEvent, "reason">;
        }
      | undefined;

    for (const value of events) {
      const eventSummary = summarizeEvent(value);
      if (!isRecorderEventBase(value)) {
        skipped.push({ ...eventSummary, reason: "invalid-event" });
        previousInput = undefined;
        previousClick = undefined;
        continue;
      }

      if (value.kind === "pageReady") {
        skipped.push({ ...eventSummary, reason: "unsupported-event-kind" });
        previousInput = undefined;
        previousClick = undefined;
        continue;
      }
      if (value.kind === "reload") {
        previousInput = undefined;
        previousClick = undefined;
        const reload = mapReloadEvent(value.payload);
        if (reload === undefined) {
          skipped.push({ ...eventSummary, reason: "invalid-event" });
          continue;
        }
        const reloadKey = `${value.sessionId}\u0000${reload.navigationId}`;
        if (recordedReloads.has(reloadKey)) {
          skipped.push({ ...eventSummary, reason: "duplicate-navigation" });
          continue;
        }
        recordedReloads.add(reloadKey);
        const step: ReloadStep = {
          id: this.#uniqueStepId(
            toStepSourceEvent(value, "reload"),
            usedStepIds
          ),
          type: "reload",
          enabled: true,
          waitUntil: reload.waitUntil
        };
        if (!isValidStep(step)) {
          skipped.push({ ...eventSummary, reason: "invalid-generated-step" });
          continue;
        }
        steps.push(step);
        continue;
      }
      if (!isMappableActionKind(value.kind)) {
        skipped.push({ ...eventSummary, reason: "unsupported-event-kind" });
        previousInput = undefined;
        previousClick = undefined;
        continue;
      }

      const target = normalizeTarget(value.target);
      if (target === undefined || !isObject(value.payload)) {
        skipped.push({ ...eventSummary, reason: "invalid-event" });
        previousInput = undefined;
        previousClick = undefined;
        continue;
      }

      if (value.kind === "click") {
        previousInput = undefined;
        const click = mapClickEvent(value.payload, target);
        if (click === "unsupported-modifiers") {
          skipped.push({
            ...eventSummary,
            reason: "unsupported-click-modifiers"
          });
          previousClick = undefined;
          continue;
        }
        if (click === undefined) {
          skipped.push({ ...eventSummary, reason: "invalid-event" });
          previousClick = undefined;
          continue;
        }
        const step: ClickStep = {
          ...click,
          id: this.#uniqueStepId(toStepSourceEvent(value, "click"), usedStepIds)
        };
        if (!isValidStep(step)) {
          skipped.push({ ...eventSummary, reason: "invalid-generated-step" });
          previousClick = undefined;
          continue;
        }
        steps.push(step);
        previousClick = {
          stepIndex: steps.length - 1,
          targetKey: targetKey(target),
          event: eventSummary
        };
        continue;
      }

      if (value.kind !== "input") {
        previousInput = undefined;
        const mapped = mapAdvancedEvent(value.kind, value.payload, target);
        if (mapped === undefined) {
          skipped.push({ ...eventSummary, reason: "invalid-event" });
          previousClick = undefined;
          continue;
        }
        if (value.kind === "check" || value.kind === "uncheck") {
          removeDuplicateControlClick(
            steps,
            usedStepIds,
            skipped,
            previousClick,
            target
          );
        }
        previousClick = undefined;
        const step: AutomationStep = {
          ...mapped,
          id: this.#uniqueStepId(
            toStepSourceEvent(value, value.kind),
            usedStepIds
          )
        };
        if (!isValidStep(step)) {
          skipped.push({ ...eventSummary, reason: "invalid-generated-step" });
          continue;
        }
        steps.push(step);
        continue;
      }

      previousClick = undefined;

      const input = mapInputEvent(value.payload, target);
      if (input === undefined) {
        skipped.push({ ...eventSummary, reason: "invalid-event" });
        previousInput = undefined;
        continue;
      }

      const inputKey = recorderInputKey(value, target);
      if (previousInput?.key === inputKey) {
        const previousStep = steps[previousInput.stepIndex];
        if (previousStep?.type === "input") {
          const updated: InputStep = { ...previousStep, value: input.value };
          if (isValidStep(updated)) {
            steps[previousInput.stepIndex] = updated;
            continue;
          }
        }
      }

      const step: InputStep = {
        ...input,
        id: this.#uniqueStepId(toStepSourceEvent(value, "input"), usedStepIds)
      };
      if (!isValidStep(step)) {
        skipped.push({ ...eventSummary, reason: "invalid-generated-step" });
        previousInput = undefined;
        continue;
      }
      steps.push(step);
      previousInput = { key: inputKey, stepIndex: steps.length - 1 };
    }

    const issues = validateSteps(steps);
    if (issues.length > 0) {
      throw new RecordedStepMappingError(issues);
    }

    return Object.freeze({
      steps: Object.freeze(structuredClone(steps)),
      skipped: Object.freeze(skipped.map((event) => Object.freeze({ ...event })))
    });
  }

  #uniqueStepId(event: RecordedStepSourceEvent, used: Set<string>): string {
    const proposed = this.#createStepId(event).trim();
    const base = proposed.length > 0 ? proposed : "recorded-step";
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  }
}

function mapClickEvent(
  payload: Record<string, unknown>,
  target: ElementTarget
): Omit<ClickStep, "id"> | "unsupported-modifiers" | undefined {
  const { button, clickCount, modifiers } = payload;
  if (
    !isMouseButton(button) ||
    typeof clickCount !== "number" ||
    !Number.isInteger(clickCount) ||
    clickCount < 1 ||
    !Array.isArray(modifiers)
  ) {
    return undefined;
  }
  if (modifiers.length > 0) {
    return "unsupported-modifiers";
  }
  return { type: "click", enabled: true, target, button, clickCount };
}

function mapInputEvent(
  payload: Record<string, unknown>,
  target: ElementTarget
): Omit<InputStep, "id"> | undefined {
  if (
    typeof payload.value !== "string" ||
    !isRecorderInputType(payload.inputType)
  ) {
    return undefined;
  }
  return {
    type: "input",
    enabled: true,
    target,
    value: payload.value,
    clearFirst: true,
    inputMode: "default"
  };
}

function mapAdvancedEvent(
  kind: "select" | "check" | "uncheck" | "pressKey",
  payload: Record<string, unknown>,
  target: ElementTarget
):
  | Omit<SelectStep, "id">
  | Omit<CheckStep, "id">
  | Omit<UncheckStep, "id">
  | Omit<PressKeyStep, "id">
  | undefined {
  switch (kind) {
    case "select": {
      const option = normalizeSelectOption(payload.option);
      return option === undefined
        ? undefined
        : { type: "select", enabled: true, target, option };
    }
    case "check":
      return (payload.control === "checkbox" || payload.control === "radio") &&
        payload.checked === true
        ? { type: "check", enabled: true, target }
        : undefined;
    case "uncheck":
      return payload.control === "checkbox" && payload.checked === false
        ? { type: "uncheck", enabled: true, target }
        : undefined;
    case "pressKey":
      return isNonEmptyString(payload.key)
        ? { type: "pressKey", enabled: true, target, key: payload.key }
        : undefined;
  }
}

function normalizeSelectOption(value: unknown): SelectOption | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  if (
    (value.by === "value" || value.by === "label") &&
    typeof value.value === "string"
  ) {
    return { by: value.by, value: value.value };
  }
  if (
    value.by === "index" &&
    Number.isInteger(value.value) &&
    (value.value as number) >= 0
  ) {
    return { by: "index", value: value.value as number };
  }
  return undefined;
}

function mapReloadEvent(
  payload: unknown
):
  | {
      readonly navigationId: string;
      readonly waitUntil: "domcontentloaded" | "load";
    }
  | undefined {
  if (
    !isObject(payload) ||
    !isNonEmptyString(payload.navigationId) ||
    (payload.waitUntil !== "domcontentloaded" && payload.waitUntil !== "load")
  ) {
    return undefined;
  }
  return {
    navigationId: payload.navigationId,
    waitUntil: payload.waitUntil
  };
}

function toStepSourceEvent(
  event: RecorderEventBaseValue,
  kind: RecordedStepSourceEvent["kind"]
): RecordedStepSourceEvent {
  return {
    eventId: event.eventId,
    kind,
    sessionId: event.sessionId,
    tabId: event.tabId,
    documentId: event.documentId,
    occurredAt: event.occurredAt,
    url: event.url
  };
}

function isMappableActionKind(
  kind: string
): kind is Exclude<RecordedStepSourceEvent["kind"], "reload"> {
  return (
    kind === "click" ||
    kind === "input" ||
    kind === "select" ||
    kind === "check" ||
    kind === "uncheck" ||
    kind === "pressKey"
  );
}

function removeDuplicateControlClick(
  steps: AutomationStep[],
  usedStepIds: Set<string>,
  skipped: SkippedRecordedEvent[],
  previousClick: {
    readonly stepIndex: number;
    readonly targetKey: string;
    readonly event: Omit<SkippedRecordedEvent, "reason">;
  } | undefined,
  target: ElementTarget
): void {
  if (
    previousClick === undefined ||
    previousClick.stepIndex !== steps.length - 1 ||
    previousClick.targetKey !== targetKey(target)
  ) {
    return;
  }
  const duplicate = steps[previousClick.stepIndex];
  if (duplicate?.type !== "click") {
    return;
  }
  steps.splice(previousClick.stepIndex, 1);
  usedStepIds.delete(duplicate.id);
  skipped.push({
    ...previousClick.event,
    reason: "duplicate-control-click"
  });
}

function targetKey(target: ElementTarget): string {
  return JSON.stringify(target);
}

function normalizeTarget(value: unknown): ElementTarget | undefined {
  if (!isObject(value) || !Array.isArray(value.locators)) {
    return undefined;
  }
  const locators = value.locators
    .map(normalizeLocator)
    .filter((locator): locator is ElementLocator => locator !== undefined);
  if (locators.length !== value.locators.length || locators.length === 0) {
    return undefined;
  }

  const unique = new Map<string, ElementLocator>();
  for (const locator of locators) {
    unique.set(JSON.stringify(locator), locator);
  }
  const [primary, ...fallbacks] = [...unique.values()];
  return primary === undefined ? undefined : { primary, fallbacks };
}

function normalizeLocator(value: unknown): ElementLocator | undefined {
  if (!isObject(value) || typeof value.type !== "string") {
    return undefined;
  }
  if (
    value.type === "css" ||
    value.type === "xpath" ||
    value.type === "testId"
  ) {
    return isNonEmptyString(value.value)
      ? { type: value.type, value: value.value }
      : undefined;
  }
  if (
    value.type === "text" ||
    value.type === "label" ||
    value.type === "placeholder"
  ) {
    return isNonEmptyString(value.value) && typeof value.exact === "boolean"
      ? { type: value.type, value: value.value, exact: value.exact }
      : undefined;
  }
  if (value.type === "role") {
    return isNonEmptyString(value.role) &&
      isNonEmptyString(value.name) &&
      typeof value.exact === "boolean"
      ? {
          type: "role",
          role: value.role,
          name: value.name,
          exact: value.exact
        }
      : undefined;
  }
  return undefined;
}

function isRecorderEventBase(value: unknown): value is RecorderEventBaseValue {
  return (
    isObject(value) &&
    value.version === 1 &&
    isNonEmptyString(value.eventId) &&
    isNonEmptyString(value.sessionId) &&
    Number.isInteger(value.tabId) &&
    (value.tabId as number) >= 0 &&
    isNonEmptyString(value.documentId) &&
    isNonEmptyString(value.occurredAt) &&
    isNonEmptyString(value.url) &&
    isNonEmptyString(value.kind)
  );
}

function summarizeEvent(value: unknown): {
  readonly eventId?: string;
  readonly kind?: string;
} {
  if (!isObject(value)) {
    return {};
  }
  return {
    ...(typeof value.eventId === "string" ? { eventId: value.eventId } : {}),
    ...(typeof value.kind === "string" ? { kind: value.kind } : {})
  };
}

function recorderInputKey(
  event: Record<string, unknown>,
  target: ElementTarget
): string {
  return JSON.stringify({
    sessionId: event.sessionId,
    documentId: event.documentId,
    target
  });
}

function isValidStep(step: AutomationStep): boolean {
  return validateSteps([step]).length === 0;
}

function validateSteps(
  steps: readonly AutomationStep[]
): PresetValidationIssue[] {
  return validatePreset({
    schemaVersion: 1,
    id: "00000000-0000-4000-8000-000000000000",
    name: "Recorded steps validation",
    createdAt: "2000-01-01T00:00:00.000Z",
    updatedAt: "2000-01-01T00:00:00.000Z",
    site: { hostname: "example.com", protocols: ["https"] },
    automation: {
      defaults: {
        timeoutMs: 1,
        postActionDelayMs: 0,
        humanInput: { enabled: false, minDelayMs: 0, maxDelayMs: 0 }
      },
      steps
    },
    siteSettings: {
      enabled: true,
      repeat: { enabled: false, intervalMinutes: 1 }
    }
  });
}

function isMouseButton(value: unknown): value is MouseButton {
  return value === "left" || value === "right" || value === "middle";
}

function isRecorderInputType(value: unknown): boolean {
  return (
    value === "text" ||
    value === "email" ||
    value === "search" ||
    value === "tel" ||
    value === "url" ||
    value === "number" ||
    value === "textarea" ||
    value === "contenteditable"
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
