import { PlaywrightEngine } from "../adapters/playwright/playwright-engine";
import {
  PLAYWRIGHT_CRX_SPIKE_MESSAGE,
  type PlaywrightSpikeMessage,
  type PlaywrightSpikeResponse,
  type PlaywrightSpikeResult
} from "../shared/types/playwright-crx-spike";

const playwrightEngine = new PlaywrightEngine();

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
    case "snapshot":
      return playwrightEngine.snapshot(message.tabId);
    case "reload":
      return playwrightEngine.reload(message.tabId);
    case "modal":
      return playwrightEngine.testHtmlModal(message.tabId);
    case "detach":
      await playwrightEngine.detach(message.tabId);
      return undefined;
    case "sessions":
      return playwrightEngine.attachedTabIds();
    case "detach-all":
      await playwrightEngine.detachAll();
      return undefined;
  }
}
