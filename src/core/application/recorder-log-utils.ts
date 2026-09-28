import { isRecorderError } from "../domain/recorder-error";
import type {
  RecorderLogEntry,
  RecorderLogTechnicalDetails
} from "../domain/recorder-log-entry";
import type { RecorderLog } from "../ports/recorder-log";

export interface RecorderLogContext {
  readonly log?: RecorderLog;
  readonly clock: () => string;
  readonly createLogId: () => string;
}

export async function appendRecorderLog(
  context: RecorderLogContext,
  entry: Omit<RecorderLogEntry, "id" | "recordedAt">
): Promise<void> {
  if (context.log === undefined) {
    return;
  }
  try {
    await context.log.append({
      ...entry,
      id: context.createLogId(),
      recordedAt: context.clock()
    });
  } catch {
    // Diagnostics must never change recorder behavior or damage its draft.
  }
}

export function recorderErrorDetails(
  error: unknown
): RecorderLogTechnicalDetails {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(isRecorderError(error) ? { code: error.code } : {}),
      ...(error.cause === undefined ? {} : { cause: describeCause(error.cause) }),
      ...(error.stack === undefined ? {} : { stack: error.stack })
    };
  }
  return { name: "UnknownError", message: String(error) };
}

function describeCause(cause: unknown): string {
  return cause instanceof Error
    ? `${cause.name}: ${cause.message}`
    : String(cause);
}
