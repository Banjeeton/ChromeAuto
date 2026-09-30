import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  createPresetEditorDefaults,
  createPresetV1
} from "../../src/core/application/preset-editor";
import { assertValidPreset } from "../../src/core/domain/preset-validator";
import {
  duplicateAutomationStep,
  isPresetEditorDirty,
  PresetEditor,
  validatePresetEditorFields
} from "../../src/sidepanel/features/presets";
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
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="preset-field-error-name"');
    expect(html).toContain('id="preset-field-error-name"');
    expect(html).toContain('role="alert"');
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

  it("constrains a 120-character preset name inside the editor heading", () => {
    const fields = createPresetEditorDefaults("example.com");
    fields.name = "Long preset name ".repeat(8).slice(0, 120);

    const html = renderToStaticMarkup(
      <PresetEditor
        initialFields={fields}
        mode="edit"
        onCancel={vi.fn()}
        onSave={vi.fn()}
        saving={false}
      />
    );

    expect(fields.name).toHaveLength(120);
    expect(html).toContain(`title="${fields.name}"`);
    expect(html).toContain("editor-heading");
  });

  it("renders every preset v1 step as a structured card without Steps JSON", () => {
    const fields = createPresetEditorDefaults("example.com");
    fields.name = "Complete automation";
    fields.automation.steps = STEP_TYPES.map((type, index) =>
      createStepTemplate(type, `existing-${index + 1}`)
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

    expect(html).not.toContain("Steps JSON");
    expect(html.match(/structured-step-card/g)).toHaveLength(STEP_TYPES.length);
    expect(html.match(/<details/g)).toHaveLength(STEP_TYPES.length);
    expect(html).toContain("Enabled");
    expect(html).toContain("Mouse button");
    expect(html).toContain("Input value");
    expect(html).toContain("Selection method");
    expect(html).toContain("Key or shortcut");
    expect(html).toContain("Wait condition");
    expect(html).toContain("Wait until");
    expect(html).toContain("JavaScript");
    expect(html).toContain("Timeout override, ms");
    expect(html).toContain("Post-action delay, ms");
    expect(html).toContain("Delete step 9");
    expect(html).toContain("Duplicate step 9");
  });

  it("opens existing primary and fallback locators as structured fields", () => {
    const fields = createPresetEditorDefaults("example.com");
    fields.name = "Existing preset";
    fields.automation.steps = [{
      ...createStepTemplate("click", "existing-click"),
      name: "Submit order",
      target: {
        primary: { type: "testId", value: "submit-order" },
        fallbacks: [
          { type: "role", role: "button", name: "Submit", exact: true },
          { type: "text", value: "Submit", exact: false }
        ]
      },
      timeoutMs: 2_500,
      postActionDelayMs: 100
    }];

    const html = renderToStaticMarkup(
      <PresetEditor
        initialFields={fields}
        mode="edit"
        onCancel={vi.fn()}
        onSave={vi.fn()}
        saving={false}
      />
    );

    expect(html).toContain("Submit order");
    expect(html).toContain("submit-order");
    expect(html).toContain("Fallback 1");
    expect(html).toContain("Fallback 2");
    expect(html).toContain("ARIA role");
    expect(html).toContain("Accessible name");
    expect(html).toContain('value="2500"');
    expect(html).toContain('value="100"');
  });

  it("returns full validation issues with the concrete step field path", () => {
    const fields = createPresetEditorDefaults(" EXAMPLE.COM ");
    fields.name = " Valid preset ";
    fields.automation.steps = [{
      ...createStepTemplate("pressKey", "invalid-key"),
      key: "Control+DefinitelyNotAKey"
    }];

    const result = validatePresetEditorFields(fields);

    expect(result.fields.name).toBe("Valid preset");
    expect(result.fields.site.hostname).toBe("example.com");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        path: "/automation/steps/0/key",
        code: "invalid_press_key"
      })
    );
  });

  it("renders every wait condition and per-input human delay controls", () => {
    const fields = createPresetEditorDefaults("example.com");
    fields.name = "Wait and input settings";
    fields.automation.steps = [
      {
        ...createStepTemplate("wait", "wait-timeout"),
        condition: { type: "timeout", durationMs: 1_500 }
      },
      {
        ...createStepTemplate("wait", "wait-element"),
        condition: {
          type: "element",
          state: "hidden",
          target: {
            primary: { type: "css", value: ".spinner" },
            fallbacks: []
          }
        }
      },
      {
        ...createStepTemplate("wait", "wait-url"),
        condition: {
          type: "url",
          match: "regex",
          value: "example\\.com/(done|success)"
        }
      },
      {
        ...createStepTemplate("wait", "wait-page"),
        condition: { type: "pageLoad", state: "networkidle" }
      },
      {
        ...createStepTemplate("input", "human-input"),
        inputMode: "human",
        humanInput: { minDelayMs: 55, maxDelayMs: 140 }
      }
    ];

    const html = renderToStaticMarkup(
      <PresetEditor
        initialFields={fields}
        mode="edit"
        onCancel={vi.fn()}
        onSave={vi.fn()}
        saving={false}
      />
    );

    expect(html).toContain("Duration, ms");
    expect(html).toContain("Element state");
    expect(html).toContain("Attached");
    expect(html).toContain("Detached");
    expect(html).toContain("Visible");
    expect(html).toContain("Hidden");
    expect(html).toContain("URL match");
    expect(html).toContain("Exact");
    expect(html).toContain("Contains");
    expect(html).toContain("Regular expression");
    expect(html).toContain("Load state");
    expect(html).toContain("DOM content loaded");
    expect(html).toContain("Network idle");
    expect(html).toContain("Input mode");
    expect(html).toContain("Default");
    expect(html).toContain("Instant");
    expect(html).toContain("Human");
    expect(html).toContain("Min typing delay, ms");
    expect(html).toContain("Max typing delay, ms");
    expect(html).toContain('value="55"');
    expect(html).toContain('value="140"');
  });

  it("blocks invalid input delays and URL regex with concrete field paths", () => {
    const fields = createPresetEditorDefaults("example.com");
    fields.name = "Invalid advanced settings";
    fields.automation.steps = [
      {
        ...createStepTemplate("input", "invalid-delays"),
        humanInput: { minDelayMs: 200, maxDelayMs: 20 }
      },
      {
        ...createStepTemplate("wait", "invalid-regex"),
        condition: { type: "url", match: "regex", value: "[invalid" }
      }
    ];

    const { issues } = validatePresetEditorFields(fields);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_human_input_range",
          path: "/automation/steps/0/humanInput/maxDelayMs"
        }),
        expect.objectContaining({
          code: "invalid_url_regex",
          path: "/automation/steps/1/condition/value"
        })
      ])
    );
  });

  it("shows preset validity and field errors next to the invalid step field", () => {
    const fields = createPresetEditorDefaults("example.com");
    fields.name = "Invalid shortcut";
    fields.automation.steps = [{
      ...createStepTemplate("pressKey", "invalid-key"),
      key: "Control+DefinitelyNotAKey"
    }];

    const html = renderToStaticMarkup(
      <PresetEditor
        initialFields={fields}
        mode="edit"
        onCancel={vi.fn()}
        onSave={vi.fn()}
        saving={false}
      />
    );

    expect(html).toContain("1 issue");
    expect(html).toContain("Resolve 1 validation issue before saving.");
    expect(html).toContain('data-error-path="/automation/steps/0/key"');
    expect(html).toContain("DefinitelyNotAKey");
  });

  it("detects whether the editor contains unsaved changes", () => {
    const initial = createPresetEditorDefaults("example.com");
    const unchanged = structuredClone(initial);
    const changed = structuredClone(initial);
    changed.name = "Changed name";

    expect(isPresetEditorDirty(initial, unchanged)).toBe(false);
    expect(isPresetEditorDirty(initial, changed)).toBe(true);
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

  it("duplicates a step deeply while assigning a new id", () => {
    const original = {
      ...createStepTemplate("click", "source-step"),
      name: "Submit order",
      target: {
        primary: { type: "testId" as const, value: "submit-order" },
        fallbacks: [{ type: "css" as const, value: "button.submit" }]
      }
    };

    const duplicate = duplicateAutomationStep(original, () => "duplicate-step");

    expect(duplicate).toEqual({ ...original, id: "duplicate-step" });
    expect(duplicate).not.toBe(original);
    if (duplicate.type === "click") {
      duplicate.target.fallbacks[0] = {
        type: "text",
        value: "Changed",
        exact: true
      };
    }
    expect(original.target.fallbacks[0]).toEqual({
      type: "css",
      value: "button.submit"
    });
  });
});
