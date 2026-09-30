import type {
  AutomationRuntimeErrorDetails,
  AutomationRuntimeMessage
} from "../types/automation-runtime";

export function createRuntimeErrorDetails(
  action: AutomationRuntimeMessage["action"],
  error: unknown
): AutomationRuntimeErrorDetails {
  if (!(error instanceof Error)) {
    return {
      action,
      name: "UnknownError",
      message: String(error)
    };
  }

  const candidate = error as Error & {
    readonly code?: unknown;
  };
  const cause = describeCause(error.cause);
  const data = safeSerialize(readDiagnosticData(candidate));

  return {
    action,
    name: error.name,
    message: redactDiagnosticText(error.message),
    ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
    ...(cause === undefined ? {} : { cause }),
    ...(data === undefined ? {} : { data }),
    ...(error.stack === undefined
      ? {}
      : { stack: redactDiagnosticText(error.stack).slice(0, 8_000) })
  };
}

function readDiagnosticData(error: Error): Record<string, unknown> | undefined {
  const entries = Object.entries(error).filter(
    ([key]) => key !== "name" && key !== "message" && key !== "stack"
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

export function formatRuntimeErrorDetails(
  details: AutomationRuntimeErrorDetails
): string {
  return [
    `Action: ${details.action}`,
    `Error: ${details.name}: ${details.message}`,
    ...(details.code === undefined ? [] : [`Code: ${details.code}`]),
    ...(details.cause === undefined ? [] : [`Cause: ${details.cause}`]),
    ...(details.data === undefined ? [] : [`Data: ${details.data}`]),
    ...(details.stack === undefined ? [] : [`Stack:\n${details.stack}`])
  ].join("\n");
}

function describeCause(cause: unknown): string | undefined {
  if (cause === undefined) {
    return undefined;
  }
  return cause instanceof Error
    ? `${cause.name}: ${redactDiagnosticText(cause.message)}`
    : redactDiagnosticText(String(cause));
}

function safeSerialize(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return redactDiagnosticText(JSON.stringify(value)).slice(0, 4_000);
  } catch {
    return "[unserializable diagnostic data]";
  }
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s)\]}]*/gi, "$1?[REDACTED]")
    .replace(
      /((?:password|passwd|pwd|token|access_token|refresh_token|authorization|cookie|set-cookie)["']?\s*[:=]\s*["']?)[^\s,"';}&]+/gi,
      "$1[REDACTED]"
    );
}
