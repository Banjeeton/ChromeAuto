import { PlaywrightEngine } from "../adapters/playwright/playwright-engine";

type PlaywrightSpikeMessage = {
  type: "playwright-crx/spike";
  action: "snapshot" | "reload" | "detach";
  tabId: number;
};

type PlaywrightSpikeResponse =
  | { ok: true; result?: unknown }
  | { ok: false; error: string };

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
  return (
    candidate.type === "playwright-crx/spike" &&
    (candidate.action === "snapshot" ||
      candidate.action === "reload" ||
      candidate.action === "detach") &&
    typeof candidate.tabId === "number"
  );
}

async function handlePlaywrightSpikeMessage(
  message: PlaywrightSpikeMessage
): Promise<unknown> {
  switch (message.action) {
    case "snapshot":
      return playwrightEngine.snapshot(message.tabId);
    case "reload":
      return playwrightEngine.reload(message.tabId);
    case "detach":
      await playwrightEngine.detach(message.tabId);
      return undefined;
  }
}
