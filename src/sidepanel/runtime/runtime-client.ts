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
  readonly retryDelayMs?: number;
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
  const request = {
    ...message,
    requestId: message.requestId ?? crypto.randomUUID()
  } satisfies AutomationRuntimeMessage;
  const sender =
    options.sender ??
    ((runtimeMessage) =>
      chrome.runtime.sendMessage(
        runtimeMessage
      ) as Promise<AutomationRuntimeResponse>);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await sendWithTimeout(sender, request, timeoutMs);
    } catch (error) {
      if (attempt === 0 && isTransientWorkerDisconnect(error)) {
        await delay(options.retryDelayMs ?? 75);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Background request failed unexpectedly.");
}

async function sendWithTimeout(
  sender: RuntimeMessageSender,
  message: AutomationRuntimeMessage,
  timeoutMs: number
): Promise<AutomationRuntimeResponse> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(
      `Background did not respond to “${message.action}” within ${timeoutMs} ms. Reload the extension from chrome://extensions, reopen the side panel, and try again.`
    )), timeoutMs);
  });
  try {
    const response = await Promise.race([sender(message), timeout]);
    if (response === undefined) throw new Error(
      `Background returned no response for “${message.action}”. Reload the extension from chrome://extensions, reopen the side panel, and try again.`
    );
    return response;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function isTransientWorkerDisconnect(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection") ||
    message.includes("The message port closed") ||
    message.includes("Extension context invalidated")
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
