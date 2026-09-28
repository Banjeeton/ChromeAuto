import { describe, expect, it } from "vitest";

import {
  ChromeRecorderSessionRegistry,
  type ChromeRecorderSessionStorageArea
} from "../../src/adapters/storage/chrome-recorder-session-registry";
import { RecordedStepMapper } from "../../src/core/application/recorded-step-mapper";
import { RecorderNavigationController } from "../../src/core/application/recorder-navigation-controller";
import type { RecorderClickEvent } from "../../src/core/domain/recorder-event";
import type {
  RecorderContentBridge,
  StartRecorderCaptureRequest
} from "../../src/core/ports/recorder-content-bridge";
import type { RecorderSessionRecord } from "../../src/core/ports/recorder-session-registry";

describe("recorder reload integration", () => {
  it("records one reload, restores capture and keeps the same session", async () => {
    const storage = new MemorySessionStorage();
    const registry = new ChromeRecorderSessionRegistry(storage);
    const bridge = new FakeContentBridge();
    const controller = createController(registry, bridge);
    await registry.save(activeRecord(21));

    await controller.record(clickEvent(21, "document-before", "click-before"));
    await controller.handleNavigationCommitted({
      tabId: 21,
      url: "https://example.com/form?after=reload",
      documentId: "document-after",
      navigationId: "navigation-reload-1",
      transitionType: "reload"
    });
    await controller.handleNavigationCommitted({
      tabId: 21,
      url: "https://example.com/form?after=reload",
      documentId: "document-after",
      navigationId: "navigation-reload-1",
      transitionType: "reload"
    });
    await controller.handlePageReady({
      tabId: 21,
      url: "https://example.com/form?after=reload",
      documentId: "document-after",
      navigationId: "navigation-reload-1"
    });
    await controller.record(clickEvent(21, "document-after", "click-after"));

    const record = await registry.getByTabId(21);
    expect(record?.session).toMatchObject({
      sessionId: "recorder-21",
      state: "recording",
      recordedEventCount: 4
    });
    expect(record?.documentId).toBe("document-after");
    expect(record?.recordedEvents.map(({ kind }) => kind)).toEqual([
      "click",
      "reload",
      "pageReady",
      "click"
    ]);
    expect(record?.draftSteps.map(({ type }) => type)).toEqual([
      "click",
      "reload",
      "click"
    ]);
    expect(
      record?.draftSteps.filter(({ type }) => type === "reload")
    ).toHaveLength(1);
    expect(bridge.started).toEqual([
      {
        sessionId: "recorder-21",
        tabId: 21,
        documentId: "document-after",
        url: "https://example.com/form?after=reload"
      }
    ]);
  });

  it("restores an active session from storage after worker recreation", async () => {
    const storage = new MemorySessionStorage();
    const firstRegistry = new ChromeRecorderSessionRegistry(storage);
    await firstRegistry.save(activeRecord(22));

    const recreatedRegistry = new ChromeRecorderSessionRegistry(storage);
    const bridge = new FakeContentBridge();
    const recreatedController = createController(recreatedRegistry, bridge);
    await recreatedController.handlePageReady({
      tabId: 22,
      url: "https://example.com/ready",
      documentId: "document-restored",
      navigationId: "navigation-restored"
    });

    expect(bridge.started[0]).toMatchObject({
      sessionId: "recorder-22",
      documentId: "document-restored"
    });
    await expect(recreatedRegistry.getByTabId(22)).resolves.toMatchObject({
      session: { sessionId: "recorder-22", state: "recording" },
      documentId: "document-restored"
    });
  });

  it("stops only the changed tab and preserves its accumulated draft", async () => {
    const registry = new ChromeRecorderSessionRegistry(
      new MemorySessionStorage()
    );
    const bridge = new FakeContentBridge();
    const controller = createController(registry, bridge);
    await registry.save(activeRecord(31));
    await registry.save(activeRecord(32));
    await controller.record(clickEvent(31, "document-before", "click-31"));

    await controller.handleNavigationCommitted({
      tabId: 31,
      url: "https://other.example/form",
      documentId: "document-other-host",
      navigationId: "navigation-other-host",
      transitionType: "link"
    });

    const stopped = await registry.getByTabId(31);
    const unaffected = await registry.getByTabId(32);
    expect(stopped?.session).toMatchObject({
      state: "stopped",
      stopReason: "tab-context-changed"
    });
    expect(stopped?.draftSteps.map(({ type }) => type)).toEqual(["click"]);
    expect(stopped?.recordedEvents).toHaveLength(1);
    expect(unaffected?.session.state).toBe("recording");
    expect(bridge.stopped).toEqual([31]);
  });

  it("preserves the draft when the recorded tab is closed", async () => {
    const registry = new ChromeRecorderSessionRegistry(
      new MemorySessionStorage()
    );
    const controller = createController(registry, new FakeContentBridge());
    await registry.save(activeRecord(41));
    await controller.record(clickEvent(41, "document-before", "click-41"));

    await controller.handleTabRemoved(41);

    await expect(registry.getByTabId(41)).resolves.toMatchObject({
      session: { state: "stopped", stopReason: "tab-closed" },
      draftSteps: [{ type: "click" }]
    });
  });
});

function createController(
  registry: ChromeRecorderSessionRegistry,
  bridge: RecorderContentBridge
): RecorderNavigationController {
  let id = 0;
  return new RecorderNavigationController(
    registry,
    new RecordedStepMapper({ createStepId: () => `recorded-step-${++id}` }),
    bridge,
    {
      clock: () => "2026-09-29T12:00:00.000Z",
      createEventId: () => `navigation-event-${++id}`
    }
  );
}

function activeRecord(tabId: number): RecorderSessionRecord {
  return {
    session: {
      sessionId: `recorder-${tabId}`,
      tabId,
      context: {
        url: "https://example.com/form",
        hostname: "example.com",
        protocol: "https"
      },
      startedAt: "2026-09-29T11:00:00.000Z",
      recordedEventCount: 0,
      state: "recording"
    },
    documentId: "document-before",
    currentUrl: "https://example.com/form",
    recordedEvents: [],
    draftSteps: []
  };
}

function clickEvent(
  tabId: number,
  documentId: string,
  eventId: string
): RecorderClickEvent {
  return {
    version: 1,
    eventId,
    sessionId: `recorder-${tabId}`,
    tabId,
    documentId,
    occurredAt: "2026-09-29T11:01:00.000Z",
    url: "https://example.com/form",
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
