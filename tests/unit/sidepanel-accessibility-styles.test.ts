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
const tokens = readFileSync(
  new URL("../../src/sidepanel/design-system/tokens.css", import.meta.url),
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
    expect(styles).toContain(".workspace-navigation");
    expect(styles).toContain("repeat(3, minmax(0, 1fr))");
    expect(styles).toContain("@media (min-width: 520px)");
    expect(styles).toContain("grid-template-columns: 72px minmax(0, 1fr)");
  });

  it("protects cards and diagnostics from long unbroken content", () => {
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(styles).toContain("flex: 1 1 0");
    expect(styles).toContain("text-overflow: ellipsis");
    expect(styles).toContain("overflow-wrap: anywhere");
    expect(styles).toContain("word-break: break-word");
    expect(styles).toContain("max-width: 100%");
  });

  it("keeps disabled and global stop actions readable", () => {
    expect(components).toContain(".ui-button--danger:disabled");
    expect(components).toContain("opacity: 0.68");
    expect(styles).toContain(".stop-all-button");
    expect(styles).toContain("width: 100%");
  });

  it("keeps prototype icons crisp and consistently aligned in every control state", () => {
    expect(components).toContain(".ui-icon");
    expect(components).toContain("vector-effect: non-scaling-stroke");
    expect(components).toContain(".ui-button .ui-icon");
    expect(components).toContain(".status-badge");
    expect(components).toContain("white-space: nowrap");
  });

  it("implements the approved light Figma shell and vertical navigation", () => {
    expect(tokens).toContain("color-scheme: light");
    expect(tokens).toContain("--color-accent: #4c3df0");
    expect(styles).toContain("/* Figma high-fidelity side panel");
    expect(styles).toContain("grid-template-columns: 76px minmax(0, 1fr)");
    expect(styles).toContain("flex-direction: column");
    expect(styles).toContain("min-height: 70px");
    expect(styles).toContain(".current-site-card");
    expect(styles).toContain(".automation-card");
  });

  it("keeps automation status details and recent sessions on light surfaces", () => {
    expect(styles).toContain(".automation-session-details > div");
    expect(styles).toContain("background: var(--color-bg-surface)");
    expect(styles).toContain(".current-step {");
    expect(styles).toContain("background: var(--color-info-surface)");
    expect(styles).toContain(".session-outcome.completed");
    expect(styles).toContain("background: var(--color-success-surface)");
    expect(styles).toContain(".session-outcome.stopped");
    expect(styles).toContain("background: var(--color-warning-surface)");
    expect(styles).toContain(".session-outcome.failed");
    expect(styles).toContain("background: var(--color-error-surface)");
  });
});
