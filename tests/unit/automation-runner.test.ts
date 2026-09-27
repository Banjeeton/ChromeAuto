import { describe, expect, it, vi } from "vitest";

import { InMemoryExecutionLog } from "../../src/adapters/logging/in-memory-execution-log";
import { AutomationRunner } from "../../src/core/application/automation-runner";
import { TabSessionManager } from "../../src/core/application/tab-session-manager";
import { AutomationEngineError } from "../../src/core/domain/automation-engine-error";
import type { AutomationDefinition } from "../../src/core/domain/automation";
import type { AutomationEngine } from "../../src/core/ports/automation-engine";

const defaults = {
  timeoutMs: 5_000,
  postActionDelayMs: 0,
  humanInput: { enabled: false, minDelayMs: 40, maxDelayMs: 120 }
};

function createEngine(): AutomationEngine {
  return {
    start: vi.fn(async (request) => ({
      sessionId: request.sessionId,
      target: request.target
    })),
    executeStep: vi.fn(async (request) => ({
      sessionId: request.sessionId,
      stepId: request.step.id,
      stepIndex: request.stepIndex
    })),
    complete: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    stopAll: vi.fn(async () => undefined)
  };
}

function createRunner(engine = createEngine()) {
  let logId = 0;
  let now = Date.parse("2026-09-27T12:00:00.000Z");
  const sessions = new TabSessionManager(engine, {
    createSessionId: () => "session-1"
  });
  const log = new InMemoryExecutionLog();
  const runner = new AutomationRunner(engine, sessions, log, {
    clock: () => {
      const value = now;
      now += 10;
      return value;
    },
    createLogEntryId: () => `log-${++logId}`
  });
  return { engine, log, runner, sessions };
}

describe("AutomationRunner", () => {
  it("executes enabled steps sequentially and logs skipped steps", async () => {
    const { engine, log, runner } = createRunner();
    const automation: AutomationDefinition = {
      defaults,
      steps: [
        {
          id: "disabled",
          name: "Disabled step",
          type: "reload",
          enabled: false,
          waitUntil: "load"
        },
        {
          id: "reload",
          name: "Reload page",
          type: "reload",
          enabled: true,
          waitUntil: "domcontentloaded"
        },
        {
          id: "wait",
          type: "wait",
          enabled: true,
          condition: { type: "timeout", durationMs: 100 }
        }
      ]
    };

    await expect(
      runner.run({ presetId: "preset-1", tabId: 42, automation })
    ).resolves.toEqual({
      sessionId: "session-1",
      presetId: "preset-1",
      tabId: 42,
      executedSteps: 2,
      skippedSteps: 1
    });

    expect(engine.executeStep).toHaveBeenCalledTimes(2);
    expect(vi.mocked(engine.executeStep).mock.calls.map(([request]) => request.step.id)).toEqual([
      "reload",
      "wait"
    ]);
    expect(engine.complete).toHaveBeenCalledWith("session-1");
    expect(await log.list()).toEqual([
      expect.objectContaining({
        id: "log-1",
        stepId: "disabled",
        stepIndex: 0,
        stepNumber: 1,
        stepType: "reload",
        stepName: "Disabled step",
        status: "skipped"
      }),
      expect.objectContaining({
        id: "log-2",
        stepId: "reload",
        stepNumber: 2,
        status: "succeeded"
      }),
      expect.objectContaining({
        id: "log-3",
        stepId: "wait",
        stepNumber: 3,
        status: "succeeded"
      })
    ]);
  });

  it("logs the failing step and does not execute later steps", async () => {
    const engine = createEngine();
    const timeout = new AutomationEngineError(
      "step-timeout",
      "Submit button timed out",
      {
        context: {
          sessionId: "session-1",
          tabId: 42,
          stepId: "submit",
          stepIndex: 1
        }
      }
    );
    vi.mocked(engine.executeStep)
      .mockResolvedValueOnce({
        sessionId: "session-1",
        stepId: "prepare",
        stepIndex: 0
      })
      .mockRejectedValueOnce(timeout);
    const { log, runner } = createRunner(engine);
    const automation = createReloadAutomation("prepare", "submit", "never");

    await expect(
      runner.run({ presetId: "preset-1", tabId: 42, automation })
    ).rejects.toBe(timeout);

    expect(engine.executeStep).toHaveBeenCalledTimes(2);
    expect(engine.stop).toHaveBeenCalledWith({
      sessionId: "session-1",
      reason: "error"
    });
    expect(await log.list()).toEqual([
      expect.objectContaining({ stepId: "prepare", status: "succeeded" }),
      expect.objectContaining({
        stepId: "submit",
        stepIndex: 1,
        stepNumber: 2,
        status: "failed",
        error: {
          code: "step-timeout",
          message: "Submit button timed out",
          name: "AutomationEngineError"
        }
      })
    ]);
  });

  it("converts unexpected exceptions to contextual domain errors", async () => {
    const engine = createEngine();
    vi.mocked(engine.executeStep).mockRejectedValueOnce(
      new TypeError("Invalid selector")
    );
    const { log, runner } = createRunner(engine);
    const automation = createReloadAutomation("broken");

    await expect(
      runner.run({ presetId: "preset-1", tabId: 42, automation })
    ).rejects.toMatchObject({
      code: "step-failed",
      message: "Invalid selector",
      context: {
        sessionId: "session-1",
        tabId: 42,
        stepId: "broken",
        stepIndex: 0
      }
    });
    expect(await log.list()).toEqual([
      expect.objectContaining({
        stepId: "broken",
        status: "failed",
        error: expect.objectContaining({ code: "step-failed" })
      })
    ]);
  });

  it("distinguishes a requested stop from a failed step", async () => {
    const engine = createEngine();
    const stopped = new AutomationEngineError(
      "session-stopped",
      "Stopped from custom code"
    );
    vi.mocked(engine.executeStep).mockRejectedValueOnce(stopped);
    const { log, runner } = createRunner(engine);

    await expect(
      runner.run({
        presetId: "preset-1",
        tabId: 42,
        automation: createReloadAutomation("stop-here")
      })
    ).rejects.toBe(stopped);

    expect(engine.stop).toHaveBeenCalledWith({
      sessionId: "session-1",
      reason: "user"
    });
    expect(await log.list()).toEqual([
      expect.objectContaining({
        stepId: "stop-here",
        status: "stopped",
        error: expect.objectContaining({ code: "session-stopped" })
      })
    ]);
  });

  it("keeps custom-code log output when the step fails", async () => {
    const engine = createEngine();
    const cause = Object.assign(new Error("Custom code failed"), {
      logs: ["before failure"]
    });
    vi.mocked(engine.executeStep).mockRejectedValueOnce(
      new AutomationEngineError("step-failed", "Custom code failed", { cause })
    );
    const { log, runner } = createRunner(engine);

    await expect(
      runner.run({
        presetId: "preset-1",
        tabId: 42,
        automation: createReloadAutomation("custom")
      })
    ).rejects.toMatchObject({ code: "step-failed" });

    expect(await log.list()).toEqual([
      expect.objectContaining({
        status: "failed",
        output: { logs: ["before failure"] }
      })
    ]);
  });

  it("logs an external Stop as stopped instead of failed", async () => {
    const engine = createEngine();
    let rejectStep: ((reason: unknown) => void) | undefined;
    vi.mocked(engine.executeStep).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectStep = reject;
        })
    );
    const { log, runner, sessions } = createRunner(engine);
    const running = runner.run({
      presetId: "preset-1",
      tabId: 42,
      automation: createReloadAutomation("long-step", "never")
    });

    await vi.waitFor(() => expect(engine.executeStep).toHaveBeenCalledOnce());
    const session = sessions.list()[0];
    await sessions.stop(session.sessionId);
    rejectStep?.(new Error("Page detached"));

    await expect(running).rejects.toMatchObject({
      code: "session-stopped",
      context: { sessionId: "session-1", tabId: 42 }
    });
    expect(engine.executeStep).toHaveBeenCalledOnce();
    expect(await log.list()).toEqual([
      expect.objectContaining({
        stepId: "long-step",
        status: "stopped",
        error: expect.objectContaining({ code: "session-stopped" })
      })
    ]);
  });
});

function createReloadAutomation(...stepIds: string[]): AutomationDefinition {
  return {
    defaults,
    steps: stepIds.map((id) => ({
      id,
      type: "reload" as const,
      enabled: true,
      waitUntil: "load" as const
    }))
  };
}
