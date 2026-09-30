import type { Page } from "playwright-crx";

import type { CustomCodeStep } from "../../core/domain/automation-step";

export interface CustomJavaScriptOutput {
  readonly logs: readonly unknown[];
  readonly value: unknown;
}

interface SerializedPageError {
  readonly message: string;
  readonly name: string;
  readonly stack?: string;
}

type CustomJavaScriptEnvelope =
  | {
      readonly status: "completed";
      readonly logs: unknown[];
      readonly value: unknown;
    }
  | {
      readonly status: "failed";
      readonly logs: unknown[];
      readonly error: SerializedPageError;
    }
  | {
      readonly status: "stopped";
      readonly logs: unknown[];
      readonly reason: string;
    }
  | {
      readonly status: "timed-out";
      readonly logs: unknown[];
    };

export class CustomJavaScriptExecutionError extends Error {
  readonly logs: readonly unknown[];

  constructor(error: SerializedPageError, logs: readonly unknown[]) {
    const pageError = new Error(error.message);
    pageError.name = error.name;
    pageError.stack = error.stack;

    super(`Custom JavaScript failed: ${error.message}`, { cause: pageError });
    this.name = "CustomJavaScriptExecutionError";
    this.logs = Object.freeze([...logs]);
  }
}

export class CustomJavaScriptStopError extends Error {
  readonly reason: string;
  readonly logs: readonly unknown[];

  constructor(reason: string, logs: readonly unknown[]) {
    super(reason ? `Automation stopped: ${reason}` : "Automation stopped");
    this.name = "CustomJavaScriptStopError";
    this.reason = reason;
    this.logs = Object.freeze([...logs]);
  }
}

export class CustomJavaScriptTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly logs: readonly unknown[];

  constructor(timeoutMs: number, logs: readonly unknown[]) {
    super(`Custom JavaScript exceeded the ${timeoutMs} ms timeout`);
    this.name = "CustomJavaScriptTimeoutError";
    this.timeoutMs = timeoutMs;
    this.logs = Object.freeze([...logs]);
  }
}

export async function executeCustomJavaScript(
  page: Page,
  step: CustomCodeStep,
  timeoutMs: number
): Promise<CustomJavaScriptOutput> {
  const expression = buildCustomJavaScriptExpression(step, timeoutMs);
  const envelope = await page.evaluate<CustomJavaScriptEnvelope>(expression);

  switch (envelope.status) {
    case "completed":
      return {
        logs: Object.freeze([...envelope.logs]),
        value: envelope.value
      };
    case "failed":
      throw new CustomJavaScriptExecutionError(
        envelope.error,
        envelope.logs
      );
    case "stopped":
      throw new CustomJavaScriptStopError(envelope.reason, envelope.logs);
    case "timed-out":
      throw new CustomJavaScriptTimeoutError(timeoutMs, envelope.logs);
  }
}

function buildCustomJavaScriptExpression(
  step: CustomCodeStep,
  timeoutMs: number
): string {
  const sourceName = step.id.replace(/[^a-zA-Z0-9_-]/g, "_");

  return `(async () => {
  const __automationLogs = [];
  const __automationStopSignal = Symbol("automation.stop");
  const __automationTimeoutSignal = Symbol("automation.timeout");
  let __automationStopReason = "";
  let __automationTimer;

  const __automationSafeValue = (value) => {
    if (value === undefined) return null;
    try {
      const json = JSON.stringify(value);
      return json === undefined ? String(value) : JSON.parse(json);
    } catch {
      try { return String(value); }
      catch { return "[Unserializable value]"; }
    }
  };

  const __automationPasswordValues = () => {
    if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return [];
    return Array.from(document.querySelectorAll('input[type="password"]'))
      .map((input) => typeof input.value === "string" ? input.value : "")
      .filter((value) => value.length > 0);
  };

  const __automationRedactText = (value) => {
    let redacted = String(value);
    for (const secret of __automationPasswordValues()) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
    return redacted;
  };

  const __automationRedactValue = (value) => {
    const safe = __automationSafeValue(value);
    const visit = (item) => {
      if (typeof item === "string") return __automationRedactText(item);
      if (Array.isArray(item)) return item.map(visit);
      if (item && typeof item === "object") {
        return Object.fromEntries(Object.entries(item).map(([key, child]) => [
          key,
          /password|passwd|pwd/i.test(key) ? "[REDACTED]" : visit(child)
        ]));
      }
      return item;
    };
    return visit(safe);
  };

  const automation = Object.freeze({
    log(value) {
      __automationLogs.push(__automationRedactValue(value));
    },
    sleep(milliseconds) {
      const delay = Number(milliseconds);
      if (!Number.isFinite(delay) || delay < 0) {
        throw new RangeError("automation.sleep requires a non-negative finite number");
      }
      return new Promise((resolve) => setTimeout(resolve, delay));
    },
    stop(reason = "") {
      __automationStopReason = String(reason);
      throw __automationStopSignal;
    }
  });

  const __automationExecute = async () => {
${step.source}
  };

  try {
    const __automationExecution = __automationExecute();
    const __automationValue = ${
      timeoutMs > 0
        ? `await Promise.race([
      __automationExecution,
      new Promise((_, reject) => {
        __automationTimer = setTimeout(() => reject(__automationTimeoutSignal), ${timeoutMs});
      })
    ])`
        : "await __automationExecution"
    };
    return {
      status: "completed",
      logs: __automationLogs,
      value: __automationRedactValue(__automationValue)
    };
  } catch (error) {
    if (error === __automationStopSignal) {
      return { status: "stopped", logs: __automationLogs, reason: __automationRedactText(__automationStopReason) };
    }
    if (error === __automationTimeoutSignal) {
      return { status: "timed-out", logs: __automationLogs };
    }
    return {
      status: "failed",
      logs: __automationLogs,
      error: {
        name: error && typeof error.name === "string" ? error.name : "Error",
        message: __automationRedactText(error && typeof error.message === "string" ? error.message : String(error)),
        stack: error && typeof error.stack === "string" ? __automationRedactText(error.stack) : undefined
      }
    };
  } finally {
    if (__automationTimer !== undefined) clearTimeout(__automationTimer);
  }
})()
//# sourceURL=chrome-automation-custom-step-${sourceName}.js`;
}
