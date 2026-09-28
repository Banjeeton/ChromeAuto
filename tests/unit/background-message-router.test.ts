import { describe, expect, it, vi } from "vitest";
import {
  createBackgroundMessageListener,
  type BackgroundMessageRoute
} from "../../src/background/message-router";

const sender = {} as chrome.runtime.MessageSender;

describe("background message router", () => {
  it("does not claim an unmatched message", () => {
    const route = createRoute(() => false);
    const sendResponse = vi.fn();
    const listener = createBackgroundMessageListener([route]);

    expect(listener({ action: "unknown" }, sender, sendResponse)).toBe(false);
    expect(route.handle).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("keeps the channel open and responds after the matched route resolves", async () => {
    const route = createRoute(() => true, { saved: true });
    const sendResponse = vi.fn();
    const listener = createBackgroundMessageListener([route]);

    expect(listener({ action: "create-preset" }, sender, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        result: { saved: true }
      });
    });
  });

  it("selects only the first matching route", async () => {
    const first = createRoute(() => true, "first");
    const second = createRoute(() => true, "second");
    const sendResponse = vi.fn();
    const listener = createBackgroundMessageListener([first, second]);

    listener({ action: "create-preset" }, sender, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: "first" });
    });
    expect(second.handle).not.toHaveBeenCalled();
  });

  it("turns a rejected handler into the route error response", async () => {
    const error = new Error("storage failed");
    const route = createRoute(() => true);
    vi.mocked(route.handle).mockRejectedValueOnce(error);
    const sendResponse = vi.fn();
    const listener = createBackgroundMessageListener([route]);

    listener({ action: "create-preset" }, sender, sendResponse);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "storage failed"
      });
    });
    expect(route.createErrorResponse).toHaveBeenCalledWith(error, {
      action: "create-preset"
    });
  });
});

function createRoute(
  matches: (message: unknown) => boolean,
  result?: unknown
): BackgroundMessageRoute {
  return {
    matches: vi.fn(matches),
    handle: vi.fn().mockResolvedValue(result),
    createErrorResponse: vi.fn((error: unknown) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }))
  };
}
