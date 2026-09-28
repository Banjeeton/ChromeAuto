import { describe, expect, it, vi } from "vitest";

import { AutomationRuntimeController } from "../../src/core/application/automation-runtime-controller";
import type { RepeatCycleController } from "../../src/core/application/repeat-cycle-controller";
import { TabSessionManager } from "../../src/core/application/tab-session-manager";
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

function createRuntime(...sessionIds: string[]) {
  let index = 0;
  const engine = createEngine();
  const sessions = new TabSessionManager(engine, {
    createSessionId: () => sessionIds[index++] ?? `session-${index}`
  });
  return {
    engine,
    sessions,
    controller: new AutomationRuntimeController(sessions)
  };
}

describe("AutomationRuntimeController", () => {
  it("stops the active automation for one tab", async () => {
    const { controller, engine, sessions } = createRuntime(
      "session-1",
      "session-2"
    );
    await sessions.start({ presetId: "preset-1", tabId: 11 });
    await sessions.start({ presetId: "preset-2", tabId: 22 });

    await expect(controller.stopByTabId(11)).resolves.toEqual({
      stopped: true,
      sessionId: "session-1",
      tabId: 11
    });

    expect(engine.stop).toHaveBeenCalledWith({
      sessionId: "session-1",
      reason: "user"
    });
    expect(controller.sessions()).toEqual([
      expect.objectContaining({ sessionId: "session-2", tabId: 22 })
    ]);
  });

  it("treats Stop for an idle tab as an idempotent no-op", async () => {
    const { controller, engine } = createRuntime();

    await expect(controller.stopByTabId(404)).resolves.toEqual({
      stopped: false,
      tabId: 404
    });
    expect(engine.stop).not.toHaveBeenCalled();
  });

  it("stops a waiting repeat cycle even when there is no running session", async () => {
    const repeatCycles = createRepeatStopper();
    repeatCycles.stopByTabId.mockResolvedValueOnce(true).mockResolvedValue(false);
    const engine = createEngine();
    const sessions = new TabSessionManager(engine);
    const controller = new AutomationRuntimeController(sessions, repeatCycles);

    await expect(controller.stopByTabId(33)).resolves.toEqual({
      stopped: true,
      tabId: 33
    });
    await expect(controller.stopByTabId(33)).resolves.toEqual({
      stopped: false,
      tabId: 33
    });

    expect(repeatCycles.stopByTabId).toHaveBeenCalledTimes(2);
    expect(engine.stop).not.toHaveBeenCalled();
  });

  it("stops all active tab sessions and reports their ids", async () => {
    const { controller, engine, sessions } = createRuntime(
      "session-1",
      "session-2"
    );
    await sessions.start({ presetId: "preset-1", tabId: 11 });
    await sessions.start({ presetId: "preset-2", tabId: 22 });

    await expect(controller.stopAll()).resolves.toEqual({
      stoppedCount: 2,
      sessionIds: ["session-1", "session-2"]
    });

    expect(engine.stopAll).toHaveBeenCalledWith({ reason: "user" });
    expect(controller.sessions()).toEqual([]);
  });

  it("Stop All combines running sessions and waiting cycles by tab", async () => {
    const repeatCycles = createRepeatStopper();
    repeatCycles.stopAll.mockResolvedValue([11, 22]);
    const engine = createEngine();
    const sessions = new TabSessionManager(engine, {
      createSessionId: () => "session-1"
    });
    const controller = new AutomationRuntimeController(sessions, repeatCycles);
    await sessions.start({ presetId: "preset-1", tabId: 11 });

    await expect(controller.stopAll()).resolves.toEqual({
      stoppedCount: 2,
      sessionIds: ["session-1"]
    });

    expect(repeatCycles.stopAll).toHaveBeenCalledOnce();
    expect(engine.stopAll).toHaveBeenCalledWith({ reason: "user" });
  });

  it("returns immutable session and result collections", async () => {
    const { controller, sessions } = createRuntime("session-1");
    await sessions.start({ presetId: "preset-1", tabId: 11 });

    const listedSessions = controller.sessions();
    const result = await controller.stopAll();

    expect(Object.isFrozen(listedSessions)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sessionIds)).toBe(true);
  });
});

function createRepeatStopper() {
  return {
    stopByTabId: vi.fn(async () => false),
    stopAll: vi.fn(async () => [] as readonly number[])
  } satisfies Pick<RepeatCycleController, "stopByTabId" | "stopAll">;
}
