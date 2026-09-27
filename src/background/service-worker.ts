import { PlaywrightEngine } from "../adapters/playwright/playwright-engine";
import { AutomationRuntimeController } from "../core/application/automation-runtime-controller";
import { TabSessionManager } from "../core/application/tab-session-manager";
import {
  AUTOMATION_RUNTIME_MESSAGE,
  type AutomationRuntimeMessage,
  type AutomationRuntimeResponse,
  type AutomationRuntimeResult
} from "../shared/types/automation-runtime";
import {
  PLAYWRIGHT_CRX_SPIKE_MESSAGE,
  type PlaywrightSpikeMessage,
  type PlaywrightSpikeResponse,
  type PlaywrightSpikeResult
} from "../shared/types/playwright-crx-spike";

const playwrightEngine = new PlaywrightEngine();
const tabSessionManager = new TabSessionManager(playwrightEngine);
const runtimeController = new AutomationRuntimeController(tabSessionManager);

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error("Unable to configure the side panel behavior.", error);
    });
});

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender,
    sendResponse: (response: PlaywrightSpikeResponse) => void
  ) => {
    if (!isPlaywrightSpikeMessage(message)) {
      return false;
    }

    void handlePlaywrightSpikeMessage(message)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }
);

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender,
    sendResponse: (response: AutomationRuntimeResponse) => void
  ) => {
    if (!isAutomationRuntimeMessage(message)) {
      return false;
    }

    void handleAutomationRuntimeMessage(message)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  }
);

function isAutomationRuntimeMessage(
  message: unknown
): message is AutomationRuntimeMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const candidate = message as Partial<AutomationRuntimeMessage>;
  if (candidate.type !== AUTOMATION_RUNTIME_MESSAGE) {
    return false;
  }

  if (candidate.action === "stop-all" || candidate.action === "sessions") {
    return true;
  }

  return (
    candidate.action === "stop" &&
    "tabId" in candidate &&
    typeof candidate.tabId === "number"
  );
}

async function handleAutomationRuntimeMessage(
  message: AutomationRuntimeMessage
): Promise<AutomationRuntimeResult> {
  switch (message.action) {
    case "stop":
      return runtimeController.stopByTabId(message.tabId);
    case "stop-all":
      return runtimeController.stopAll();
    case "sessions":
      return runtimeController.sessions();
  }
}

function isPlaywrightSpikeMessage(
  message: unknown
): message is PlaywrightSpikeMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const candidate = message as Partial<PlaywrightSpikeMessage>;
  if (candidate.type !== PLAYWRIGHT_CRX_SPIKE_MESSAGE) {
    return false;
  }

  if (candidate.action === "sessions" || candidate.action === "detach-all") {
    return true;
  }

  return (
    (candidate.action === "snapshot" ||
      candidate.action === "reload" ||
      candidate.action === "modal" ||
      candidate.action === "detach") &&
    "tabId" in candidate &&
    typeof candidate.tabId === "number"
  );
}

async function handlePlaywrightSpikeMessage(
  message: PlaywrightSpikeMessage
): Promise<PlaywrightSpikeResult> {
  switch (message.action) {
    case "snapshot": {
      await ensureSpikeSession(message.tabId);
      return playwrightEngine.snapshot(message.tabId);
    }
    case "reload": {
      await ensureSpikeSession(message.tabId);
      return playwrightEngine.reload(message.tabId);
    }
    case "modal": {
      await ensureSpikeSession(message.tabId);
      return playwrightEngine.testHtmlModal(message.tabId);
    }
    case "detach":
      await runtimeController.stopByTabId(message.tabId);
      return undefined;
    case "sessions":
      return runtimeController
        .sessions()
        .map((session) => session.tabId)
        .sort((left, right) => left - right);
    case "detach-all":
      await runtimeController.stopAll();
      return undefined;
  }
}

async function ensureSpikeSession(tabId: number): Promise<void> {
  if (tabSessionManager.getByTabId(tabId)) {
    return;
  }

  await tabSessionManager.start({
    presetId: "playwright-crx-spike",
    tabId
  });
}
