import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RecorderDraftView } from "../../src/core/application/recorder-draft-controller";
import {
  RecordedDraftPanel,
  RecordedStepsEditor
} from "../../src/sidepanel/features/recorder";

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
    expect(html).toContain('aria-label="Enable step 1"');
    expect(html).toContain('aria-label="Delete step 1"');
    expect(html).toContain("Cancel creation");
    expect(html).toContain("Save draft");
    expect(html).toContain("Create preset");
    expect(html).toContain("do not modify saved presets");
    expect(html).toContain("order they were captured");

    const clickPosition = html.indexOf("<strong>click</strong>");
    const inputPosition = html.indexOf("<strong>input</strong>");
    const waitPosition = html.indexOf("<strong>wait</strong>");
    const codePosition = html.indexOf("<strong>customCode</strong>");
    expect(clickPosition).toBeGreaterThan(-1);
    expect(inputPosition).toBeGreaterThan(clickPosition);
    expect(waitPosition).toBeGreaterThan(inputPosition);
    expect(codePosition).toBeGreaterThan(waitPosition);
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

  it("renders editors and add controls for every advanced action", () => {
    const html = renderToStaticMarkup(
      <RecordedStepsEditor
        busy={false}
        draft={advancedDraftView()}
        onCreatePreset={vi.fn()}
        onDiscard={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(html).toContain("4 steps");
    expect(html).toContain('value="select"');
    expect(html).toContain('value="check"');
    expect(html).toContain('value="uncheck"');
    expect(html).toContain('value="pressKey"');
    expect(html).toContain("Selection method");
    expect(html).toContain("Option label");
    expect(html).toContain("Key or shortcut");
    expect(html).toContain("Control+Enter");
    expect(html).toContain("Target a specific element");
    expect(html).toContain("Locators JSON");
    expect(html).toContain("Enabled");
    expect(html).toContain("Delete");
    expect(html).toContain("Move step 4 up");
  });

  it("renders an advanced-field validation path returned by background", () => {
    const html = renderToStaticMarkup(
      <RecordedStepsEditor
        busy={false}
        draft={advancedDraftView()}
        onCreatePreset={vi.fn()}
        onDiscard={vi.fn()}
        onSave={vi.fn()}
        saveError="/automation/steps/3/key: unsupported shortcut"
      />
    );

    expect(html).toContain("/automation/steps/3/key");
    expect(html).toContain("unsupported shortcut");
  });

  it("opens the preserved draft with an understandable hostname-change reason", () => {
    const html = renderToStaticMarkup(
      <RecordedDraftPanel
        draft={draftView()}
        loading={false}
        onCancelConflict={vi.fn()}
        onCreatePreset={vi.fn()}
        onDiscard={vi.fn()}
        onSave={vi.fn()}
        status={{
          tabId: 7,
          state: "stopped",
          stepCount: 4,
          canRecord: true,
          canStop: false,
          hostname: "example.com",
          stopReason: "tab-context-changed",
          message: "Recording stopped because the hostname changed."
        }}
      />
    );

    expect(html).toContain('data-recorder-editor-state="open"');
    expect(html).toContain("left example.com");
    expect(html).toContain("draft was preserved");
  });
});

function advancedDraftView(): RecorderDraftView {
  return {
    tabId: 8,
    sessionId: "recorder-8",
    state: "stopped",
    hostname: "example.com",
    protocol: "https",
    steps: [
      {
        id: "select-country",
        name: "Choose country",
        type: "select",
        enabled: true,
        target: {
          primary: { type: "testId", value: "country" },
          fallbacks: []
        },
        option: { by: "label", value: "Canada" }
      },
      {
        id: "check-terms",
        type: "check",
        enabled: true,
        target: {
          primary: { type: "testId", value: "terms" },
          fallbacks: []
        }
      },
      {
        id: "uncheck-newsletter",
        type: "uncheck",
        enabled: false,
        target: {
          primary: { type: "testId", value: "newsletter" },
          fallbacks: []
        }
      },
      {
        id: "submit-shortcut",
        type: "pressKey",
        enabled: true,
        key: "Control+Enter"
      }
    ]
  };
}

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
