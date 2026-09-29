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
        onStopAll={() => undefined}
        repeatCycles={[
          {
            tabId: 7,
            presetId: "preset-1",
            presetName: "Checkout",
            state: "waiting",
            intervalMinutes: 2,
            nextRunAt: Date.UTC(2026, 8, 29, 12, 0, 0)
          }
        ]}
        sessions={[]}
      />
    );

    expect(statusHtml).toContain("Ready to run");
    expect(statusHtml).toContain("Checkout");
    expect(statusHtml).toContain("Recorder is ready");
    expect(sessionsHtml).toContain("Waiting");
    expect(sessionsHtml).toContain("every 2 min");
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
        recorderLogs={[]}
        stepLogs={[]}
      />
    );

    expect(presetsHtml).toContain("No saved presets yet");
    expect(draftHtml).toContain("Loading recorded steps");
    expect(logHtml).toContain("Automation finished");
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
