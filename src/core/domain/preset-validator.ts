import type { PresetV1 } from "./preset";

export type PresetSemanticIssueCode =
  | "duplicate_step_id"
  | "invalid_human_input_range"
  | "empty_automation";

export interface PresetSemanticIssue {
  code: PresetSemanticIssueCode;
  path: string;
  message: string;
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
  });

  return issues;
}

/** Adds the run-only rule: an empty automation can be edited but not started. */
export function validatePresetForRun(
  preset: PresetV1
): PresetSemanticIssue[] {
  const issues = validatePresetSemantics(preset);

  if (preset.automation.steps.length === 0) {
    issues.push({
      code: "empty_automation",
      path: "/automation/steps",
      message: "An automation must contain at least one step before it can run."
    });
  }

  return issues;
}
