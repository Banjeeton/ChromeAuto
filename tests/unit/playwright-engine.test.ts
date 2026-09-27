import type { CrxApplication, Page } from "playwright-crx";
import { describe, expect, it, vi } from "vitest";

import { PlaywrightEngine } from "../../src/adapters/playwright/playwright-engine";

vi.mock("playwright-crx", () => ({
  crx: { start: vi.fn() }
}));

describe("PlaywrightEngine", () => {
  it("attaches a tab once and returns its page snapshot", async () => {
    const page = createPage();
    const application = createApplication(page);
    const start = vi.fn(async () => application);
    const engine = new PlaywrightEngine({ start });

    await expect(engine.snapshot(42)).resolves.toEqual({
      tabId: 42,
      title: "Example",
      url: "https://example.com/"
    });
    await engine.snapshot(42);

    expect(start).toHaveBeenCalledOnce();
    expect(application.attach).toHaveBeenCalledOnce();
    expect(application.attach).toHaveBeenCalledWith(42);
  });

  it("reloads an attached page and waits for DOM content", async () => {
    const page = createPage();
    const application = createApplication(page);
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });

    await engine.reload(7);

    expect(page.reload).toHaveBeenCalledWith({
      waitUntil: "domcontentloaded"
    });
  });

  it("detaches only tabs attached by this engine", async () => {
    const page = createPage();
    const application = createApplication(page);
    const engine = new PlaywrightEngine({
      start: vi.fn(async () => application)
    });

    await engine.detach(8);
    await engine.attach(8);
    await engine.detach(8);
    await engine.detach(8);

    expect(application.detach).toHaveBeenCalledOnce();
    expect(application.detach).toHaveBeenCalledWith(8);
  });

  it("rejects invalid Chrome tab ids", async () => {
    const engine = new PlaywrightEngine({ start: vi.fn() });

    await expect(engine.attach(-1)).rejects.toThrow("Invalid Chrome tab id");
    await expect(engine.attach(1.5)).rejects.toThrow("Invalid Chrome tab id");
  });
});

function createPage(): Page {
  return {
    title: vi.fn(async () => "Example"),
    url: vi.fn(() => "https://example.com/"),
    reload: vi.fn(async () => null)
  } as unknown as Page;
}

function createApplication(page: Page): CrxApplication {
  return {
    attach: vi.fn(async () => page),
    detach: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    on: vi.fn(function (this: CrxApplication) {
      return this;
    })
  } as unknown as CrxApplication;
}
