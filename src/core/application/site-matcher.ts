import type {
  SiteBinding,
  SiteProtocol
} from "../domain/site-binding";

export type SiteMismatchReason =
  | "invalid-url"
  | "unsupported-protocol"
  | "hostname-mismatch"
  | "protocol-mismatch";

export interface SiteMatchSuccess {
  readonly matches: true;
  readonly hostname: string;
  readonly protocol: SiteProtocol;
}

export interface SiteMatchFailure {
  readonly matches: false;
  readonly reason: SiteMismatchReason;
  readonly hostname?: string;
  readonly protocol?: string;
}

export type SiteMatchResult = SiteMatchSuccess | SiteMatchFailure;

export interface SiteBoundAutomation {
  readonly id: string;
  readonly site: SiteBinding;
}

export class SiteBindingConflictError extends Error {
  readonly hostname: string;
  readonly automationIds: readonly string[];

  constructor(hostname: string, automationIds: readonly string[]) {
    super(
      `Hostname ${hostname} is assigned to multiple automations: ${automationIds.join(", ")}`
    );
    this.name = "SiteBindingConflictError";
    this.hostname = hostname;
    this.automationIds = Object.freeze([...automationIds]);
  }
}

/**
 * Matches a validated site binding against the complete URL of a browser tab.
 * Paths, query parameters, fragments and ports do not participate in matching.
 */
export function matchSiteBinding(
  binding: SiteBinding,
  url: string | URL
): SiteMatchResult {
  const location = parseSiteLocation(url);
  if (!location.matches) {
    return location;
  }

  if (location.hostname !== binding.hostname) {
    return {
      matches: false,
      reason: "hostname-mismatch",
      hostname: location.hostname,
      protocol: location.protocol
    };
  }

  if (!binding.protocols.includes(location.protocol)) {
    return {
      matches: false,
      reason: "protocol-mismatch",
      hostname: location.hostname,
      protocol: location.protocol
    };
  }

  return location;
}

export function siteBindingMatchesUrl(
  binding: SiteBinding,
  url: string | URL
): boolean {
  return matchSiteBinding(binding, url).matches;
}

/**
 * Resolves the single automation assigned to a tab URL.
 *
 * A hostname collision is reported even when the colliding bindings allow
 * different protocols: the product invariant is one automation per hostname.
 */
export function findAutomationForUrl<T extends SiteBoundAutomation>(
  automations: readonly T[],
  url: string | URL
): T | undefined {
  const location = parseSiteLocation(url);
  if (!location.matches) {
    return undefined;
  }

  const hostnameAutomations = automations.filter(
    (automation) => automation.site.hostname === location.hostname
  );

  if (hostnameAutomations.length > 1) {
    throw new SiteBindingConflictError(
      location.hostname,
      hostnameAutomations.map((automation) => automation.id)
    );
  }

  const automation = hostnameAutomations[0];
  if (
    automation === undefined ||
    !automation.site.protocols.includes(location.protocol)
  ) {
    return undefined;
  }

  return automation;
}

function parseSiteLocation(url: string | URL): SiteMatchResult {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.toString());
  } catch {
    return { matches: false, reason: "invalid-url" };
  }

  const protocol = toSiteProtocol(parsedUrl.protocol);
  if (protocol === undefined) {
    return {
      matches: false,
      reason: "unsupported-protocol",
      hostname: parsedUrl.hostname || undefined,
      protocol: parsedUrl.protocol.replace(/:$/, "")
    };
  }

  return {
    matches: true,
    hostname: parsedUrl.hostname,
    protocol
  };
}

function toSiteProtocol(protocol: string): SiteProtocol | undefined {
  if (protocol === "http:" || protocol === "https:") {
    return protocol.slice(0, -1) as SiteProtocol;
  }
  return undefined;
}
