import type { StepLogEntry } from "../../../core/domain/step-log-entry";

export function formatStepLogDetails(entry: StepLogEntry): string {
  const error = entry.error;
  if (error === undefined) {
    return `Step ${entry.stepNumber} (${entry.stepType}) completed without an error.`;
  }
  return [
    `Step: ${entry.stepNumber}`,
    `Type: ${entry.stepType}`,
    ...(entry.stepName === undefined ? [] : [`Name: ${entry.stepName}`]),
    `Action: ${error.action}`,
    `Reason: ${error.reason}`,
    `Code: ${error.code}`,
    ...(error.target === undefined
      ? []
      : [`Target:\n${JSON.stringify(error.target, null, 2)}`]),
    ...(error.selectOption === undefined
      ? []
      : [`Select option:\n${JSON.stringify(error.selectOption, null, 2)}`]),
    ...(error.key === undefined ? [] : [`Key: ${error.key}`]),
    ...(error.technicalDetails === undefined
      ? []
      : [`Details:\n${error.technicalDetails}`])
  ].join("\n");
}
