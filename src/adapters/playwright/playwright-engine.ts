import {
  crx,
  type CrxApplication,
  type Page
} from "playwright-crx";

export type PlaywrightPageSnapshot = {
  tabId: number;
  title: string;
  url: string;
};

type CrxRuntime = Pick<typeof crx, "start">;

/**
 * Thin boundary around playwright-crx.
 *
 * The rest of the application must not import playwright-crx directly. The
 * package is experimental for this project and can be replaced without
 * changing the automation domain model.
 */
export class PlaywrightEngine {
  readonly #runtime: CrxRuntime;
  readonly #pages = new Map<number, Page>();
  #applicationPromise?: Promise<CrxApplication>;

  constructor(runtime: CrxRuntime = crx) {
    this.#runtime = runtime;
  }

  async attach(tabId: number): Promise<Page> {
    this.#assertTabId(tabId);

    const attachedPage = this.#pages.get(tabId);
    if (attachedPage) {
      return attachedPage;
    }

    const application = await this.#application();
    const page = await application.attach(tabId);
    this.#pages.set(tabId, page);
    return page;
  }

  async snapshot(tabId: number): Promise<PlaywrightPageSnapshot> {
    const page = await this.attach(tabId);

    return {
      tabId,
      title: await page.title(),
      url: page.url()
    };
  }

  async reload(tabId: number): Promise<PlaywrightPageSnapshot> {
    const page = await this.attach(tabId);
    await page.reload({ waitUntil: "domcontentloaded" });
    return this.snapshot(tabId);
  }

  async detach(tabId: number): Promise<void> {
    this.#assertTabId(tabId);

    if (!this.#pages.has(tabId)) {
      return;
    }

    const application = await this.#application();
    await application.detach(tabId);
    this.#pages.delete(tabId);
  }

  async close(): Promise<void> {
    if (!this.#applicationPromise) {
      return;
    }

    const application = await this.#applicationPromise;
    await application.close();
    this.#pages.clear();
    this.#applicationPromise = undefined;
  }

  async #application(): Promise<CrxApplication> {
    if (!this.#applicationPromise) {
      this.#applicationPromise = this.#runtime.start();

      try {
        const application = await this.#applicationPromise;
        application.on("detached", (tabId) => {
          this.#pages.delete(tabId);
        });
      } catch (error) {
        this.#applicationPromise = undefined;
        throw error;
      }
    }

    return this.#applicationPromise;
  }

  #assertTabId(tabId: number): void {
    if (!Number.isInteger(tabId) || tabId < 0) {
      throw new TypeError(`Invalid Chrome tab id: ${tabId}`);
    }
  }
}
