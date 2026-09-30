import { describe, expect, it, vi } from "vitest";

import { TabSessionManager } from "../../src/core/application/tab-session-manager";
import {
  AutomationEngineError,
  isAutomationEngineError
} from "../../src/core/domain/automation-engine-error";
import type { AutomationEngine } from "../../src/core/ports/automation-engine";

function createEngine(): AutomationEngine {
  return {
    start: vi.fn(async (request) => ({
      sessionId: request.sessionId,
      target: request.target
    })),
    executeStep: vi.fn(),
    complete: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    stopAll: vi.fn(async () => undefined)
  };
}

function createSessionIds(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `session-${index}`;
}

describe("TabSessionManager", () => {
  it("runs the same preset independently in different tabs", async () => {
    const engine = createEngine();
    const manager = new TabSessionManager(engine, {
      createSessionId: createSessionIds("session-1", "session-2")
    });

    const first = await manager.start({ presetId: "preset-1", tabId: 11 });
    const second = await manager.start({ presetId: "preset-1", tabId: 22 });

    expect(first).toEqual({
      sessionId: "session-1",
      presetId: "preset-1",
      tabId: 11,
      status: "running"
    });
    expect(second.sessionId).toBe("session-2");
    expect(manager.list()).toHaveLength(2);

    await manager.stop(first.sessionId);

    expect(engine.stop).toHaveBeenCalledWith({
      sessionId: "session-1",
      reason: "user"
    });
    expect(manager.getByTabId(11)).toBeUndefined();
    expect(manager.getByTabId(22)).toEqual(second);
  });

  it("reserves a tab while its engine session is starting", async () => {
    let finishStart: (() => void) | undefined;
    const engine = createEngine();
    vi.mocked(engine.start).mockImplementationOnce(
      (request) =>
        new Promise((resolve) => {
          finishStart = () =>
            resolve({ sessionId: request.sessionId, target: request.target });
        })
    );
    const manager = new TabSessionManager(engine, {
      createSessionId: createSessionIds("session-1", "session-2")
    });

    const firstStart = manager.start({ presetId: "preset-1", tabId: 11 });

    await expect(
      manager.start({ presetId: "preset-2", tabId: 11 })
    ).rejects.toMatchObject({
      code: "session-conflict",
      context: { sessionId: "session-1", tabId: 11 }
    });

    finishStart?.();
    await firstStart;
    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it("removes a session after successful completion", async () => {
    const engine = createEngine();
    const manager = new TabSessionManager(engine, {
      createSessionId: createSessionIds("session-1")
    });
    const session = await manager.start({ presetId: "preset-1", tabId: 11 });

    await manager.complete(session.sessionId);

    expect(engine.complete).toHaveBeenCalledWith("session-1");
    expect(manager.list()).toEqual([]);
  });

  it("publishes the current step in an immutable session snapshot", async () => {
    const manager = new TabSessionManager(createEngine(), {
      createSessionId: createSessionIds("session-1")
    });
    const session = await manager.start({ presetId: "preset-1", tabId: 11 });

    manager.setCurrentStep(session.sessionId, {
      stepId: "fill-email",
      stepIndex: 1,
      stepNumber: 2,
      stepType: "input",
      stepName: "Enter email"
    });

    const snapshot = manager.getById(session.sessionId);
    expect(snapshot?.currentStep).toEqual({
      stepId: "fill-email",
      stepIndex: 1,
      stepNumber: 2,
      stepType: "input",
      stepName: "Enter email"
    });
    expect(Object.isFrozen(snapshot?.currentStep)).toBe(true);
  });

  it("stops all sessions with one engine operation", async () => {
    const engine = createEngine();
    const manager = new TabSessionManager(engine, {
      createSessionId: createSessionIds("session-1", "session-2")
    });
    await manager.start({ presetId: "preset-1", tabId: 11 });
    await manager.start({ presetId: "preset-2", tabId: 22 });

    await manager.stopAll("error");

    expect(engine.stopAll).toHaveBeenCalledOnce();
    expect(engine.stopAll).toHaveBeenCalledWith({ reason: "error" });
    expect(manager.list()).toEqual([]);
  });

  it("releases a tab reservation when engine start fails", async () => {
    const engine = createEngine();
    vi.mocked(engine.start).mockRejectedValueOnce(
      new AutomationEngineError("engine-unavailable", "Start failed")
    );
    const manager = new TabSessionManager(engine, {
      createSessionId: createSessionIds("session-1", "session-2")
    });

    await expect(
      manager.start({ presetId: "preset-1", tabId: 11 })
    ).rejects.toMatchObject({ code: "engine-unavailable" });

    await expect(
      manager.start({ presetId: "preset-1", tabId: 11 })
    ).resolves.toMatchObject({ sessionId: "session-2", status: "running" });
  });

  it("keeps a session registered when stopping the engine fails", async () => {
    const engine = createEngine();
    vi.mocked(engine.stop).mockRejectedValueOnce(
      new AutomationEngineError("engine-unavailable", "Stop failed")
    );
    const manager = new TabSessionManager(engine, {
      createSessionId: createSessionIds("session-1")
    });
    const session = await manager.start({ presetId: "preset-1", tabId: 11 });

    await expect(manager.stop(session.sessionId)).rejects.toMatchObject({
      code: "engine-unavailable"
    });

    expect(manager.getById(session.sessionId)).toMatchObject({
      status: "stopping",
      stopReason: "user"
    });
    expect(manager.cancellationSignal(session.sessionId)).toMatchObject({
      aborted: true,
      reason: expect.objectContaining({ code: "session-stopped" })
    });
    await expect(manager.stop(session.sessionId)).resolves.toBeUndefined();
  });

  it("aborts one session without cancelling another tab", async () => {
    let finishStop: (() => void) | undefined;
    const engine = createEngine();
    vi.mocked(engine.stop).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStop = resolve;
        })
    );
    const manager = new TabSessionManager(engine, {
      createSessionId: createSessionIds("session-1", "session-2")
    });
    const first = await manager.start({ presetId: "preset-1", tabId: 11 });
    const second = await manager.start({ presetId: "preset-2", tabId: 22 });
    const firstSignal = manager.cancellationSignal(first.sessionId);
    const secondSignal = manager.cancellationSignal(second.sessionId);

    const stopping = manager.stop(first.sessionId);

    expect(firstSignal.aborted).toBe(true);
    expect(firstSignal.reason).toMatchObject({
      code: "session-stopped",
      context: { sessionId: first.sessionId, tabId: 11 }
    });
    expect(secondSignal.aborted).toBe(false);
    expect(manager.getById(first.sessionId)).toMatchObject({
      status: "stopping",
      stopReason: "user"
    });

    await vi.waitFor(() => expect(engine.stop).toHaveBeenCalledOnce());
    finishStop?.();
    await stopping;

    expect(manager.getById(first.sessionId)).toBeUndefined();
    expect(manager.getById(second.sessionId)?.status).toBe("running");
  });

  it("aborts every cancellation signal before Stop All completes", async () => {
    let finishStopAll: (() => void) | undefined;
    const engine = createEngine();
    vi.mocked(engine.stopAll).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStopAll = resolve;
        })
    );
    const manager = new TabSessionManager(engine, {
      createSessionId: createSessionIds("session-1", "session-2")
    });
    const first = await manager.start({ presetId: "preset-1", tabId: 11 });
    const second = await manager.start({ presetId: "preset-2", tabId: 22 });
    const signals = [
      manager.cancellationSignal(first.sessionId),
      manager.cancellationSignal(second.sessionId)
    ];

    const stopping = manager.stopAll();

    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(manager.list()).toEqual([
      expect.objectContaining({ status: "stopping", stopReason: "user" }),
      expect.objectContaining({ status: "stopping", stopReason: "user" })
    ]);

    await vi.waitFor(() => expect(engine.stopAll).toHaveBeenCalledOnce());
    finishStopAll?.();
    await stopping;
    expect(manager.list()).toEqual([]);
  });

  it("reports invalid tabs and missing sessions as domain errors", async () => {
    const manager = new TabSessionManager(createEngine(), {
      createSessionId: createSessionIds("session-1")
    });

    await expect(
      manager.start({ presetId: "preset-1", tabId: -1 })
    ).rejects.toSatisfy(isAutomationEngineError);
    await expect(manager.stopByTabId(999)).rejects.toMatchObject({
      code: "session-not-found",
      context: { tabId: 999 }
    });
  });

  it("returns immutable session snapshots", async () => {
    const manager = new TabSessionManager(createEngine(), {
      createSessionId: createSessionIds("session-1")
    });

    const session = await manager.start({ presetId: "preset-1", tabId: 11 });

    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(manager.getById(session.sessionId))).toBe(true);
  });
});
