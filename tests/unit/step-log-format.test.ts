import { describe, expect, it } from "vitest";

import type { StepLogEntry } from "../../src/core/domain/step-log-entry";
import { formatStepLogDetails } from "../../src/sidepanel/features/logs/step-log-format";

describe("step log formatting", () => {
  it("shows step identity, action, target and missing select option", () => {
    const details = formatStepLogDetails(
      createEntry({
        stepType: "select",
        stepName: "Choose country",
        error: {
          code: "step-failed",
          name: "AutomationEngineError",
          message: "Selection failed",
          action: "select",
          reason: "Option was not found",
          target: {
            primary: { type: "css", value: "#country" },
            fallbacks: [{ type: "label", value: "Country", exact: true }]
          },
          selectOption: { by: "value", value: "ca" },
          technicalDetails: "Stack:\nfixture stack"
        }
      })
    );

    expect(details).toContain("Step: 3");
    expect(details).toContain("Type: select");
    expect(details).toContain("Name: Choose country");
    expect(details).toContain("Action: select");
    expect(details).toContain('"value": "#country"');
    expect(details).toContain("Select option:");
    expect(details).toContain('"value": "ca"');
    expect(details).toContain("fixture stack");
  });

  it("shows the invalid pressKey value", () => {
    const details = formatStepLogDetails(
      createEntry({
        stepType: "pressKey",
        error: {
          code: "step-failed",
          name: "AutomationEngineError",
          message: "Unsupported key",
          action: "pressKey",
          reason: "Unsupported pressKey value",
          key: "Ctrl++F13"
        }
      })
    );

    expect(details).toContain("Action: pressKey");
    expect(details).toContain("Key: Ctrl++F13");
  });
});

function createEntry(overrides: Partial<StepLogEntry>): StepLogEntry {
  return {
    id: "log-1",
    recordedAt: "2026-09-29T12:00:00.000Z",
    durationMs: 25,
    sessionId: "session-1",
    presetId: "preset-1",
    tabId: 42,
    stepId: "step-3",
    stepIndex: 2,
    stepNumber: 3,
    stepType: "reload",
    status: "failed",
    ...overrides
  };
}
