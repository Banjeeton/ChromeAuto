import { describe, expect, it } from "vitest";

import {
  ChromeRecorderSessionRegistry,
  type ChromeRecorderSessionStorageArea
} from "../../src/adapters/storage/chrome-recorder-session-registry";
import { AutomationRecorder } from "../../src/core/application/automation-recorder";
import { RecordedStepMapper } from "../../src/core/application/recorded-step-mapper";
import { RecorderNavigationController } from "../../src/core/application/recorder-navigation-controller";
import { RecorderPanelController } from "../../src/core/application/recorder-panel-controller";
import type { RecorderClickEvent } from "../../src/core/domain/recorder-event";
import type {
  RecorderContentBridge,
  StartRecorderCaptureRequest
} from "../../src/core/ports/recorder-content-bridge";
import type {
  RecorderDocumentContext,
  RecorderDocumentProvider
} from "../../src/core/ports/recorder-document-provider";

describe("recorder side panel integration", () => {
  it("starts once, reports recorded steps and stops the current tab", async () => {
    const harness = createHarness();

    await expect(
      harness.panel.status(11, "https://example.com/form")
    ).resolves.toMatchObject({
      state: "idle",
      stepCount: 0,
      canRecord: true,
      canStop: false
    });

    const [first, repeated] = await Promise.all([
      harness.panel.start(11, "https://example.com/form"),
      harness.panel.start(11, "https://example.com/form")
    ]);

    expect(first.state).toBe("recording");
    expect(repeated.sessionId).toBe(first.sessionId);
    expect(harness.bridge.started).toHaveLength(1);

    await harness.navigation.record(clickEvent(11, first.sessionId!));
    await expect(
      harness.panel.status(11, "https://example.com/form")
    ).resolves.toMatchObject({
      state: "recording",
      stepCount: 1,
      canRecord: false,
      canStop: true,
      message: "Recording 1 step."
    });

    await expect(
      harness.panel.stop(11, "https://example.com/form")
    ).resolves.toMatchObject({
      state: "stopped",
      stepCount: 1,
      canRecord: true,
      canStop: false
    });
    expect(harness.bridge.stopped).toEqual([11]);
  });

  it("keeps recorder sessions independent between tabs", async () => {
    const harness = createHarness();

    const first = await harness.panel.start(21, "https://example.com/one");
    const second = await harness.panel.start(22, "https://example.com/two");
    await harness.navigation.record(clickEvent(21, first.sessionId!));

    await harness.panel.stop(21, "https://example.com/one");

    await expect(
      harness.panel.status(21, "https://example.com/one")
    ).resolves.toMatchObject({ state: "stopped", stepCount: 1 });
    await expect(
      harness.panel.status(22, "https://example.com/two")
    ).resolves.toMatchObject({
      state: "recording",
      sessionId: second.sessionId,
      stepCount: 0
    });
  });

  it("disables restricted pages and rejects recording during automation", async () => {
    const harness = createHarness(new Set([31]));

    await expect(
      harness.panel.status(30, "chrome://extensions")
    ).resolves.toMatchObject({
      state: "idle",
      canRecord: false,
      unavailableReason: "unsupported-url"
    });
    await expect(
      harness.panel.start(30, "chrome://extensions")
    ).rejects.toMatchObject({ code: "unsupported-url" });
    await expect(
      harness.panel.start(31, "https://example.com")
    ).rejects.toMatchObject({ code: "session-conflict" });
    await expect(
      harness.panel.start(32, "https://example.com")
    ).resolves.toMatchObject({ state: "recording", tabId: 32 });
  });
});

function createHarness(activeAutomations = new Set<number>()) {
  const registry = new ChromeRecorderSessionRegistry(
    new MemorySessionStorage()
  );
  const bridge = new FakeContentBridge();
  const documents = new FakeDocumentProvider();
  const recorder = new AutomationRecorder(
    registry,
    bridge,
    documents,
    {
      isAutomationActive: async (tabId) => activeAutomations.has(tabId)
    },
    { clock: () => "2026-09-29T14:00:00.000Z" }
  );
  let sessionNumber = 0;
  const panel = new RecorderPanelController(recorder, registry, {
    createSessionId: () => `session-${++sessionNumber}`
  });
  const navigation = new RecorderNavigationController(
    registry,
    new RecordedStepMapper({ createStepId: () => "recorded-click" }),
    bridge
  );
  return { bridge, navigation, panel };
}

function clickEvent(tabId: number, sessionId: string): RecorderClickEvent {
  return {
    version: 1,
    eventId: `click-${tabId}`,
    sessionId,
    tabId,
    documentId: `document-${tabId}`,
    occurredAt: "2026-09-29T14:01:00.000Z",
    url: `https://example.com/tab/${tabId}`,
    kind: "click",
    target: { locators: [{ type: "testId", value: "submit" }] },
    payload: { button: "left", clickCount: 1, modifiers: [] }
  };
}

class FakeContentBridge implements RecorderContentBridge {
  readonly started: StartRecorderCaptureRequest[] = [];
  readonly stopped: number[] = [];

  async startCapture(request: StartRecorderCaptureRequest): Promise<void> {
    this.started.push(structuredClone(request));
  }

  async stopCapture(tabId: number): Promise<void> {
    this.stopped.push(tabId);
  }
}

class FakeDocumentProvider implements RecorderDocumentProvider {
  async getMainDocument(tabId: number): Promise<RecorderDocumentContext> {
    return {
      documentId: `document-${tabId}`,
      url: `https://example.com/tab/${tabId}`
    };
  }
}

class MemorySessionStorage implements ChromeRecorderSessionStorageArea {
  readonly values: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.values
      ? { [key]: structuredClone(this.values[key]) }
      : {};
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
  }
}
