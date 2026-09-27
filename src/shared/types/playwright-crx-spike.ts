import type {
  HtmlModalSmokeResult,
  PlaywrightPageSnapshot
} from "../../adapters/playwright/playwright-engine";

export const PLAYWRIGHT_CRX_SPIKE_MESSAGE = "playwright-crx/spike" as const;

export type PlaywrightSpikeMessage =
  | {
      type: typeof PLAYWRIGHT_CRX_SPIKE_MESSAGE;
      action: "snapshot" | "reload" | "modal" | "detach";
      tabId: number;
    }
  | {
      type: typeof PLAYWRIGHT_CRX_SPIKE_MESSAGE;
      action: "sessions" | "detach-all";
    };

export type PlaywrightSpikeResult =
  | PlaywrightPageSnapshot
  | HtmlModalSmokeResult
  | number[]
  | undefined;

export type PlaywrightSpikeResponse =
  | { ok: true; result?: PlaywrightSpikeResult }
  | { ok: false; error: string };
