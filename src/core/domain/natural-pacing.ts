export interface NaturalPacingSettings {
  readonly enabled: boolean;
  readonly minimumDelaySeconds: number;
  readonly maximumDelaySeconds: number;
}

export const DEFAULT_NATURAL_PACING_SETTINGS: NaturalPacingSettings =
  Object.freeze({
    enabled: false,
    minimumDelaySeconds: 1,
    maximumDelaySeconds: 3
  });

export function validateNaturalPacingSettings(
  value: NaturalPacingSettings
): readonly string[] {
  const issues: string[] = [];
  if (typeof value.enabled !== "boolean") {
    issues.push("Enabled must be true or false.");
  }
  if (!Number.isFinite(value.minimumDelaySeconds)) {
    issues.push("Minimum delay must be a valid number.");
  } else if (value.minimumDelaySeconds < 0) {
    issues.push("Minimum delay cannot be negative.");
  }
  if (!Number.isFinite(value.maximumDelaySeconds)) {
    issues.push("Maximum delay must be a valid number.");
  } else if (value.maximumDelaySeconds < 0) {
    issues.push("Maximum delay cannot be negative.");
  }
  if (
    Number.isFinite(value.minimumDelaySeconds) &&
    Number.isFinite(value.maximumDelaySeconds) &&
    value.minimumDelaySeconds > value.maximumDelaySeconds
  ) {
    issues.push("Minimum delay cannot exceed maximum delay.");
  }
  return Object.freeze(issues);
}

export function randomNaturalPacingDelayMs(
  settings: NaturalPacingSettings,
  random: () => number = Math.random
): number {
  const issues = validateNaturalPacingSettings(settings);
  if (issues.length > 0) throw new Error(issues[0]);
  const minimum = Math.round(settings.minimumDelaySeconds * 1_000);
  const maximum = Math.round(settings.maximumDelaySeconds * 1_000);
  const sample = Math.min(1, Math.max(0, random()));
  return Math.min(
    maximum,
    minimum + Math.floor(sample * (maximum - minimum + 1))
  );
}
