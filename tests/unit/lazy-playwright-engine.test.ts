import { describe, expect, it, vi } from "vitest";

import { LazyPlaywrightEngine } from "../../src/adapters/playwright/lazy-playwright-engine";
import type { PlaywrightEngine } from "../../src/adapters/playwright/playwright-engine";

describe("LazyPlaywrightEngine", () => {
  it("does not load Playwright CRX during service construction", () => {
    const loader = vi.fn();

    new LazyPlaywrightEngine(loader);

    expect(loader).not.toHaveBeenCalled();
  });

  it("loads the runtime on first use and reuses it", async () => {
    const runtime = createRuntime();
    const loader = vi.fn(async () => runtime);
    const engine = new LazyPlaywrightEngine(loader);

    await engine.snapshot(11);
    await engine.reload(11);

    expect(loader).toHaveBeenCalledOnce();
    expect(runtime.snapshot).toHaveBeenCalledWith(11);
    expect(runtime.reload).toHaveBeenCalledWith(11);
  });

  it("keeps a runtime import failure recoverable", async () => {
    const failure = new Error("Playwright CRX failed to load");
    const runtime = createRuntime();
    const loader = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(runtime);
    const engine = new LazyPlaywrightEngine(loader);

    await expect(engine.snapshot(7)).rejects.toBe(failure);
    await expect(engine.snapshot(7)).resolves.toEqual({
      tabId: 7,
      title: "Example",
      url: "https://example.com/"
    });

    expect(loader).toHaveBeenCalledTimes(2);
  });
});

function createRuntime(): PlaywrightEngine {
  return {
    start: vi.fn(),
    executeStep: vi.fn(),
    complete: vi.fn(),
    stop: vi.fn(),
    stopAll: vi.fn(),
    snapshot: vi.fn(async (tabId: number) => ({
      tabId,
      title: "Example",
      url: "https://example.com/"
    })),
    reload: vi.fn(async (tabId: number) => ({
      tabId,
      title: "Example",
      url: "https://example.com/"
    })),
    testHtmlModal: vi.fn(),
    detachAll: vi.fn()
  } as unknown as PlaywrightEngine;
}
