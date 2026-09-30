import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import App, {
  createPresetFilename,
  getWorkspaceState,
  PresetOverwriteConfirmation,
  sendRuntimeMessage
} from "../../src/sidepanel/App";
import { AUTOMATION_RUNTIME_MESSAGE } from "../../src/shared/types/automation-runtime";

describe("side panel React entry", () => {
  it("renders the manual automation controls", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Automation</h1>");
    expect(html).toContain('aria-label="Side panel sections"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Dashboard"');
    expect(html).toContain('aria-label="Presets and editor"');
    expect(html).toContain('aria-label="Run log"');
    expect(html).toContain(">Run<");
    expect(html).toContain(">Record<");
    expect(html).toContain("Unavailable");
    expect(html).toContain("No active browser tab was found");
    expect(html).toContain("Current site");
    expect(html).toContain("Saved presets");
    expect(html).toContain("Loading presets…");
    expect(html).toContain("Import JSON");
    expect(html).toContain("Automation status");
    expect(html).toContain(">Stop<");
    expect(html).toContain("Stop All");
    expect(html).toContain("workspace-main");
    expect(html).toContain("workspace-brand__mark");
    expect(html).toContain("workspace-settings");
  });

  it("maps all approved workspace states without mixing runtime contexts", () => {
    expect(getWorkspaceState("ready", "idle")).toBe("Ready");
    expect(getWorkspaceState("running", "idle")).toBe("Running");
    expect(getWorkspaceState("waiting", "idle")).toBe("Waiting");
    expect(getWorkspaceState("stopped", "idle")).toBe("Stopped");
    expect(getWorkspaceState("failed", "idle")).toBe("Failed");
    expect(getWorkspaceState("ready", "recording")).toBe("Recording");
    expect(getWorkspaceState("running", "failed")).toBe("Failed");
    expect(getWorkspaceState("unavailable", "idle", "preset-disabled")).toBe(
      "Disabled"
    );
    expect(getWorkspaceState("unavailable", "idle", "no-preset")).toBe(
      "Unavailable"
    );
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

  it("fails a runtime request instead of waiting forever", async () => {
    await expect(
      sendRuntimeMessage(
        {
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "presets"
        },
        {
          timeoutMs: 5,
          sender: () => new Promise(() => undefined)
        }
      )
    ).rejects.toThrow(
      /Background did not respond to .*presets.* within 5 ms/
    );
  });

  it("returns a runtime response before the timeout", async () => {
    await expect(
      sendRuntimeMessage(
        {
          type: AUTOMATION_RUNTIME_MESSAGE,
          action: "presets"
        },
        {
          timeoutMs: 50,
          sender: async () => ({
            ok: true,
            result: { kind: "presets", presets: [] }
          })
        }
      )
    ).resolves.toEqual({
      ok: true,
      result: { kind: "presets", presets: [] }
    });
  });
});
