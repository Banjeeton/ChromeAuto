import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../../src/sidepanel/styles.css", import.meta.url),
  "utf8"
);
const components = readFileSync(
  new URL("../../src/sidepanel/design-system/components.css", import.meta.url),
  "utf8"
);

describe("side panel accessibility and responsive style contracts", () => {
  it("keeps a visible keyboard focus indicator for native controls", () => {
    expect(styles).toContain(":where(button, input, select, textarea, summary");
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("outline: 2px solid var(--color-info)");
    expect(components).toContain(".ui-modal:focus-visible");
  });

  it("supports the minimum and expanded side panel widths", () => {
    expect(styles).toContain("min-width: 0");
    expect(styles).toContain("overflow-x: hidden");
    expect(styles).toContain("width: min(100%, var(--panel-width))");
    expect(styles).toContain("@media (max-width: 420px)");
    expect(styles).toContain("grid-template-columns: 1fr");
  });

  it("protects cards and diagnostics from long unbroken content", () => {
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(styles).toContain("flex: 1 1 0");
    expect(styles).toContain("text-overflow: ellipsis");
    expect(styles).toContain("overflow-wrap: anywhere");
    expect(styles).toContain("word-break: break-word");
    expect(styles).toContain("max-width: 100%");
  });
});
