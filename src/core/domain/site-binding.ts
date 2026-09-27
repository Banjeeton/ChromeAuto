export type SiteProtocol = "http" | "https";

/**
 * Exact site binding for one preset.
 *
 * Hostnames are normalized to lowercase before a preset is stored. Wildcards,
 * paths and ports are intentionally not part of the v1 contract.
 */
export interface SiteBinding {
  hostname: string;
  protocols: SiteProtocol[];
}
