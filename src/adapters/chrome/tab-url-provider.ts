import type { TabUrlProvider } from "../../core/ports/tab-url-provider";

export interface ChromeTabsApi {
  get(tabId: number): Promise<{ readonly url?: string }>;
}

/** Resolves tab URLs while treating a closed/inaccessible tab as absent. */
export class ChromeTabUrlProvider implements TabUrlProvider {
  readonly #tabs: ChromeTabsApi;

  constructor(tabs: ChromeTabsApi = chrome.tabs) {
    this.#tabs = tabs;
  }

  async getUrl(tabId: number): Promise<string | undefined> {
    try {
      return (await this.#tabs.get(tabId)).url;
    } catch {
      return undefined;
    }
  }
}
