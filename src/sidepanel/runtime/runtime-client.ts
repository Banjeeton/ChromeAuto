import type {
  AutomationRuntimeErrorDetails,
  AutomationRuntimeMessage,
  AutomationRuntimeResponse
} from "../../shared/types/automation-runtime";
import { formatRuntimeErrorDetails } from "../../shared/utils";

type RuntimeMessageSender = (
  message: AutomationRuntimeMessage
) => Promise<AutomationRuntimeResponse>;

export interface RuntimeMessageOptions {
  readonly timeoutMs?: number;
  readonly sender?: RuntimeMessageSender;
}

export class RuntimeRequestError extends Error {
  readonly details: AutomationRuntimeErrorDetails;

  constructor(message: string, details: AutomationRuntimeErrorDetails) {
    super(message);
    this.name = "RuntimeRequestError";
    this.details = details;
  }
}

export async function sendRuntimeMessage(
  message: AutomationRuntimeMessage,
  options: RuntimeMessageOptions = {}
): Promise<AutomationRuntimeResponse> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const sender =
    options.sender ??
    ((runtimeMessage) =>
      chrome.runtime.sendMessage(
        runtimeMessage
      ) as Promise<AutomationRuntimeResponse>);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Background did not respond to “${message.action}” within ${timeoutMs} ms. Reload the extension and try again.`
        )
      );
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([sender(message), timeout]);
    if (response === undefined) {
      throw new Error(
        `Background returned no response for “${message.action}”. Reload the extension and try again.`
      );
    }
    return response;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export function runtimeResponseError(
  response: Extract<AutomationRuntimeResponse, { readonly ok: false }>
): RuntimeRequestError {
  return new RuntimeRequestError(response.error, response.details);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorTechnicalDetails(error: unknown): string {
  if (error instanceof RuntimeRequestError) {
    return formatRuntimeErrorDetails(error.details);
  }
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}
