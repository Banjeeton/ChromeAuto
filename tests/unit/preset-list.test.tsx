import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PresetV1 } from "../../src/core/domain/preset";
import {
  filterPresets,
  PresetList
} from "../../src/sidepanel/features/presets";

describe("PresetList", () => {
  it("renders loading, empty and error states", () => {
    expect(render({ status: "loading" })).toContain("Loading presets…");
    expect(render({ status: "ready", presets: [] })).toContain(
      "No saved presets yet."
    );
    expect(
      render({ status: "error", message: "Storage is unavailable." })
    ).toContain("Storage is unavailable.");
  });

  it("shows compact card metadata and enabled state", () => {
    const html = render({
      status: "ready",
      presets: [createPreset(), createPreset({
        id: "550e8400-e29b-41d4-a716-446655440001",
        name: "Disabled shop preset",
        site: { hostname: "shop.example.com", protocols: ["https"] },
        siteSettings: {
          enabled: false,
          repeat: { enabled: false, intervalMinutes: 1 }
        }
      })]
    });

    expect(html).toContain("Example automation");
    expect(html).toContain("example.com");
    expect(html).toContain("Enabled");
    expect(html).toContain("Disabled shop preset");
    expect(html).toContain("shop.example.com");
    expect(html).toContain("Disabled");
    expect(html).toContain("Protocol");
    expect(html).toContain("HTTPS");
    expect(html).toContain("Steps");
  });

  it("exposes all management actions directly from the selected card", () => {
    const preset = createPreset({
      siteSettings: {
        enabled: true,
        repeat: { enabled: true, intervalMinutes: 5 }
      }
    });
    const html = render(
      { status: "ready", presets: [preset] },
      preset.id
    );

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain(">Edit<");
    expect(html).toContain("Duplicate");
    expect(html).toContain(">Export<");
    expect(html).toContain("Delete");
  });

  it("searches by name and hostname and filters by enabled state", () => {
    const enabled = createPreset();
    const disabled = createPreset({
      id: "550e8400-e29b-41d4-a716-446655440001",
      name: "Disabled shop preset",
      site: { hostname: "shop.example.com", protocols: ["https", "http"] },
      siteSettings: {
        enabled: false,
        repeat: { enabled: false, intervalMinutes: 1 }
      }
    });
    const presets = [enabled, disabled];

    expect(filterPresets(presets, "EXAMPLE AUTO", "all")).toEqual([enabled]);
    expect(filterPresets(presets, "shop.example", "all")).toEqual([disabled]);
    expect(filterPresets(presets, "", "enabled")).toEqual([enabled]);
    expect(filterPresets(presets, "", "disabled")).toEqual([disabled]);

    const html = render(
      { status: "ready", presets },
      undefined,
      { query: "shop", filter: "disabled" }
    );
    expect(html).toContain("Disabled shop preset");
    expect(html).not.toContain("Example automation");
    expect(html).toContain("HTTPS / HTTP");
  });

  it("shows a consistent empty result when filters have no matches", () => {
    const html = render(
      { status: "ready", presets: [createPreset()] },
      undefined,
      { query: "missing-host", filter: "enabled" }
    );

    expect(html).toContain("No presets match your search");
    expect(html).toContain("Try another name, hostname or status filter");
  });

  it("requires explicit confirmation before deletion", () => {
    const preset = createPreset();
    const html = render(
      { status: "ready", presets: [preset] },
      preset.id,
      { deleteConfirmationPresetId: preset.id }
    );

    expect(html).toContain("This cannot be undone.");
    expect(html).toContain("Cancel");
    expect(html).toContain("Delete permanently");
  });

  it("keeps long preset names and hostnames available while the layout truncates them", () => {
    const longName = "Checkout automation ".repeat(12).trim();
    const longHostname = `${"very-long-subdomain-".repeat(8)}example.com`;
    const html = render({
      status: "ready",
      presets: [
        createPreset({
          name: longName,
          site: { hostname: longHostname, protocols: ["https"] }
        })
      ]
    });

    expect(html).toContain(`title="${longName}"`);
    expect(html).toContain(`title="${longHostname}"`);
    expect(html).toContain("preset-card-select");
  });
});

function render(
  state: Parameters<typeof PresetList>[0]["state"],
  selectedPresetId?: string,
  overrides: Partial<Parameters<typeof PresetList>[0]> = {}
): string {
  return renderToStaticMarkup(
    <PresetList
      onRetry={vi.fn()}
      onEdit={vi.fn()}
      onDuplicate={vi.fn()}
      onExport={vi.fn()}
      onRequestDelete={vi.fn()}
      onCancelDelete={vi.fn()}
      onConfirmDelete={vi.fn()}
      onSelect={vi.fn()}
      selectedPresetId={selectedPresetId}
      state={state}
      {...overrides}
    />
  );
}

function createPreset(overrides: Partial<PresetV1> = {}): PresetV1 {
  return {
    schemaVersion: 1,
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "Example automation",
    createdAt: "2026-09-28T08:00:00.000Z",
    updatedAt: "2026-09-28T08:00:00.000Z",
    site: { hostname: "example.com", protocols: ["https"] },
    automation: {
      defaults: {
        timeoutMs: 5_000,
        postActionDelayMs: 0,
        humanInput: { enabled: false, minDelayMs: 40, maxDelayMs: 120 }
      },
      steps: [
        {
          id: "wait-ready",
          type: "wait",
          enabled: true,
          condition: { type: "timeout", durationMs: 100 }
        }
      ]
    },
    siteSettings: {
      enabled: true,
      repeat: { enabled: false, intervalMinutes: 1 }
    },
    ...overrides
  };
}
