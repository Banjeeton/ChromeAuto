import type { Page } from "playwright-crx";
import { describe, expect, it, vi } from "vitest";

import {
  CustomJavaScriptExecutionError,
  CustomJavaScriptStopError,
  CustomJavaScriptTimeoutError,
  executeCustomJavaScript
} from "../../src/adapters/playwright/custom-javascript-executor";
import type { CustomCodeStep } from "../../src/core/domain/automation-step";

describe("custom JavaScript executor", () => {
  it("returns a serializable value and collected log entries", async () => {
    const page = createEvaluatingPage();
    const step = createStep(`
      automation.log("started");
      await automation.sleep(1);
      automation.log({ count: 2 });
      return { answer: 42 };
    `);

    await expect(executeCustomJavaScript(page, step, 1_000)).resolves.toEqual({
      logs: ["started", { count: 2 }],
      value: { answer: 42 }
    });
  });

  it("converts automation.stop into a dedicated stop signal", async () => {
    const page = createEvaluatingPage();
    const step = createStep(`
      automation.log("before stop");
      automation.stop("condition reached");
    `);

    await expect(executeCustomJavaScript(page, step, 1_000)).rejects.toEqual(
      expect.objectContaining({
        name: "CustomJavaScriptStopError",
        reason: "condition reached",
        logs: ["before stop"]
      })
    );
  });

  it("preserves logs and page error details when code fails", async () => {
    const page = createEvaluatingPage();
    const step = createStep(`
      automation.log("before failure");
      throw new TypeError("Broken custom code");
    `);

    try {
      await executeCustomJavaScript(page, step, 1_000);
      throw new Error("Expected custom JavaScript to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CustomJavaScriptExecutionError);
      expect(error).toMatchObject({
        logs: ["before failure"],
        cause: {
          name: "TypeError",
          message: "Broken custom code"
        }
      });
    }
  });

  it("reports a timeout and retains logs produced before it", async () => {
    const page = createEvaluatingPage();
    const step = createStep(`
      automation.log("waiting forever");
      await new Promise(() => {});
    `);

    await expect(executeCustomJavaScript(page, step, 5)).rejects.toEqual(
      expect.objectContaining({
        name: "CustomJavaScriptTimeoutError",
        timeoutMs: 5,
        logs: ["waiting forever"]
      })
    );
  });

  it("validates automation.sleep arguments inside the page", async () => {
    const page = createEvaluatingPage();
    const step = createStep("await automation.sleep(-1);");

    await expect(executeCustomJavaScript(page, step, 1_000)).rejects.toEqual(
      expect.objectContaining({
        name: "CustomJavaScriptExecutionError",
        cause: expect.objectContaining({
          name: "RangeError",
          message: "automation.sleep requires a non-negative finite number"
        })
      })
    );
  });

  it("normalizes circular log values and undefined results", async () => {
    const page = createEvaluatingPage();
    const step = createStep(`
      const circular = {};
      circular.self = circular;
      automation.log(circular);
    `);

    await expect(executeCustomJavaScript(page, step, 1_000)).resolves.toEqual({
      logs: ["[object Object]"],
      value: null
    });
  });

  it("redacts current password field values from logs, results and errors", async () => {
    const secret = "page-password-secret";
    vi.stubGlobal("document", {
      querySelectorAll: () => [{ value: secret }]
    });
    const page = createEvaluatingPage();

    await expect(executeCustomJavaScript(page, createStep(`
      automation.log({ password: "${secret}", nested: "value=${secret}" });
      return "${secret}";
    `), 1_000)).resolves.toEqual({
      logs: [{ password: "[REDACTED]", nested: "value=[REDACTED]" }],
      value: "[REDACTED]"
    });

    await expect(executeCustomJavaScript(page, createStep(`
      throw new Error("failed with ${secret}");
    `), 1_000)).rejects.toMatchObject({
      message: expect.not.stringContaining(secret),
      cause: { message: "failed with [REDACTED]" }
    });
    vi.unstubAllGlobals();
  });

  it("exposes distinct error classes for application-level handling", () => {
    expect(new CustomJavaScriptStopError("done", [])).toBeInstanceOf(Error);
    expect(new CustomJavaScriptTimeoutError(100, [])).toBeInstanceOf(Error);
  });
});

function createStep(source: string): CustomCodeStep {
  return {
    id: "custom-step",
    type: "customCode",
    enabled: true,
    language: "javascript",
    apiVersion: 1,
    executionContext: "page",
    source
  };
}

function createEvaluatingPage(): Page {
  return {
    evaluate: vi.fn(async (expression: string) => {
      return await (0, eval)(expression);
    })
  } as unknown as Page;
}
