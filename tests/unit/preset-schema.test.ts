import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import type { PresetV1 } from "../../src/core/domain/preset";
import {
  assertValidPreset,
  PresetValidationError,
  validatePreset,
  validatePresetForRun,
  validatePresetSemantics,
  validatePresetStructure
} from "../../src/core/domain/preset-validator";
import presetSchema from "../../schemas/preset-v1.schema.json";
import independentTabsTestPresetJson from "../../examples/presets/local-independent-tabs-test.preset.json";
import manualTestPresetJson from "../../examples/presets/local-manual-test.preset.json";
import schedulingRegressionPresetJson from "../../examples/presets/local-scheduling-regression.preset.json";
import validPresetJson from "../fixtures/presets/valid-full.json";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true
});

addFormats(ajv);

const validateSchema = ajv.compile<PresetV1>(presetSchema);

function cloneValidPreset(): PresetV1 {
  return structuredClone(validPresetJson) as PresetV1;
}

describe("preset v1 JSON Schema", () => {
  it("accepts the portable local independent-tabs test preset", () => {
    const preset = structuredClone(independentTabsTestPresetJson) as PresetV1;

    expect(validateSchema(preset), JSON.stringify(validateSchema.errors)).toBe(
      true
    );
    expect(validatePresetSemantics(preset)).toEqual([]);
    expect(validatePresetForRun(preset)).toEqual([]);
  });

  it("accepts the portable local manual-test preset", () => {
    const preset = structuredClone(manualTestPresetJson) as PresetV1;

    expect(validateSchema(preset), JSON.stringify(validateSchema.errors)).toBe(
      true
    );
    expect(validatePresetSemantics(preset)).toEqual([]);
    expect(validatePresetForRun(preset)).toEqual([]);
  });

  it("accepts the portable local scheduling-regression preset", () => {
    const preset = structuredClone(schedulingRegressionPresetJson) as PresetV1;

    expect(validateSchema(preset), JSON.stringify(validateSchema.errors)).toBe(
      true
    );
    expect(validatePresetSemantics(preset)).toEqual([]);
    expect(validatePresetForRun(preset)).toEqual([]);
  });

  it("accepts a complete preset containing every step type", () => {
    const preset = cloneValidPreset();

    expect(validateSchema(preset), JSON.stringify(validateSchema.errors)).toBe(
      true
    );
    expect(validatePresetSemantics(preset)).toEqual([]);
  });

  it("allows an empty step list while a preset is being edited", () => {
    const preset = cloneValidPreset();
    preset.automation.steps = [];

    expect(validateSchema(preset), JSON.stringify(validateSchema.errors)).toBe(
      true
    );
    expect(validatePresetSemantics(preset)).toEqual([]);
  });

  it("rejects an unsupported schema version", () => {
    const preset = structuredClone(validPresetJson) as Record<string, unknown>;
    preset.schemaVersion = 2;

    expect(validateSchema(preset)).toBe(false);
  });

  it("returns a clear JSON path for a missing required property", () => {
    const preset = structuredClone(validPresetJson) as Record<string, unknown>;
    delete preset.name;

    expect(validatePresetStructure(preset)).toContainEqual({
      code: "schema_required",
      path: "/name",
      message: 'Required property "name" is missing.'
    });
  });

  it("rejects unknown properties", () => {
    const preset = structuredClone(validPresetJson) as Record<string, unknown>;
    preset.runtimeState = { nextRunAt: "2026-09-27T12:01:00.000Z" };

    expect(validateSchema(preset)).toBe(false);
    expect(validatePresetStructure(preset)).toContainEqual({
      code: "schema_additionalProperties",
      path: "/runtimeState",
      message: 'Property "runtimeState" is not allowed.'
    });
  });

  it.each([
    "*.example.com",
    "Example.com",
    "https://example.com",
    "example.com/path",
    "example.com:443"
  ])("rejects non-exact hostname %s", (hostname) => {
    const preset = cloneValidPreset();
    preset.site.hostname = hostname;

    expect(validateSchema(preset)).toBe(false);
  });

  it("rejects fields belonging to a different step type", () => {
    const preset = cloneValidPreset();
    const reloadStep = preset.automation.steps.find(
      (step) => step.type === "reload"
    );

    if (reloadStep === undefined) {
      throw new Error("Reload fixture step is missing.");
    }

    Object.assign(reloadStep, { clickCount: 1 });

    expect(validateSchema(preset)).toBe(false);
  });

  it("rejects an empty pressKey value with its JSON path", () => {
    const preset = cloneValidPreset();
    const stepIndex = preset.automation.steps.findIndex(
      (step) => step.type === "pressKey"
    );
    const step = preset.automation.steps[stepIndex];
    if (step?.type !== "pressKey") {
      throw new Error("PressKey fixture step is missing.");
    }
    step.key = "";

    expect(validatePresetStructure(preset)).toContainEqual({
      code: "schema_minLength",
      path: `/automation/steps/${stepIndex}/key`,
      message: "Value must NOT have fewer than 1 characters."
    });
  });

  it.each([
    { type: "timeout", durationMs: 250 },
    { type: "url", match: "contains", value: "/success" },
    { type: "pageLoad", state: "networkidle" }
  ])("accepts wait condition $type", (condition) => {
    const preset = cloneValidPreset();
    const waitStep = preset.automation.steps.find(
      (step) => step.type === "wait"
    );

    if (waitStep === undefined) {
      throw new Error("Wait fixture step is missing.");
    }

    waitStep.condition = condition as typeof waitStep.condition;

    expect(validateSchema(preset), JSON.stringify(validateSchema.errors)).toBe(
      true
    );
  });
});

describe("preset v1 semantic validation", () => {
  it("reports duplicate step ids with a JSON path", () => {
    const preset = cloneValidPreset();
    preset.automation.steps[1].id = preset.automation.steps[0].id;

    expect(validatePresetSemantics(preset)).toContainEqual({
      code: "duplicate_step_id",
      path: "/automation/steps/1/id",
      message: `Step id "${preset.automation.steps[0].id}" must be unique within the preset.`
    });
  });

  it("reports an invalid default human-input range", () => {
    const preset = cloneValidPreset();
    preset.automation.defaults.humanInput.minDelayMs = 200;
    preset.automation.defaults.humanInput.maxDelayMs = 100;

    expect(validatePresetSemantics(preset)).toContainEqual({
      code: "invalid_human_input_range",
      path: "/automation/defaults/humanInput/maxDelayMs",
      message: "maxDelayMs must be greater than or equal to minDelayMs."
    });
  });

  it("reports an invalid per-step human-input range", () => {
    const preset = cloneValidPreset();
    const inputStep = preset.automation.steps.find(
      (step) => step.type === "input"
    );

    if (inputStep === undefined || inputStep.humanInput === undefined) {
      throw new Error("Input fixture step is missing human-input settings.");
    }

    inputStep.humanInput.minDelayMs = 200;
    inputStep.humanInput.maxDelayMs = 100;

    expect(validatePresetSemantics(preset)).toContainEqual({
      code: "invalid_human_input_range",
      path: "/automation/steps/1/humanInput/maxDelayMs",
      message: "maxDelayMs must be greater than or equal to minDelayMs."
    });
  });

  it.each([
    " ",
    "F13",
    "Ctrl+Enter",
    "Enter+Control",
    "Control+Control+A",
    "Control++Enter",
    "DefinitelyNotAKey"
  ])("reports an invalid pressKey value %j", (key) => {
    const preset = cloneValidPreset();
    const stepIndex = preset.automation.steps.findIndex(
      (step) => step.type === "pressKey"
    );
    const step = preset.automation.steps[stepIndex];
    if (step?.type !== "pressKey") {
      throw new Error("PressKey fixture step is missing.");
    }
    step.key = key;

    expect(validatePresetSemantics(preset)).toContainEqual({
      code: "invalid_press_key",
      path: `/automation/steps/${stepIndex}/key`,
      message:
        "key must be a supported key or a combination using Control, Alt, Shift or Meta."
    });
  });

  it.each([
    "Enter",
    "Escape",
    "Tab",
    "ArrowUp",
    "F1",
    "F12",
    "Control+A",
    "Alt+Escape",
    "Shift+Tab",
    "Meta+ArrowRight",
    "Control+Alt+Shift+F5"
  ])("accepts the supported pressKey value %s", (key) => {
    const preset = cloneValidPreset();
    const step = preset.automation.steps.find(
      (candidate) => candidate.type === "pressKey"
    );
    if (step?.type !== "pressKey") {
      throw new Error("PressKey fixture step is missing.");
    }
    step.key = key;

    expect(validatePresetSemantics(preset)).not.toContainEqual(
      expect.objectContaining({ code: "invalid_press_key" })
    );
  });

  it("allows an empty automation to be edited but prevents it from running", () => {
    const preset = cloneValidPreset();
    preset.automation.steps = [];

    expect(validatePresetSemantics(preset)).toEqual([]);
    expect(validatePresetForRun(preset)).toContainEqual({
      code: "empty_automation",
      path: "/automation/steps",
      message: "An automation must contain at least one step before it can run."
    });
  });

  it("runs semantic validation after the schema succeeds", () => {
    const preset = cloneValidPreset();
    preset.automation.steps[1].id = preset.automation.steps[0].id;

    expect(validatePreset(preset)).toContainEqual({
      code: "duplicate_step_id",
      path: "/automation/steps/1/id",
      message: `Step id "${preset.automation.steps[0].id}" must be unique within the preset.`
    });
  });

  it("throws one typed error containing all validation issues", () => {
    const preset = cloneValidPreset();
    preset.automation.defaults.humanInput.minDelayMs = 200;
    preset.automation.defaults.humanInput.maxDelayMs = 100;

    expect(() => assertValidPreset(preset)).toThrowError(
      PresetValidationError
    );

    try {
      assertValidPreset(preset);
    } catch (error) {
      expect(error).toMatchObject({
        name: "PresetValidationError",
        message: expect.stringContaining(
          "/automation/defaults/humanInput/maxDelayMs"
        ),
        issues: [
          expect.objectContaining({
            path: "/automation/defaults/humanInput/maxDelayMs"
          })
        ]
      });
    }
  });
});
