import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PresetV1 } from "../../src/core/domain/preset";
import { PresetList } from "../../src/sidepanel/features/presets";

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

  it("shows preset identity and enabled state", () => {
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
  });

  it("shows details for the selected preset", () => {
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

    expect(html).toContain("Selected preset");
    expect(html).toContain("Steps");
    expect(html).toContain("Every 5 min");
    expect(html).toContain('aria-pressed="true"');
  });
});

function render(
  state: Parameters<typeof PresetList>[0]["state"],
  selectedPresetId?: string
): string {
  return renderToStaticMarkup(
    <PresetList
      onRetry={vi.fn()}
      onEdit={vi.fn()}
      onSelect={vi.fn()}
      selectedPresetId={selectedPresetId}
      state={state}
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
