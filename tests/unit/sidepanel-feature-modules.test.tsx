import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AutomationSessionsPanel,
  AutomationStatusPanel,
  useAutomationController
} from "../../src/sidepanel/features/automation";
import {
  PresetManagementPanel,
  usePresetManagement
} from "../../src/sidepanel/features/presets";
import {
  RecordedDraftPanel,
  useRecorderController
} from "../../src/sidepanel/features/recorder";
import {
  RunLogPanel,
  useRunLogController
} from "../../src/sidepanel/features/run-log";
import { useOperationState } from "../../src/sidepanel/hooks/use-operation-state";

describe("side panel feature modules", () => {
  it("composes independent controller hooks with separate initial state", () => {
    const html = renderToStaticMarkup(<ControllerHarness />);

    expect(html).toContain("operation=idle");
    expect(html).toContain("runtime=empty");
    expect(html).toContain("recorder=empty");
    expect(html).toContain("presets=loading");
    expect(html).toContain("logs=0");
  });

  it("renders runtime, scheduling and recorder state through feature views", () => {
    const statusHtml = renderToStaticMarkup(
      <AutomationStatusPanel
        activeTab={{ id: 7, title: "Fixture", url: "https://example.com" }}
        canRecord={true}
        canRun={true}
        currentTabHasActiveCycle={false}
        manualStatus={{
          state: "ready",
          tabId: 7,
          hostname: "example.com",
          presetId: "preset-1",
          presetName: "Checkout",
          stepCount: 4
        }}
        onRecord={() => undefined}
        onRefresh={() => undefined}
        onRun={() => undefined}
        onStop={() => undefined}
        onStopRecording={() => undefined}
        recorderStatus={{
          tabId: 7,
          state: "idle",
          stepCount: 0,
          canRecord: true,
          canStop: false,
          message: "Recorder is ready."
        }}
      />
    );
    const sessionsHtml = renderToStaticMarkup(
      <AutomationSessionsPanel
        cycleLogs={[
          {
            id: "cycle-failed",
            recordedAt: "2026-09-29T12:02:00.000Z",
            tabId: 9,
            presetId: "preset-failed",
            event: "failed",
            message: "Step #3 failed.",
            error: "Submit button was not found"
          },
          {
            id: "cycle-stopped",
            recordedAt: "2026-09-29T12:01:00.000Z",
            tabId: 10,
            presetId: "preset-stopped",
            event: "stopped",
            message: "Cycle stopped by the user."
          },
          {
            id: "cycle-completed",
            recordedAt: "2026-09-29T12:00:00.000Z",
            tabId: 11,
            presetId: "preset-completed",
            event: "completed",
            message: "Cycle pass completed."
          }
        ]}
        onStopAll={() => undefined}
        onStopTab={() => undefined}
        repeatCycles={[
          {
            tabId: 7,
            presetId: "preset-1",
            presetName: "Checkout",
            hostname: "example.com",
            state: "waiting",
            intervalMinutes: 2,
            nextRunAt: Date.UTC(2026, 8, 29, 12, 0, 0)
          },
          {
            tabId: 8,
            presetId: "preset-2",
            presetName: "Checkout runner",
            hostname: "shop.example.com",
            state: "running",
            intervalMinutes: 5
          }
        ]}
        sessions={[
          {
            sessionId: "session-8",
            presetId: "preset-2",
            tabId: 8,
            status: "running",
            currentStep: {
              stepId: "submit-order",
              stepIndex: 1,
              stepNumber: 2,
              stepType: "click",
              stepName: "Submit order"
            }
          }
        ]}
      />
    );

    expect(statusHtml).toContain("Ready to run");
    expect(statusHtml).toContain("Checkout");
    expect(statusHtml).toContain("Recorder is ready");
    expect(sessionsHtml).toContain("Waiting");
    expect(sessionsHtml).toContain("example.com");
    expect(sessionsHtml).toContain("2 min");
    expect(sessionsHtml).toContain("Next run");
    expect(sessionsHtml).toContain("Current step");
    expect(sessionsHtml).toContain("#2 · click");
    expect(sessionsHtml).toContain("Submit order");
    expect(sessionsHtml).toContain("Stop tab #7");
    expect(sessionsHtml).toContain("completed");
    expect(sessionsHtml).toContain("stopped");
    expect(sessionsHtml).toContain("failed");
    expect(sessionsHtml).toContain("No next run was scheduled");
  });

  it("renders preset, recorder draft and log states in their own modules", () => {
    const presetsHtml = renderToStaticMarkup(
      <PresetManagementPanel
        listState={{ status: "ready", presets: [] }}
        onCancelDelete={() => undefined}
        onCancelEditor={() => undefined}
        onCancelImport={() => undefined}
        onConfirmDelete={() => undefined}
        onDuplicate={() => undefined}
        onEdit={() => undefined}
        onExport={() => undefined}
        onImport={() => undefined}
        onNew={() => undefined}
        onRefresh={() => undefined}
        onRequestDelete={() => undefined}
        onSave={() => undefined}
        onSelect={() => undefined}
      />
    );
    const draftHtml = renderToStaticMarkup(
      <RecordedDraftPanel
        loading={true}
        onCancelConflict={() => undefined}
        onCreatePreset={() => undefined}
        onDiscard={() => undefined}
        onSave={() => undefined}
        status={{
          tabId: 7,
          state: "stopped",
          stepCount: 2,
          canRecord: true,
          canStop: false,
          message: "Recording stopped with 2 steps."
        }}
      />
    );
    const logHtml = renderToStaticMarkup(
      <RunLogPanel
        cycleLogs={[]}
        notices={[
          { id: 1, status: "success", text: "Automation finished." }
        ]}
        onClear={() => undefined}
        recorderLogs={[
          {
            id: "recorder-skip-1",
            recordedAt: "2026-09-30T08:00:00.000Z",
            tabId: 7,
            sessionId: "recorder-7",
            event: "action-skipped",
            action: "skip click",
            message: "Click was not added to the draft. The draft was preserved."
          }
        ]}
        stepLogs={[]}
      />
    );

    expect(presetsHtml).toContain("No saved presets yet");
    expect(draftHtml).toContain("Loading recorded steps");
    expect(logHtml).toContain("Automation finished");
    expect(logHtml).toContain("Recorder · Skip");
    expect(logHtml).toContain("draft was preserved");
  });
});

function ControllerHarness() {
  const operation = useOperationState();
  const logs = useRunLogController();
  const runtime = useAutomationController({
    addNotice: logs.addNotice,
    operation
  });
  const recorder = useRecorderController({
    addNotice: logs.addNotice,
    operation
  });
  const presets = usePresetManagement({
    addNotice: logs.addNotice,
    operation,
    refreshWorkspace: async () => undefined
  });

  return (
    <output>
      {`operation=${operation.busyAction ?? "idle"};`}
      {`runtime=${runtime.manualStatus === undefined ? "empty" : "ready"};`}
      {`recorder=${recorder.status === undefined ? "empty" : "ready"};`}
      {`presets=${presets.listState.status};logs=${logs.notices.length}`}
    </output>
  );
}
