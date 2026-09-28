import { describe, expect, it } from "vitest";

import { ChromeTabUrlProvider } from "../../src/adapters/chrome/tab-url-provider";

describe("ChromeTabUrlProvider", () => {
  it("returns the current tab URL", async () => {
    const provider = new ChromeTabUrlProvider({
      get: async () => ({ url: "https://example.com/page" })
    });

    await expect(provider.getUrl(7)).resolves.toBe("https://example.com/page");
  });

  it("treats closed and inaccessible tabs as absent", async () => {
    const provider = new ChromeTabUrlProvider({
      get: async () => Promise.reject(new Error("No tab with id"))
    });

    await expect(provider.getUrl(404)).resolves.toBeUndefined();
  });
});
