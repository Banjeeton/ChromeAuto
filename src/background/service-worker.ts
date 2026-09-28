import { PlaywrightEngine } from "../adapters/playwright/playwright-engine";
import {
  ChromeAlarmScheduler,
  parseCycleAlarmName
} from "../adapters/chrome/alarm-scheduler";
import { ChromeTabUrlProvider } from "../adapters/chrome/tab-url-provider";
import { ChromeRecorderContentBridge } from "../adapters/chrome/recorder-content-bridge";
import { ChromeRecorderDocumentProvider } from "../adapters/chrome/recorder-document-provider";
import { InMemoryExecutionLog } from "../adapters/logging/in-memory-execution-log";
import { InMemoryRepeatCycleLog } from "../adapters/logging/in-memory-repeat-cycle-log";
import { ChromeRepeatCycleRegistry } from "../adapters/storage/chrome-repeat-cycle-registry";
import { ChromePresetRepository } from "../adapters/storage/chrome-storage";
import { ChromeRecorderSessionRegistry } from "../adapters/storage/chrome-recorder-session-registry";
import {
  exportPresetJson,
  importPresetJsonSafely
} from "../adapters/storage/preset-import-export";
import { AutomationRunner } from "../core/application/automation-runner";
import { AutomationRecorder } from "../core/application/automation-recorder";
import { ManualRunController } from "../core/application/manual-run-controller";
import { RepeatCycleController } from "../core/application/repeat-cycle-controller";
import { RepeatCycleStatusController } from "../core/application/repeat-cycle-status-controller";
import {
  RepeatCycleRecoveryController
} from "../core/application/repeat-cycle-recovery-controller";
import {
  PresetEditorController
} from "../core/application/preset-editor";
import { AutomationRuntimeController } from "../core/application/automation-runtime-controller";
import { RecordedStepMapper } from "../core/application/recorded-step-mapper";
import { RecorderNavigationController } from "../core/application/recorder-navigation-controller";
import { RecorderPanelController } from "../core/application/recorder-panel-controller";
import { TabSessionManager } from "../core/application/tab-session-manager";
import {
  AUTOMATION_RUNTIME_MESSAGE,
  type AutomationRuntimeMessage,
  type AutomationRuntimeResponse,
  type AutomationRuntimeResult
} from "../shared/types/automation-runtime";
import { createRuntimeErrorDetails } from "../shared/utils";
import {
  PLAYWRIGHT_CRX_SPIKE_MESSAGE,
  type PlaywrightSpikeMessage,
  type PlaywrightSpikeResult
} from "../shared/types/playwright-crx-spike";
import { createBackgroundMessageListener } from "./message-router";
import {
  type RecorderEventMessage,
  type RecorderEventReceivedResult,
  isRecorderEventMessage
} from "../shared/types/recorder-runtime";

const playwrightEngine = new PlaywrightEngine();
const tabSessionManager = new TabSessionManager(playwrightEngine);
const executionLog = new InMemoryExecutionLog();
const repeatCycleLog = new InMemoryRepeatCycleLog();
const presetRepository = new ChromePresetRepository(chrome.storage.local);
const presetEditorController = new PresetEditorController(presetRepository);
const recorderSessionRegistry = new ChromeRecorderSessionRegistry();
const recorderContentBridge = new ChromeRecorderContentBridge();
const recorderNavigationController = new RecorderNavigationController(
  recorderSessionRegistry,
  new RecordedStepMapper(),
  recorderContentBridge
);
const automationRunner = new AutomationRunner(
  playwrightEngine,
  tabSessionManager,
  executionLog
);
const cycleScheduler = new ChromeAlarmScheduler();
const repeatCycleRegistry = new ChromeRepeatCycleRegistry();
const automationRecorder = new AutomationRecorder(
  recorderSessionRegistry,
  recorderContentBridge,
  new ChromeRecorderDocumentProvider(),
  {
    isAutomationActive: async (tabId) => {
      if (tabSessionManager.getByTabId(tabId) !== undefined) {
        return true;
      }
      const cycle = await repeatCycleRegistry.getByTabId(tabId);
      return cycle?.state === "running" || cycle?.state === "waiting";
    }
  }
);
const recorderPanelController = new RecorderPanelController(
  automationRecorder,
  recorderSessionRegistry
);
const repeatCycleController = new RepeatCycleController(
  automationRunner,
  cycleScheduler,
  repeatCycleRegistry,
  { log: repeatCycleLog }
);
const repeatCycleStatusController = new RepeatCycleStatusController(
  repeatCycleRegistry,
  presetRepository
);
const runtimeController = new AutomationRuntimeController(
  tabSessionManager,
  repeatCycleController
);
const repeatCycleRecoveryController = new RepeatCycleRecoveryController(
  repeatCycleController,
  cycleScheduler,
  repeatCycleRegistry,
  presetRepository,
  new ChromeTabUrlProvider()
);
const manualRunController = new ManualRunController(
  presetRepository,
  automationRunner,
  tabSessionManager,
  repeatCycleController,
  repeatCycleRegistry,
  recorderSessionRegistry
);

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error("Unable to configure the side panel behavior.", error);
    });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  const identity = parseCycleAlarmName(alarm.name);
  if (identity === undefined) {
    return;
  }

  void repeatCycleRecoveryController
    .handleAlarm({ ...identity, scheduledFor: alarm.scheduledTime })
    .catch((error: unknown) => {
      console.error(
        `Scheduled repeat cycle for tab ${identity.tabId} failed.`,
        error
      );
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url === undefined) {
    return;
  }

  void stopCycleForChangedTab(tabId, changeInfo.url).catch(
    (error: unknown) => {
      console.error(
        `Unable to validate the repeat cycle after tab ${tabId} navigation.`,
        error
      );
    }
  );
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void Promise.all([
    stopCycleForRemovedTab(tabId),
    recorderNavigationController.handleTabRemoved(tabId)
  ]).catch((error: unknown) => {
    console.error(`Unable to clean up tab ${tabId} runtime state.`, error);
  });
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }
  void recorderNavigationController
    .handleNavigationCommitted({
      tabId: details.tabId,
      url: details.url,
      documentId: details.documentId,
      navigationId: details.documentId,
      transitionType: details.transitionType
    })
    .catch((error: unknown) => {
      console.error(
        `Unable to process recorder navigation in tab ${details.tabId}.`,
        error
      );
    });
});

chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }
  void recorderNavigationController
    .handlePageReady({
      tabId: details.tabId,
      url: details.url,
      documentId: details.documentId,
      navigationId: details.documentId
    })
    .catch((error: unknown) => {
      console.error(
        `Unable to restore recorder capture in tab ${details.tabId}.`,
        error
      );
    });
});

// Top-level recovery runs whenever Manifest V3 recreates this service worker.
void repeatCycleRecoveryController.recover().catch((error: unknown) => {
  console.error(
    "Unable to restore repeat cycles after service worker startup.",
    error
  );
});

chrome.runtime.onMessage.addListener(
  createBackgroundMessageListener([
    {
      matches: isRecorderEventMessage,
      handle: async (message) =>
        handleRecorderEventMessage(message as RecorderEventMessage),
      createErrorResponse: (error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    },
    {
      matches: isPlaywrightSpikeMessage,
      handle: (message) =>
        handlePlaywrightSpikeMessage(message as PlaywrightSpikeMessage),
      createErrorResponse: (error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    },
    {
      matches: isAutomationRuntimeMessage,
      handle: (message) =>
        handleAutomationRuntimeMessage(message as AutomationRuntimeMessage),
      createErrorResponse: (error, message) => {
        const action = (message as AutomationRuntimeMessage).action;
        console.error(
          `Automation runtime action “${action}” failed.`,
          error
        );
        const response: AutomationRuntimeResponse = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          details: createRuntimeErrorDetails(action, error)
        };
        return response;
      }
    }
  ])
);

async function handleRecorderEventMessage(
  message: RecorderEventMessage
): Promise<RecorderEventReceivedResult> {
  await recorderNavigationController.record(message.event);
  return {
    kind: "recorder-event-received",
    eventId: message.event.eventId
  };
}

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
      candidate.action === "presets" ||
      candidate.action === "repeat-statuses"
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

  if (candidate.action === "import-preset") {
    return (
      "source" in candidate &&
      typeof candidate.source === "string" &&
      (!("overwriteExistingUpdatedAt" in candidate) ||
        candidate.overwriteExistingUpdatedAt === undefined ||
        typeof candidate.overwriteExistingUpdatedAt === "string")
    );
  }

  if (candidate.action === "export-preset") {
    return (
      "presetId" in candidate && typeof candidate.presetId === "string"
    );
  }

  return (
    (candidate.action === "manual-status" ||
      candidate.action === "run" ||
      candidate.action === "stop" ||
      candidate.action === "logs" ||
      candidate.action === "clear-logs" ||
      candidate.action === "recorder-status" ||
      candidate.action === "record" ||
      candidate.action === "stop-recording") &&
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
    case "recorder-status": {
      const tabUrl = await getTabUrl(message.tabId);
      return {
        kind: "recorder-status",
        status: await recorderPanelController.status(message.tabId, tabUrl)
      };
    }
    case "record": {
      const tabUrl = await getTabUrl(message.tabId);
      return {
        kind: "recorder-status",
        status: await recorderPanelController.start(message.tabId, tabUrl)
      };
    }
    case "stop-recording": {
      const tabUrl = await getTabUrl(message.tabId);
      return {
        kind: "recorder-status",
        status: await recorderPanelController.stop(message.tabId, tabUrl)
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
    case "repeat-statuses":
      return {
        kind: "repeat-statuses",
        statuses: await repeatCycleStatusController.list()
      };
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
    case "import-preset": {
      const result = await importPresetJsonSafely(
        message.source,
        presetRepository,
        message.overwriteExistingUpdatedAt
      );
      if (result.status === "confirmation-required") {
        return {
          kind: "preset-import-confirmation-required",
          incomingPresetId: result.incomingPreset.id,
          incomingPresetName: result.incomingPreset.name,
          existingPresetName: result.existingPreset.name,
          existingUpdatedAt: result.existingPreset.updatedAt
        };
      }
      return { kind: "preset-imported", preset: result.preset };
    }
    case "export-preset": {
      const preset = await presetRepository.getById(message.presetId);
      if (preset === undefined) {
        throw new Error(
          `Preset ${message.presetId} no longer exists and cannot be exported.`
        );
      }
      return {
        kind: "preset-exported",
        presetId: preset.id,
        presetName: preset.name,
        json: exportPresetJson(preset)
      };
    }
    case "logs":
      return {
        kind: "logs",
        entries: await executionLog.list({ tabId: message.tabId }),
        cycleEntries: await repeatCycleLog.list()
      };
    case "clear-logs":
      await Promise.all([
        executionLog.clear({ tabId: message.tabId }),
        repeatCycleLog.clear()
      ]);
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

async function stopCycleForChangedTab(
  tabId: number,
  tabUrl: string
): Promise<void> {
  if (await repeatCycleRecoveryController.handleTabUrlChanged(tabId, tabUrl)) {
    await runtimeController.stopByTabId(tabId);
  }
}

async function stopCycleForRemovedTab(tabId: number): Promise<void> {
  if (await repeatCycleRecoveryController.handleTabRemoved(tabId)) {
    await runtimeController.stopByTabId(tabId);
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
