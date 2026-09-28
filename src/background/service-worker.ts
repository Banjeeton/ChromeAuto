import { PlaywrightEngine } from "../adapters/playwright/playwright-engine";
import { InMemoryExecutionLog } from "../adapters/logging/in-memory-execution-log";
import { ChromePresetRepository } from "../adapters/storage/chrome-storage";
import { AutomationRunner } from "../core/application/automation-runner";
import { ManualRunController } from "../core/application/manual-run-controller";
import {
  PresetEditorController
} from "../core/application/preset-editor";
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
const executionLog = new InMemoryExecutionLog();
const presetRepository = new ChromePresetRepository(chrome.storage.local);
const presetEditorController = new PresetEditorController(presetRepository);
const automationRunner = new AutomationRunner(
  playwrightEngine,
  tabSessionManager,
  executionLog
);
const manualRunController = new ManualRunController(
  presetRepository,
  automationRunner,
  tabSessionManager
);

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

  if (
    candidate.action === "stop-all" ||
    candidate.action === "sessions" ||
    candidate.action === "presets"
  ) {
    return true;
  }

  if (candidate.action === "create-preset") {
    return "fields" in candidate && isObject(candidate.fields);
  }

  if (candidate.action === "update-preset") {
    return (
      "presetId" in candidate &&
      typeof candidate.presetId === "string" &&
      "fields" in candidate &&
      isObject(candidate.fields)
    );
  }

  if (candidate.action === "delete-preset") {
    return (
      "presetId" in candidate && typeof candidate.presetId === "string"
    );
  }

  return (
    (candidate.action === "manual-status" ||
      candidate.action === "run" ||
      candidate.action === "stop" ||
      candidate.action === "logs" ||
      candidate.action === "clear-logs") &&
    "tabId" in candidate &&
    typeof candidate.tabId === "number"
  );
}

async function handleAutomationRuntimeMessage(
  message: AutomationRuntimeMessage
): Promise<AutomationRuntimeResult> {
  switch (message.action) {
    case "manual-status": {
      const tabUrl = await getTabUrl(message.tabId);
      return {
        kind: "manual-status",
        status: await manualRunController.status(message.tabId, tabUrl)
      };
    }
    case "run": {
      const tabUrl = await getTabUrl(message.tabId);
      return {
        kind: "run",
        run: await manualRunController.run(message.tabId, tabUrl)
      };
    }
    case "stop":
      return {
        kind: "stop",
        stop: await runtimeController.stopByTabId(message.tabId)
      };
    case "stop-all":
      return { kind: "stop-all", stopAll: await runtimeController.stopAll() };
    case "sessions":
      return { kind: "sessions", sessions: runtimeController.sessions() };
    case "presets":
      return { kind: "presets", presets: await presetRepository.list() };
    case "create-preset": {
      const preset = await presetEditorController.create(message.fields);
      return { kind: "preset-saved", preset };
    }
    case "update-preset": {
      const preset = await presetEditorController.update(
        message.presetId,
        message.fields
      );
      return { kind: "preset-saved", preset };
    }
    case "delete-preset": {
      await presetEditorController.remove(message.presetId);
      return { kind: "preset-deleted", presetId: message.presetId };
    }
    case "logs":
      return {
        kind: "logs",
        entries: await executionLog.list({ tabId: message.tabId })
      };
    case "clear-logs":
      await executionLog.clear({ tabId: message.tabId });
      return { kind: "clear-logs" };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function getTabUrl(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url === undefined) {
    throw new Error(`Chrome did not expose the URL for tab ${tabId}.`);
  }
  return tab.url;
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
