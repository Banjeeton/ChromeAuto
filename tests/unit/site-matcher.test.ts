import { describe, expect, it } from "vitest";

import {
  findAutomationForUrl,
  matchSiteBinding,
  SiteBindingConflictError,
  siteBindingMatchesUrl,
  type SiteBoundAutomation
} from "../../src/core/application/site-matcher";
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
});
