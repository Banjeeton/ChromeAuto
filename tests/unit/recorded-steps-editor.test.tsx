import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RecorderDraftView } from "../../src/core/application/recorder-draft-controller";
import { RecordedStepsEditor } from "../../src/sidepanel/features/recorder";

describe("RecordedStepsEditor", () => {
  it("renders controls for reviewing and editing a stopped draft", () => {
    const html = renderToStaticMarkup(
      <RecordedStepsEditor
        busy={false}
        draft={draftView()}
        onCreatePreset={vi.fn()}
        onDiscard={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(html).toContain("Review recorded steps");
    expect(html).toContain("Portable preset");
    expect(html).toContain("Preset name");
    expect(html).toContain("4 steps");
    expect(html).toContain("Step name");
    expect(html).toContain("Locators JSON");
    expect(html).toContain("Input value");
    expect(html).toContain("Wait duration, ms");
    expect(html).toContain("JavaScript");
    expect(html).toContain("customCode");
    expect(html).toContain("Delete");
    expect(html).toContain("Cancel creation");
    expect(html).toContain("Save draft");
    expect(html).toContain("Create preset");
    expect(html).toContain("do not modify saved presets");
  });

  it("renders a validation error returned by background", () => {
    const html = renderToStaticMarkup(
      <RecordedStepsEditor
        busy={false}
        draft={draftView()}
        onCreatePreset={vi.fn()}
        onDiscard={vi.fn()}
        onSave={vi.fn()}
        saveError="/automation/steps/0/target: invalid locator"
      />
    );

    expect(html).toContain("/automation/steps/0/target");
  });
});

function draftView(): RecorderDraftView {
  return {
    tabId: 7,
    sessionId: "recorder-7",
    state: "stopped",
    hostname: "example.com",
    protocol: "https",
    steps: [
      {
        id: "click-submit",
        name: "Submit form",
        type: "click",
        enabled: true,
        target: {
          primary: { type: "testId", value: "submit" },
          fallbacks: []
        },
        button: "left",
        clickCount: 1
      },
      {
        id: "input-email",
        type: "input",
        enabled: true,
        target: {
          primary: { type: "label", value: "Email", exact: true },
          fallbacks: []
        },
        value: "user@example.com",
        clearFirst: true,
        inputMode: "default"
      },
      {
        id: "wait-page",
        type: "wait",
        enabled: true,
        condition: { type: "timeout", durationMs: 500 }
      },
      {
        id: "custom-title",
        type: "customCode",
        enabled: true,
        language: "javascript",
        apiVersion: 1,
        executionContext: "page",
        source: "automation.log(document.title);"
      }
    ]
  };
}
