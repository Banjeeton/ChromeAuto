import type { ErrorObject } from "ajv";
import generatedValidateSchema from "../../generated/preset-v1-validator";
import { isSupportedAutomationKey } from "./automation-key";
import type { PresetV1 } from "./preset";

type GeneratedSchemaValidator = ((value: unknown) => boolean) & {
  errors?: readonly ErrorObject[] | null;
};

const validateSchema = generatedValidateSchema as GeneratedSchemaValidator;

export type PresetSemanticIssueCode =
  | "duplicate_step_id"
  | "invalid_human_input_range"
  | "invalid_url_regex"
  | "invalid_press_key"
  | "empty_automation";

export type PresetValidationIssueCode =
  | PresetSemanticIssueCode
  | `schema_${string}`;

export interface PresetValidationIssue {
  code: PresetValidationIssueCode;
  path: string;
  message: string;
}

export type PresetSemanticIssue = PresetValidationIssue;

export class PresetValidationError extends Error {
  readonly issues: readonly PresetValidationIssue[];

  constructor(issues: readonly PresetValidationIssue[]) {
    const firstIssue = issues[0];
    super(
      firstIssue === undefined
        ? "Preset validation failed."
        : `Preset validation failed at ${firstIssue.path}: ${firstIssue.message}`
    );
    this.name = "PresetValidationError";
    this.issues = Object.freeze(issues.map((issue) => ({ ...issue })));
  }
}

/** Validates the portable JSON representation without applying business rules. */
export function validatePresetStructure(
  value: unknown
): PresetValidationIssue[] {
  if (validateSchema(value)) {
    return [];
  }

  return (validateSchema.errors ?? []).map(toSchemaIssue);
}

/**
 * Validates cross-field rules that cannot be expressed portably in JSON Schema.
 * The preset must pass preset-v1.schema.json before this function is called.
 */
export function validatePresetSemantics(
  preset: PresetV1
): PresetSemanticIssue[] {
  const issues: PresetSemanticIssue[] = [];
  const stepIds = new Set<string>();

  const humanInput = preset.automation.defaults.humanInput;
  if (humanInput.maxDelayMs < humanInput.minDelayMs) {
    issues.push({
      code: "invalid_human_input_range",
      path: "/automation/defaults/humanInput/maxDelayMs",
      message: "maxDelayMs must be greater than or equal to minDelayMs."
    });
  }

  preset.automation.steps.forEach((step, index) => {
    if (stepIds.has(step.id)) {
      issues.push({
        code: "duplicate_step_id",
        path: `/automation/steps/${index}/id`,
        message: `Step id "${step.id}" must be unique within the preset.`
      });
    }

    stepIds.add(step.id);

    if (
      step.type === "input" &&
      step.humanInput !== undefined &&
      step.humanInput.maxDelayMs < step.humanInput.minDelayMs
    ) {
      issues.push({
        code: "invalid_human_input_range",
        path: `/automation/steps/${index}/humanInput/maxDelayMs`,
        message: "maxDelayMs must be greater than or equal to minDelayMs."
      });
    }

    if (
      step.type === "wait" &&
      step.condition.type === "url" &&
      step.condition.match === "regex" &&
      !isValidRegularExpression(step.condition.value)
    ) {
      issues.push({
        code: "invalid_url_regex",
        path: `/automation/steps/${index}/condition/value`,
        message: "value must be a valid JavaScript regular expression."
      });
    }

    if (step.type === "pressKey" && !isSupportedAutomationKey(step.key)) {
      issues.push({
        code: "invalid_press_key",
        path: `/automation/steps/${index}/key`,
        message:
          "key must be a supported key or a combination using Control, Alt, Shift or Meta."
      });
    }
  });

  return issues;
}

function isValidRegularExpression(value: string): boolean {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

/** Applies JSON Schema first and semantic validation only to a valid shape. */
export function validatePreset(value: unknown): PresetValidationIssue[] {
  const structuralIssues = validatePresetStructure(value);
  if (structuralIssues.length > 0) {
    return structuralIssues;
  }

  return validatePresetSemantics(value as PresetV1);
}

/** Adds the run-only rule: an empty automation can be edited but not started. */
export function validatePresetForRun(
  value: unknown
): PresetValidationIssue[] {
  const issues = validatePreset(value);
  if (issues.length > 0) {
    return issues;
  }

  const preset = value as PresetV1;
  if (preset.automation.steps.length === 0) {
    issues.push({
      code: "empty_automation",
      path: "/automation/steps",
      message: "An automation must contain at least one step before it can run."
    });
  }

  return issues;
}

export function assertValidPreset(value: unknown): asserts value is PresetV1 {
  const issues = validatePreset(value);
  if (issues.length > 0) {
    throw new PresetValidationError(issues);
  }
}

export function assertRunnablePreset(value: unknown): asserts value is PresetV1 {
  const issues = validatePresetForRun(value);
  if (issues.length > 0) {
    throw new PresetValidationError(issues);
  }
}

function toSchemaIssue(error: ErrorObject): PresetValidationIssue {
  const property = schemaErrorProperty(error);
  const path = property === undefined
    ? error.instancePath || "/"
    : `${error.instancePath}/${escapeJsonPointer(property)}` || "/";

  return {
    code: `schema_${error.keyword}`,
    path,
    message: schemaErrorMessage(error, property)
  };
}

function schemaErrorProperty(error: ErrorObject): string | undefined {
  if (error.keyword === "required") {
    return (error.params as { missingProperty: string }).missingProperty;
  }
  if (error.keyword === "additionalProperties") {
    return (error.params as { additionalProperty: string }).additionalProperty;
  }
  return undefined;
}

function schemaErrorMessage(
  error: ErrorObject,
  property: string | undefined
): string {
  if (error.keyword === "required" && property !== undefined) {
    return `Required property "${property}" is missing.`;
  }
  if (error.keyword === "additionalProperties" && property !== undefined) {
    return `Property "${property}" is not allowed.`;
  }

  const detail = error.message ?? "does not match preset v1";
  return `Value ${detail}.`;
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
