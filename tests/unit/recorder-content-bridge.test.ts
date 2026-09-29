import { describe, expect, it, vi } from "vitest";

import { ChromeRecorderContentBridge } from "../../src/adapters/chrome/recorder-content-bridge";
import manifest from "../../public/manifest.json";
import type {
  RecorderContentMessage,
  RecorderContentResponse
} from "../../src/shared/types/recorder-runtime";

describe("ChromeRecorderContentBridge", () => {
  it("injects the loader and retries when an existing tab has no receiver", async () => {
    const sendMessage = vi
      .fn<
        (
          tabId: number,
          message: RecorderContentMessage
        ) => Promise<RecorderContentResponse | undefined>
      >()
      .mockRejectedValueOnce(
        new Error("Could not establish connection. Receiving end does not exist.")
      )
      .mockResolvedValueOnce({
        ok: true,
        result: {
          kind: "started",
          sessionId: "recorder-42",
          alreadyActive: false
        }
      });
    const injectContentScript = vi.fn(async () => undefined);
    const delay = vi.fn(async () => undefined);
    const bridge = new ChromeRecorderContentBridge({
      sendMessage,
      injectContentScript,
      delay,
      retryAttempts: 3,
      retryDelayMs: 25
    });

    await expect(
      bridge.startCapture({
        sessionId: "recorder-42",
        tabId: 42,
        documentId: "document-42",
        url: "http://localhost:4173/playwright-crx-fixture.html"
      })
    ).resolves.toBeUndefined();

    expect(injectContentScript).toHaveBeenCalledOnce();
    expect(injectContentScript).toHaveBeenCalledWith(42);
    expect(delay).toHaveBeenCalledWith(25);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("does not inject for a real content-script command error", async () => {
    const sendMessage = vi.fn(async () => ({
      ok: false as const,
      error: "Unable to initialize DOM capture."
    }));
    const injectContentScript = vi.fn(async () => undefined);
    const bridge = new ChromeRecorderContentBridge({
      sendMessage,
      injectContentScript,
      delay: async () => undefined
    });

    await expect(
      bridge.startCapture({
        sessionId: "recorder-43",
        tabId: 43,
        documentId: "document-43",
        url: "https://example.com/form"
      })
    ).rejects.toMatchObject({
      code: "recorder-unavailable",
      message: "Unable to start recorder capture in tab 43."
    });
    expect(injectContentScript).not.toHaveBeenCalled();
  });

  it("reports loader installation failures with their original cause", async () => {
    const installError = new Error("Cannot access this page");
    const bridge = new ChromeRecorderContentBridge({
      sendMessage: vi.fn(async () => {
        throw new Error(
          "Could not establish connection. Receiving end does not exist."
        );
      }),
      injectContentScript: vi.fn(async () => {
        throw installError;
      }),
      delay: async () => undefined
    });

    await expect(
      bridge.startCapture({
        sessionId: "recorder-44",
        tabId: 44,
        documentId: "document-44",
        url: "https://example.com/form"
      })
    ).rejects.toMatchObject({
      code: "recorder-unavailable",
      message: "Unable to install recorder capture in tab 44.",
      cause: installError
    });
  });

  it("declares the classic loader, module resources and injection permission", () => {
    expect(manifest.permissions).toContain("scripting");
    expect(manifest.host_permissions).toEqual([
      "http://*/*",
      "https://*/*"
    ]);
    expect(manifest.content_scripts[0]?.js).toEqual([
      "content/content-script-loader.js"
    ]);
    expect(manifest.web_accessible_resources[0]?.resources).toEqual([
      "content/content-script.js",
      "assets/*"
    ]);
  });
});
