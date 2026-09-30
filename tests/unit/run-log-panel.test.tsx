import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { StepLogEntry } from "../../src/core/domain/step-log-entry";
import {
  buildRunLogGroups,
  redactRunLogText,
  RunLogPanel
} from "../../src/sidepanel/features/run-log";

describe("RunLogPanel", () => {
  it("renders filters and groups readable events by tab and run", () => {
    const html = renderToStaticMarkup(
      <RunLogPanel
        currentTabId={42}
        cycleLogs={[
          {
            id: "cycle-1",
            recordedAt: "2026-09-30T09:03:00.000Z",
            tabId: 42,
            presetId: "preset-repeat-123456",
            event: "scheduled",
            message: "The next repeat was scheduled.",
            intervalMinutes: 2,
            nextRunAt: Date.parse("2026-09-30T09:05:00.000Z")
          }
        ]}
        notices={[
          {
            id: 1,
            recordedAt: "2026-09-30T09:04:00.000Z",
            status: "success",
            text: "Automation finished."
          }
        ]}
        onClear={() => undefined}
        recorderLogs={[
          {
            id: "recorder-1",
            recordedAt: "2026-09-30T09:02:00.000Z",
            tabId: 42,
            sessionId: "recorder-session-123456",
            event: "action-recorded",
            action: "capture reload",
            recorderEventKind: "reload",
            message: "Reload was added to the draft."
          }
        ]}
        stepLogs={[failedStep()]}
      />
    );

    expect(html).toContain("Filter run log");
    expect(html).toContain(">All<");
    expect(html).toContain(">Success<");
    expect(html).toContain(">Warning<");
    expect(html).toContain(">Error<");
    expect(html).toContain("Tab #42");
    expect(html).toContain("Automation run session-");
    expect(html).toContain("Repeat cycle preset-r");
    expect(html).toContain("Recording recorder");
    expect(html).toContain("Interface events");
    expect(html).toContain("Recorder · Reload");
    expect(html).toContain("Step #2 Choose country failed: Option was not found");
    expect(html).toContain("Technical details");
    expect(html).toContain('dateTime="2026-09-30T09:01:00.000Z"');
    expect(html).toContain("Clear log for current tab");
  });

  it("filters normalized events by Success, Warning and Error", () => {
    const common = {
      currentTabId: 42,
      notices: [],
      stepLogs: [
        failedStep(),
        { ...failedStep(), id: "step-2", status: "skipped" as const, error: undefined }
      ],
      cycleLogs: [],
      recorderLogs: []
    };

    const errorItems = buildRunLogGroups({ ...common, filter: "error" }).flatMap(
      ({ runs }) => runs.flatMap(({ items }) => items)
    );
    const warningItems = buildRunLogGroups({
      ...common,
      filter: "warning"
    }).flatMap(({ runs }) => runs.flatMap(({ items }) => items));
    const successItems = buildRunLogGroups({
      ...common,
      filter: "success"
    }).flatMap(({ runs }) => runs.flatMap(({ items }) => items));

    expect(errorItems).toHaveLength(1);
    expect(errorItems[0]?.severity).toBe("error");
    expect(warningItems).toHaveLength(1);
    expect(warningItems[0]?.severity).toBe("warning");
    expect(successItems).toHaveLength(0);
  });

  it("keeps independent tabs and automation runs in separate groups", () => {
    const groups = buildRunLogGroups({
      notices: [],
      stepLogs: [
        failedStep(),
        {
          ...failedStep(),
          id: "other-tab-step",
          tabId: 99,
          sessionId: "other-run"
        }
      ],
      cycleLogs: [],
      recorderLogs: []
    });

    expect(groups.map(({ label }) => label)).toEqual(["Tab #42", "Tab #99"]);
    expect(groups[0]?.runs[0]?.key).toBe("automation:session-automation-123456");
    expect(groups[1]?.runs[0]?.key).toBe("automation:other-run");
  });

  it("redacts password values before rendering technical diagnostics", () => {
    const secret = "correct-horse-battery-staple";
    const details = redactRunLogText(
      `Payload: {"type":"password","value":"${secret}"}\npassword=${secret}`
    );
    const html = renderToStaticMarkup(
      <RunLogPanel
        currentTabId={42}
        cycleLogs={[]}
        notices={[
          {
            id: 2,
            recordedAt: "2026-09-30T09:04:00.000Z",
            status: "error",
            text: "Unable to fill password field.",
            details
          }
        ]}
        onClear={() => undefined}
        recorderLogs={[]}
        stepLogs={[]}
      />
    );

    expect(html).not.toContain(secret);
    expect(html).toContain("[REDACTED]");
    expect(html).toContain("log-details");
  });
});

function failedStep(): StepLogEntry {
  return {
    id: "step-1",
    recordedAt: "2026-09-30T09:01:00.000Z",
    durationMs: 25,
    sessionId: "session-automation-123456",
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
      technicalDetails: `Stack:\n${"very-long-frame/".repeat(40)}`
    }
  };
}
