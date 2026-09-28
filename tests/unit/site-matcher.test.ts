import { describe, expect, it } from "vitest";

import {
  findActiveAutomationForUrl,
  findAutomationForUrl,
  matchSiteBinding,
  SiteBindingConflictError,
  siteBindingMatchesUrl,
  type SiteBoundAutomation
} from "../../src/core/application/site-matcher";
import type { PresetV1 } from "../../src/core/domain/preset";
import type { SiteBinding } from "../../src/core/domain/site-binding";

const binding: SiteBinding = {
  hostname: "example.com",
  protocols: ["https"]
};

describe("site matcher", () => {
  it("matches the exact hostname and an allowed protocol", () => {
    expect(matchSiteBinding(binding, "https://example.com/products?id=1")).toEqual(
      {
        matches: true,
        hostname: "example.com",
        protocol: "https"
      }
    );
  });

  it.each(["http", "https"])(
    "supports an explicitly allowed %s page",
    (protocol) => {
      expect(
        siteBindingMatchesUrl(
          { hostname: "example.com", protocols: ["http", "https"] },
          `${protocol}://example.com/path`
        )
      ).toBe(true);
    }
  );

  it.each(["www.example.com", "shop.example.com", "other-example.com"])(
    "treats %s as a different hostname",
    (hostname) => {
      expect(matchSiteBinding(binding, `https://${hostname}`)).toEqual({
        matches: false,
        reason: "hostname-mismatch",
        hostname,
        protocol: "https"
      });
    }
  );

  it("compares DNS hostnames case-insensitively through URL normalization", () => {
    expect(siteBindingMatchesUrl(binding, "https://EXAMPLE.COM/path")).toBe(
      true
    );
  });

  it("ignores the port and page path", () => {
    expect(
      siteBindingMatchesUrl(binding, "https://example.com:8443/any/path")
    ).toBe(true);
  });

  it("rejects a protocol that is not allowed by the binding", () => {
    expect(matchSiteBinding(binding, "http://example.com")).toEqual({
      matches: false,
      reason: "protocol-mismatch",
      hostname: "example.com",
      protocol: "http"
    });
  });

  it.each([
    ["chrome://extensions", "chrome"],
    ["file:///C:/page.html", "file"]
  ])("rejects unsupported URL %s", (url, protocol) => {
    expect(matchSiteBinding(binding, url)).toMatchObject({
      matches: false,
      reason: "unsupported-protocol",
      protocol
    });
  });

  it("reports malformed URLs without throwing", () => {
    expect(matchSiteBinding(binding, "not a url")).toEqual({
      matches: false,
      reason: "invalid-url"
    });
  });

  it("finds the automation assigned to the current hostname", () => {
    const automations: SiteBoundAutomation[] = [
      {
        id: "main-site",
        site: { hostname: "example.com", protocols: ["https"] }
      },
      {
        id: "shop-site",
        site: { hostname: "shop.example.com", protocols: ["https"] }
      }
    ];

    expect(
      findAutomationForUrl(automations, "https://shop.example.com/orders")?.id
    ).toBe("shop-site");
    expect(
      findAutomationForUrl(automations, "https://www.example.com")
    ).toBeUndefined();
  });

  it.each([
    ["http://example.com", "main-site"],
    ["http://www.example.com", "www-site"],
    ["http://shop.example.com", "shop-site"]
  ])("resolves %s as an independent site", (url, expectedId) => {
    const automations: SiteBoundAutomation[] = [
      {
        id: "main-site",
        site: { hostname: "example.com", protocols: ["http"] }
      },
      {
        id: "www-site",
        site: { hostname: "www.example.com", protocols: ["http"] }
      },
      {
        id: "shop-site",
        site: { hostname: "shop.example.com", protocols: ["http"] }
      }
    ];

    expect(findAutomationForUrl(automations, url)?.id).toBe(expectedId);
  });

  it("does not return an automation when its protocol is not allowed", () => {
    const automations: SiteBoundAutomation[] = [
      { id: "secure", site: binding }
    ];

    expect(
      findAutomationForUrl(automations, "http://example.com")
    ).toBeUndefined();
  });

  it("reports multiple automations assigned to one hostname", () => {
    const automations: SiteBoundAutomation[] = [
      {
        id: "https-automation",
        site: { hostname: "example.com", protocols: ["https"] }
      },
      {
        id: "http-automation",
        site: { hostname: "example.com", protocols: ["http"] }
      }
    ];

    expect(() =>
      findAutomationForUrl(automations, "https://example.com")
    ).toThrowError(SiteBindingConflictError);

    try {
      findAutomationForUrl(automations, "https://example.com");
    } catch (error) {
      expect(error).toMatchObject({
        name: "SiteBindingConflictError",
        hostname: "example.com",
        automationIds: ["https-automation", "http-automation"]
      });
    }
  });

  it("ignores disabled presets while resolving the active assignment", () => {
    const enabled = createPreset("enabled", true);
    const disabled = createPreset("disabled", false);

    expect(
      findActiveAutomationForUrl(
        [disabled, enabled],
        "https://example.com"
      )?.id
    ).toBe("enabled");
  });

  it("reports two active automations assigned to one hostname", () => {
    expect(() =>
      findActiveAutomationForUrl(
        [createPreset("first", true), createPreset("second", true)],
        "https://example.com"
      )
    ).toThrowError(SiteBindingConflictError);
  });
});

function createPreset(id: string, enabled: boolean): PresetV1 {
  return {
    schemaVersion: 1,
    id,
    name: id,
    createdAt: "2026-09-28T08:00:00.000Z",
    updatedAt: "2026-09-28T08:00:00.000Z",
    site: { hostname: "example.com", protocols: ["https"] },
    automation: {
      defaults: {
        timeoutMs: 1_000,
        postActionDelayMs: 0,
        humanInput: { enabled: false, minDelayMs: 40, maxDelayMs: 120 }
      },
      steps: []
    },
    siteSettings: {
      enabled,
      repeat: { enabled: false, intervalMinutes: 1 }
    }
  };
}
