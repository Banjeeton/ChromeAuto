import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import App, {
  createPresetFilename,
  PresetOverwriteConfirmation
} from "../../src/sidepanel/App";

describe("side panel React entry", () => {
  it("renders the manual automation controls", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Automation Runner");
    expect(html).toContain("Run automation");
    expect(html).toContain("Current site");
    expect(html).toContain("Saved presets");
    expect(html).toContain("Loading presets…");
    expect(html).toContain("Import JSON");
    expect(html).toContain("Running tabs");
    expect(html).toContain(">Stop<");
    expect(html).toContain("Stop All");
  });

  it("creates a safe portable preset filename", () => {
    expect(
      createPresetFilename(
        "My checkout / automation",
        "550e8400-e29b-41d4-a716-446655440000"
      )
    ).toBe("my-checkout-automation-550e8400.preset.json");
    expect(
      createPresetFilename(
        "Автоматизация",
        "550e8400-e29b-41d4-a716-446655440000"
      )
    ).toBe("preset-550e8400.preset.json");
  });

  it("renders an explicit confirmation before import overwrites a preset", () => {
    const html = renderToStaticMarkup(
      <PresetOverwriteConfirmation
        busy={false}
        existingPresetName="Saved checkout"
        incomingPresetName="Imported checkout"
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );

    expect(html).toContain("Saved checkout");
    expect(html).toContain("Imported checkout");
    expect(html).toContain("will be overwritten");
    expect(html).toContain("Replace preset");
    expect(html).toContain("Cancel");
  });
});
