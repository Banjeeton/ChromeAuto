import type {
  RecorderState,
  RecorderStopReason
} from "../domain/recorder-session";
import { RecorderError } from "../domain/recorder-error";
import type { Recorder } from "../ports/recorder";
import type { RecorderSessionRegistry } from "../ports/recorder-session-registry";

export type RecorderPanelUnavailableReason = "unsupported-url";

export interface RecorderPanelStatus {
  readonly tabId: number;
  readonly state: RecorderState;
  readonly stepCount: number;
  readonly canRecord: boolean;
  readonly canStop: boolean;
  readonly message: string;
  readonly sessionId?: string;
  readonly hostname?: string;
  readonly stopReason?: RecorderStopReason;
  readonly unavailableReason?: RecorderPanelUnavailableReason;
}

export interface RecorderPanelControllerOptions {
  readonly createSessionId?: () => string;
}

/** Presents recorder runtime state in a side-panel-friendly form. */
export class RecorderPanelController {
  readonly #createSessionId: () => string;

  constructor(
    readonly recorder: Recorder,
    readonly registry: RecorderSessionRegistry,
    options: RecorderPanelControllerOptions = {}
  ) {
    this.#createSessionId = options.createSessionId ?? (() => crypto.randomUUID());
  }

  async status(tabId: number, tabUrl: string): Promise<RecorderPanelStatus> {
    const supported = isSupportedUrl(tabUrl);
    const record = await this.registry.getByTabId(tabId);
    if (record === undefined) {
      return supported
        ? idleStatus(tabId)
        : unsupportedStatus(tabId);
    }

    const state = record.session.state;
    const stopReason =
      state === "stopping" || state === "stopped"
        ? record.session.stopReason
        : undefined;
    return {
      tabId,
      state,
      stepCount: record.draftSteps.length,
      canRecord:
        supported && state !== "recording" && state !== "stopping",
      canStop: state === "recording" || state === "stopping",
      message: recorderStateMessage(
        state,
        record.draftSteps.length,
        record.session.context.hostname,
        stopReason
      ),
      sessionId: record.session.sessionId,
      hostname: record.session.context.hostname,
      ...(stopReason === undefined ? {} : { stopReason }),
      ...(supported ? {} : { unavailableReason: "unsupported-url" as const })
    };
  }

  async start(tabId: number, tabUrl: string): Promise<RecorderPanelStatus> {
    if (!isSupportedUrl(tabUrl)) {
      throw new RecorderError(
        "unsupported-url",
        "Recording is only available on HTTP or HTTPS pages.",
        { context: { tabId, url: tabUrl } }
      );
    }
    await this.recorder.start({
      sessionId: this.#createSessionId(),
      tabId,
      url: tabUrl
    });
    return await this.status(tabId, tabUrl);
  }

  async stop(tabId: number, tabUrl: string): Promise<RecorderPanelStatus> {
    await this.recorder.stop({ tabId, reason: "user" });
    return await this.status(tabId, tabUrl);
  }
}

function idleStatus(tabId: number): RecorderPanelStatus {
  return {
    tabId,
    state: "idle",
    stepCount: 0,
    canRecord: true,
    canStop: false,
    message: "Recorder is ready."
  };
}

function unsupportedStatus(tabId: number): RecorderPanelStatus {
  return {
    tabId,
    state: "idle",
    stepCount: 0,
    canRecord: false,
    canStop: false,
    message: "Recording is only available on HTTP or HTTPS pages.",
    unavailableReason: "unsupported-url"
  };
}

function recorderStateMessage(
  state: RecorderState,
  stepCount: number,
  hostname: string,
  stopReason?: RecorderStopReason
): string {
  switch (state) {
    case "recording":
      return `Recording ${hostname}: ${stepCount} ${stepCount === 1 ? "step" : "steps"}.`;
    case "stopping":
      return "Stopping recording…";
    case "stopped":
      if (stopReason === "tab-context-changed") {
        return `Recording stopped because the tab left ${hostname}. The ${stepCount}-step draft was preserved.`;
      }
      if (stopReason === "tab-closed") {
        return `Recording stopped because the tab was closed. The ${stepCount}-step draft was preserved.`;
      }
      return `Recording stopped with ${stepCount} ${stepCount === 1 ? "step" : "steps"}.`;
    case "failed":
      return "Recording failed. The captured draft was preserved.";
    case "idle":
      return "Recorder is ready.";
  }
}

function isSupportedUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
