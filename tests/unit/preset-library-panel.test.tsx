import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PresetManagementPanel } from "../../src/sidepanel/features/presets";

describe("PresetManagementPanel library toolbar", () => {
  it("groups search, status filters, import and creation actions", () => {
    const html = renderToStaticMarkup(
      <PresetManagementPanel
        listState={{ status: "ready", presets: [] }}
        onCancelDelete={vi.fn()}
        onCancelEditor={vi.fn()}
        onCancelImport={vi.fn()}
        onConfirmDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onEdit={vi.fn()}
        onExport={vi.fn()}
        onImport={vi.fn()}
        onNew={vi.fn()}
        onRefresh={vi.fn()}
        onRequestDelete={vi.fn()}
        onSave={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(html).toContain('aria-label="Preset library toolbar"');
    expect(html).toContain('aria-label="Search presets"');
    expect(html).toContain("Search by name or hostname");
    expect(html).toContain(">All<");
    expect(html).toContain(">Enabled<");
    expect(html).toContain(">Disabled<");
    expect(html).toContain("Import JSON");
    expect(html).toContain("New preset");
    expect(html).toContain("0 presets");
  });
});
