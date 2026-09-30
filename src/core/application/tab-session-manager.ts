import { AutomationEngineError } from "../domain/automation-engine-error";
import type {
  AutomationSessionId,
  AutomationStopReason,
  RunSession,
  RunSessionStep,
  RunSessionStatus
} from "../domain/run-session";
import type { AutomationEngine } from "../ports/automation-engine";

export interface StartTabSessionRequest {
  readonly presetId: string;
  readonly tabId: number;
}

export interface TabSessionManagerOptions {
  readonly createSessionId?: () => AutomationSessionId;
}

interface ManagedSession {
  readonly sessionId: AutomationSessionId;
  readonly presetId: string;
  readonly tabId: number;
  readonly abortController: AbortController;
  status: RunSessionStatus;
  currentStep?: RunSessionStep;
  stopReason?: AutomationStopReason;
  ready: Promise<void>;
  termination?: Promise<void>;
}

function defaultSessionIdFactory(): AutomationSessionId {
  return crypto.randomUUID();
}

/**
 * Owns the one-active-session-per-tab invariant and coordinates session
 * lifecycle calls with the browser automation engine.
 */
export class TabSessionManager {
  readonly #engine: AutomationEngine;
  readonly #createSessionId: () => AutomationSessionId;
  readonly #sessionsById = new Map<AutomationSessionId, ManagedSession>();
  readonly #sessionIdByTabId = new Map<number, AutomationSessionId>();
  #stopAllPromise?: Promise<void>;

  constructor(
    engine: AutomationEngine,
    options: TabSessionManagerOptions = {}
  ) {
    this.#engine = engine;
    this.#createSessionId =
      options.createSessionId ?? defaultSessionIdFactory;
  }

  async start(request: StartTabSessionRequest): Promise<RunSession> {
    this.#assertTabId(request.tabId);

    if (this.#stopAllPromise) {
      throw new AutomationEngineError(
        "session-conflict",
        "Cannot start a session while all sessions are stopping",
        { context: { tabId: request.tabId } }
      );
    }

    const existingSession = this.getByTabId(request.tabId);
    if (existingSession) {
      throw new AutomationEngineError(
        "session-conflict",
        `Tab ${request.tabId} already has an active automation session`,
        {
          context: {
            sessionId: existingSession.sessionId,
            tabId: request.tabId
          }
        }
      );
    }

    const sessionId = this.#createSessionId();
    if (this.#sessionsById.has(sessionId)) {
      throw new AutomationEngineError(
        "session-conflict",
        `Automation session ${sessionId} already exists`,
        { context: { sessionId, tabId: request.tabId } }
      );
    }

    const session: ManagedSession = {
      sessionId,
      presetId: request.presetId,
      tabId: request.tabId,
      abortController: new AbortController(),
      status: "starting",
      ready: Promise.resolve()
    };

    this.#sessionsById.set(sessionId, session);
    this.#sessionIdByTabId.set(request.tabId, sessionId);

    session.ready = this.#startEngineSession(session);
    await session.ready;

    return this.#toSnapshot(session);
  }

  getById(sessionId: AutomationSessionId): RunSession | undefined {
    const session = this.#sessionsById.get(sessionId);
    return session ? this.#toSnapshot(session) : undefined;
  }

  getByTabId(tabId: number): RunSession | undefined {
    const sessionId = this.#sessionIdByTabId.get(tabId);
    return sessionId === undefined ? undefined : this.getById(sessionId);
  }

  list(): RunSession[] {
    return [...this.#sessionsById.values()].map((session) =>
      this.#toSnapshot(session)
    );
  }

  cancellationSignal(sessionId: AutomationSessionId): AbortSignal {
    return this.#requireSession(sessionId).abortController.signal;
  }

  setCurrentStep(
    sessionId: AutomationSessionId,
    step: RunSessionStep
  ): void {
    const session = this.#requireSession(sessionId);
    session.currentStep = Object.freeze(structuredClone(step));
  }

  async complete(sessionId: AutomationSessionId): Promise<void> {
    if (this.#stopAllPromise) {
      return this.#stopAllPromise;
    }

    const session = this.#requireSession(sessionId);
    return this.#terminateSession(session, "completing", () =>
      this.#engine.complete(sessionId)
    );
  }

  async stop(
    sessionId: AutomationSessionId,
    reason: AutomationStopReason = "user"
  ): Promise<void> {
    if (this.#stopAllPromise) {
      return this.#stopAllPromise;
    }

    const session = this.#requireSession(sessionId);
    this.#requestStop(session, reason);
    return this.#terminateSession(session, "stopping", () =>
      this.#engine.stop({ sessionId, reason })
    );
  }

  async stopByTabId(
    tabId: number,
    reason: AutomationStopReason = "user"
  ): Promise<void> {
    const session = this.getByTabId(tabId);
    if (!session) {
      throw new AutomationEngineError(
        "session-not-found",
        `Tab ${tabId} has no active automation session`,
        { context: { tabId } }
      );
    }

    return this.stop(session.sessionId, reason);
  }

  stopAll(reason: AutomationStopReason = "user"): Promise<void> {
    if (this.#stopAllPromise) {
      return this.#stopAllPromise;
    }

    const operation = this.#performStopAll(reason).finally(() => {
      this.#stopAllPromise = undefined;
    });
    this.#stopAllPromise = operation;

    return operation;
  }

  async #startEngineSession(session: ManagedSession): Promise<void> {
    try {
      await this.#engine.start({
        sessionId: session.sessionId,
        target: { tabId: session.tabId }
      });
      session.status = "running";
    } catch (error) {
      this.#removeSession(session);
      throw error;
    }
  }

  #terminateSession(
    session: ManagedSession,
    status: "completing" | "stopping",
    terminate: () => Promise<void>
  ): Promise<void> {
    if (session.termination) {
      return session.termination;
    }

    let terminationStarted = false;
    const operation = (async () => {
      try {
        await session.ready;
        session.status = status;
        terminationStarted = true;
        await terminate();
        this.#removeSession(session);
      } catch (error) {
        if (
          terminationStarted &&
          this.#sessionsById.get(session.sessionId) === session
        ) {
          session.status = status === "stopping" ? "stopping" : "running";
          session.termination = undefined;
        }
        throw error;
      }
    })();

    session.termination = operation;
    return operation;
  }

  async #performStopAll(reason: AutomationStopReason): Promise<void> {
    const capturedSessions = [...this.#sessionsById.values()];
    for (const session of capturedSessions) {
      this.#requestStop(session, reason);
    }

    await Promise.allSettled(
      capturedSessions.map(
        (session) => session.termination ?? session.ready
      )
    );

    const activeSessions = capturedSessions.filter(
      (session) => this.#sessionsById.get(session.sessionId) === session
    );

    if (activeSessions.length === 0) {
      return;
    }

    for (const session of activeSessions) {
      session.status = "stopping";
    }

    try {
      await this.#engine.stopAll({ reason });
      for (const session of activeSessions) {
        this.#removeSession(session);
      }
    } catch (error) {
      for (const session of activeSessions) {
        if (this.#sessionsById.get(session.sessionId) === session) {
          session.status = "stopping";
          session.termination = undefined;
        }
      }
      throw error;
    }
  }

  #requireSession(sessionId: AutomationSessionId): ManagedSession {
    const session = this.#sessionsById.get(sessionId);
    if (!session) {
      throw new AutomationEngineError(
        "session-not-found",
        `Automation session ${sessionId} was not found`,
        { context: { sessionId } }
      );
    }
    return session;
  }

  #removeSession(session: ManagedSession): void {
    if (this.#sessionsById.get(session.sessionId) === session) {
      this.#sessionsById.delete(session.sessionId);
    }
    if (this.#sessionIdByTabId.get(session.tabId) === session.sessionId) {
      this.#sessionIdByTabId.delete(session.tabId);
    }
  }

  #requestStop(
    session: ManagedSession,
    reason: AutomationStopReason
  ): void {
    session.status = "stopping";
    session.stopReason = reason;

    if (!session.abortController.signal.aborted) {
      session.abortController.abort(
        new AutomationEngineError(
          "session-stopped",
          reason === "user"
            ? "Automation was stopped by the user"
            : "Automation was stopped after an error",
          {
            context: {
              sessionId: session.sessionId,
              tabId: session.tabId
            }
          }
        )
      );
    }
  }

  #assertTabId(tabId: number): void {
    if (!Number.isInteger(tabId) || tabId < 0) {
      throw new AutomationEngineError(
        "invalid-target",
        `Invalid Chrome tab id: ${tabId}`,
        { context: { tabId } }
      );
    }
  }

  #toSnapshot(session: ManagedSession): RunSession {
    return Object.freeze({
      sessionId: session.sessionId,
      presetId: session.presetId,
      tabId: session.tabId,
      status: session.status,
      ...(session.currentStep === undefined
        ? {}
        : { currentStep: Object.freeze(structuredClone(session.currentStep)) }),
      ...(session.stopReason === undefined
        ? {}
        : { stopReason: session.stopReason })
    });
  }
}
