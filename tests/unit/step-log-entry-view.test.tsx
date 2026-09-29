import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { StepLogEntry } from "../../src/core/domain/step-log-entry";
import { StepLogEntryView } from "../../src/sidepanel/features/logs/StepLogEntryView";

describe("StepLogEntryView", () => {
  it("renders step identity, readable failure and expandable diagnostics", () => {
    const entry: StepLogEntry = {
      id: "log-1",
      recordedAt: "2026-09-29T12:00:00.000Z",
      durationMs: 25,
      sessionId: "session-1",
      presetId: "preset-1",
      tabId: 42,
      stepId: "select-country",
      stepIndex: 1,
      stepNumber: 2,
      stepType: "select",
      stepName: "Choose country",
      status: "failed",
      error: {
        code: "step-failed",
        name: "AutomationEngineError",
        message: "Selection failed",
        action: "select",
        reason: "Option was not found",
        target: {
          primary: { type: "css", value: "#country" },
          fallbacks: []
        },
        selectOption: { by: "value", value: "ca" },
        technicalDetails: "Stack: fixture"
      }
    };

    const html = renderToStaticMarkup(<StepLogEntryView entry={entry} />);

    expect(html).toContain("Step 2 · select · Choose country");
    expect(html).toContain("select failed: Option was not found");
    expect(html).toContain("<details");
    expect(html).toContain("Technical details");
    expect(html).toContain("#country");
    expect(html).toContain("ca");
    expect(html).toContain("Stack: fixture");
  });
});
