import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DashboardPanel,
  type DashboardPanelProps
} from "../../src/sidepanel/features/dashboard";

describe("current-site Dashboard", () => {
  it("shows the current hostname, protocol, title and assigned preset", () => {
    const html = renderDashboard({
      activeTab: {
        id: 11,
        title: "Checkout fixture",
        url: "https://shop.example.com/checkout"
      },
      manualStatus: {
        state: "ready",
        tabId: 11,
        hostname: "shop.example.com",
        presetId: "checkout",
        presetName: "Checkout automation",
        stepCount: 4
      },
      recorderStatus: idleRecorder(11),
      canRun: true,
      canRecord: true
    });

    expect(html).toContain("Ready");
    expect(html).toContain("shop.example.com");
    expect(html).toContain("HTTPS");
    expect(html).toContain("Checkout fixture");
    expect(html).toContain("Checkout automation");
    expect(html).toContain("4 steps");
    expect(html).toContain(">Run<");
    expect(html).toContain(">Record<");
    expect(html).toContain(">Stop<");
    expect(html).toContain(">Stop All<");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
  });

  it("renders Running, Waiting and Recording as distinct current-tab states", () => {
    const running = renderDashboard({
      activeTab: tab(21),
      busyAction: "run",
      manualStatus: {
        state: "running",
        tabId: 21,
        hostname: "example.com",
        presetId: "preset-1",
        presetName: "Runtime preset",
        sessionId: "session-1"
      },
      recorderStatus: idleRecorder(21),
      currentTabHasActiveCycle: true
    });
    const waiting = renderDashboard({
      activeTab: tab(22),
      manualStatus: {
        state: "waiting",
        tabId: 22,
        hostname: "example.com",
        presetId: "preset-2",
        presetName: "Scheduled preset",
        nextRunAt: Date.UTC(2026, 8, 30, 12, 0, 0)
      },
      recorderStatus: idleRecorder(22),
      currentTabHasActiveCycle: true
    });
    const recording = renderDashboard({
      activeTab: tab(23),
      manualStatus: {
        state: "unavailable",
        tabId: 23,
        hostname: "example.com",
        reason: "recording-active",
        message: "Stop recording before running automation."
      },
      recorderStatus: {
        tabId: 23,
        state: "recording",
        stepCount: 3,
        canRecord: false,
        canStop: true,
        message: "Recording 3 steps."
      }
    });

    expect(running).toContain("Running");
    expect(running).toContain("is running in this tab");
    expect(running).toMatch(/<button(?![^>]*disabled)[^>]*>Stop<\/button>/);
    expect(waiting).toContain("Waiting");
    expect(waiting).toContain("waiting for its next run");
    expect(recording).toContain("Recording");
    expect(recording).toContain("Recording 3 steps");
    expect(recording).toContain("Recording example.com");
    expect(recording).toContain("recorder-step-counter");
    expect(recording).toContain("<strong>3</strong><span>steps</span>");
    expect(recording).toContain("record-button");
    expect(recording).toContain(">Stop recording<");
  });

  it("explains missing presets and prohibited pages", () => {
    const noPreset = renderDashboard({
      activeTab: tab(31),
      manualStatus: {
        state: "unavailable",
        tabId: 31,
        hostname: "example.com",
        reason: "no-preset",
        message: "No automation is assigned to example.com."
      },
      recorderStatus: idleRecorder(31)
    });
    const prohibited = renderDashboard({
      activeTab: {
        id: 32,
        title: "Extensions",
        url: "chrome://extensions/"
      },
      manualStatus: {
        state: "unavailable",
        tabId: 32,
        reason: "unsupported-url",
        message: "Automations can only run on HTTP or HTTPS pages."
      },
      recorderStatus: {
        ...idleRecorder(32),
        canRecord: false,
        message: "Recording is only available on HTTP or HTTPS pages.",
        unavailableReason: "unsupported-url"
      }
    });

    expect(noPreset).toContain("Unavailable");
    expect(noPreset).toContain("No preset assigned");
    expect(noPreset).toContain("No automation is assigned to example.com");
    expect(prohibited).toContain("CHROME");
    expect(prohibited).toContain("Extensions");
    expect(prohibited).toContain("Automations can only run on HTTP or HTTPS pages");
  });

  it("warns before running a preset containing custom JavaScript", () => {
    const html = renderDashboard({
      activeTab: tab(35),
      manualStatus: {
        state: "ready",
        tabId: 35,
        hostname: "example.com",
        presetId: "custom-preset",
        presetName: "Trusted custom preset",
        stepCount: 1,
        hasCustomCode: true
      },
      recorderStatus: idleRecorder(35),
      canRun: true
    });

    expect(html).toContain("This preset contains custom JavaScript");
    expect(html).toContain("Run only code you trust");
    expect(html).toContain("dashboard-custom-code-warning");
  });

  it("does not mix status from a previously active tab", () => {
    const html = renderDashboard({
      activeTab: {
        id: 42,
        title: "New tab",
        url: "https://new.example.com/page"
      },
      manualStatus: {
        state: "ready",
        tabId: 41,
        hostname: "old.example.com",
        presetId: "old-preset",
        presetName: "Old tab preset",
        stepCount: 8
      },
      recorderStatus: {
        tabId: 41,
        state: "recording",
        stepCount: 9,
        canRecord: false,
        canStop: true,
        message: "Old tab is recording."
      }
    });

    expect(html).toContain("new.example.com");
    expect(html).toContain("New tab");
    expect(html).toContain("Checking the active tab");
    expect(html).not.toContain("old.example.com");
    expect(html).not.toContain("Old tab preset");
    expect(html).not.toContain("Old tab is recording");
  });
});

function renderDashboard(
  overrides: Partial<DashboardPanelProps> = {}
): string {
  const props: DashboardPanelProps = {
    activeTab: tab(1),
    busyAction: undefined,
    canRun: false,
    canRecord: false,
    currentTabHasActiveCycle: false,
    sessions: [],
    repeatCycles: [],
    onRefresh: () => undefined,
    onRun: () => undefined,
    onRecord: () => undefined,
    onStop: () => undefined,
    onStopRecording: () => undefined,
    onStopAll: () => undefined,
    ...overrides
  };
  return renderToStaticMarkup(<DashboardPanel {...props} />);
}

function tab(id: number) {
  return {
    id,
    title: `Fixture tab ${id}`,
    url: "https://example.com/fixture"
  } as const;
}

function idleRecorder(tabId: number) {
  return {
    tabId,
    state: "idle",
    stepCount: 0,
    canRecord: true,
    canStop: false,
    message: "Recorder is ready."
  } as const;
}
