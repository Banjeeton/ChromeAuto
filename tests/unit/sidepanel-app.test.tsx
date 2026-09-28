import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import App, { createPresetFilename } from "../../src/sidepanel/App";

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
});
