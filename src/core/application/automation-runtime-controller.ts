import type { TabSessionManager } from "./tab-session-manager";
import type {
  RuntimeController,
  StopAllAutomationsResult,
  StopAutomationResult
} from "../ports/runtime-controller";
import type { RunSession } from "../domain/run-session";

export class AutomationRuntimeController implements RuntimeController {
  readonly #sessions: TabSessionManager;

  constructor(sessions: TabSessionManager) {
    this.#sessions = sessions;
  }

  sessions(): readonly RunSession[] {
    return Object.freeze(this.#sessions.list());
  }

  async stopByTabId(tabId: number): Promise<StopAutomationResult> {
    const session = this.#sessions.getByTabId(tabId);
    if (!session) {
      return Object.freeze({ stopped: false, tabId });
    }

    await this.#sessions.stop(session.sessionId, "user");
    return Object.freeze({
      stopped: true,
      sessionId: session.sessionId,
      tabId
    });
  }

  async stopAll(): Promise<StopAllAutomationsResult> {
    const sessionIds = this.#sessions
      .list()
      .map((session) => session.sessionId);

    await this.#sessions.stopAll("user");
    return Object.freeze({
      stoppedCount: sessionIds.length,
      sessionIds: Object.freeze(sessionIds)
    });
  }
}
