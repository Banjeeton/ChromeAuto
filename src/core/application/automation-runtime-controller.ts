import type { TabSessionManager } from "./tab-session-manager";
import type {
  RuntimeController,
  StopAllAutomationsResult,
  StopAutomationResult
} from "../ports/runtime-controller";
import type { RunSession } from "../domain/run-session";
import type { RepeatCycleController } from "./repeat-cycle-controller";

type RepeatCycleStopController = Pick<
  RepeatCycleController,
  "stopByTabId" | "stopAll"
>;

export class AutomationRuntimeController implements RuntimeController {
  readonly #sessions: TabSessionManager;
  readonly #repeatCycles?: RepeatCycleStopController;

  constructor(
    sessions: TabSessionManager,
    repeatCycles?: RepeatCycleStopController
  ) {
    this.#sessions = sessions;
    this.#repeatCycles = repeatCycles;
  }

  sessions(): readonly RunSession[] {
    return Object.freeze(this.#sessions.list());
  }

  async stopByTabId(tabId: number): Promise<StopAutomationResult> {
    const session = this.#sessions.getByTabId(tabId);
    const [cycleResult, sessionResult] = await Promise.allSettled([
      this.#repeatCycles?.stopByTabId(tabId) ?? Promise.resolve(false),
      session === undefined
        ? Promise.resolve()
        : this.#sessions.stop(session.sessionId, "user")
    ]);
    const cycleStopped = settledValue(cycleResult);
    settledValue(sessionResult);

    return Object.freeze({
      stopped: session !== undefined || cycleStopped,
      ...(session === undefined ? {} : { sessionId: session.sessionId }),
      tabId
    });
  }

  async stopAll(): Promise<StopAllAutomationsResult> {
    const sessions = this.#sessions.list();
    const sessionIds = sessions.map((session) => session.sessionId);
    const [cycleResult, sessionResult] = await Promise.allSettled([
      this.#repeatCycles?.stopAll() ?? Promise.resolve([]),
      this.#sessions.stopAll("user")
    ]);
    const stoppedCycleTabIds = settledValue(cycleResult);
    settledValue(sessionResult);
    const stoppedTabIds = new Set([
      ...sessions.map((session) => session.tabId),
      ...stoppedCycleTabIds
    ]);

    return Object.freeze({
      stoppedCount: stoppedTabIds.size,
      sessionIds: Object.freeze(sessionIds)
    });
  }
}

function settledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") {
    throw result.reason;
  }
  return result.value;
}
