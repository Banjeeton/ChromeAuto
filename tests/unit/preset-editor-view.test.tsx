import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  createPresetEditorDefaults,
  createPresetV1
} from "../../src/core/application/preset-editor";
import { assertValidPreset } from "../../src/core/domain/preset-validator";
import { PresetEditor } from "../../src/sidepanel/features/presets";
import {
  createStepTemplate,
  STEP_TYPES
} from "../../src/sidepanel/features/presets/step-template";

describe("PresetEditor", () => {
  it("renders editable metadata, site settings and step sequence", () => {
    const fields = createPresetEditorDefaults("example.com");
    fields.name = "Example automation";
    fields.automation.steps.push(
      createStepTemplate("wait", "wait-for-page")
    );

    const html = renderToStaticMarkup(
      <PresetEditor
        initialFields={fields}
        mode="edit"
        onCancel={vi.fn()}
        onSave={vi.fn()}
        saving={false}
      />
    );

    expect(html).toContain("Editing preset");
    expect(html).toContain("Example automation");
    expect(html).toContain("example.com");
    expect(html).toContain("Automation defaults");
    expect(html).toContain("Step sequence");
    expect(html).toContain("wait-for-page");
    expect(html).toContain("Save changes");
  });

  it("shows validation failures returned by the save operation", () => {
    const html = renderToStaticMarkup(
      <PresetEditor
        initialFields={createPresetEditorDefaults()}
        mode="create"
        onCancel={vi.fn()}
        onSave={vi.fn()}
        saveError="Preset validation failed at /name."
        saving={false}
      />
    );

    expect(html).toContain("Create preset");
    expect(html).toContain("Preset validation failed at /name.");
  });

  it("explains the hostname requirement when duplicating", () => {
    const fields = createPresetEditorDefaults();
    fields.name = "Example automation copy";
    const html = renderToStaticMarkup(
      <PresetEditor
        initialFields={fields}
        mode="duplicate"
        onCancel={vi.fn()}
        onSave={vi.fn()}
        saving={false}
      />
    );

    expect(html).toContain("Duplicate preset");
    expect(html).toContain("Choose a different hostname");
    expect(html).toContain("Save duplicate");
  });
});

describe("preset step templates", () => {
  it("provides a valid initial object for every preset v1 step type", () => {
    const steps = STEP_TYPES.map((type, index) =>
      createStepTemplate(type, `step-${index + 1}`)
    );

    expect(steps.map((step) => step.type)).toEqual(STEP_TYPES);
    expect(steps.every((step) => step.enabled)).toBe(true);
    expect(new Set(steps.map((step) => step.id)).size).toBe(STEP_TYPES.length);

    const fields = createPresetEditorDefaults("example.com");
    fields.name = "All step templates";
    fields.automation.steps = steps;
    const preset = createPresetV1(fields, {
      createId: () => "550e8400-e29b-41d4-a716-446655440000",
      now: () => new Date("2026-09-28T08:00:00.000Z")
    });
    expect(() => assertValidPreset(preset)).not.toThrow();
  });
});
