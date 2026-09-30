import { describe, expect, it } from "vitest";

import { InMemoryRecorderLog } from "../../src/adapters/logging/in-memory-recorder-log";
import {
  ChromeRecorderSessionRegistry,
  type ChromeRecorderSessionStorageArea
} from "../../src/adapters/storage/chrome-recorder-session-registry";
import { AutomationRecorder } from "../../src/core/application/automation-recorder";
import {
  RecordedStepMapper,
  type RecordedStepMappingResult
} from "../../src/core/application/recorded-step-mapper";
import { RecorderNavigationController } from "../../src/core/application/recorder-navigation-controller";
import type { RecorderClickEvent } from "../../src/core/domain/recorder-event";
import type {
  RecorderContentBridge,
  StartRecorderCaptureRequest
} from "../../src/core/ports/recorder-content-bridge";
import type {
  RecorderDocumentContext,
  RecorderDocumentProvider
} from "../../src/core/ports/recorder-document-provider";
import type { RecorderSessionRecord } from "../../src/core/ports/recorder-session-registry";

describe("recorder diagnostics integration", () => {
  it("logs start, every action and user stop", async () => {
    const registry = new ChromeRecorderSessionRegistry(new MemoryStorage());
    const log = new InMemoryRecorderLog();
    const bridge = new FakeBridge();
    const recorder = createRecorder(registry, bridge, log);
    const navigation = createNavigation(registry, bridge, log);

    await recorder.start({
      sessionId: "session-1",
      tabId: 1,
      url: "https://example.com/form"
    });
    await navigation.record(clickEvent(1, "session-1", "event-1"));
    await recorder.stop({ tabId: 1, reason: "user" });

    await expect(log.list()).resolves.toMatchObject([
      { event: "started", action: "start recording", stepCount: 0 },
      {
        event: "action-recorded",
        action: "record click",
        recorderEventId: "event-1",
        stepCount: 1
      },
      {
        event: "stopped",
        action: "stop recording",
        stopReason: "user",
        stepCount: 1
      }
    ]);
  });

  it("logs an event failure and preserves the previous draft", async () => {
    const registry = new ChromeRecorderSessionRegistry(new MemoryStorage());
    const log = new InMemoryRecorderLog();
    const bridge = new FakeBridge();
    await registry.save(activeRecord(2));
    const navigation = createNavigation(
      registry,
      bridge,
      log,
      new FailSecondEventMapper()
    );

    await navigation.record(clickEvent(2, "session-2", "event-1"));
    await expect(
      navigation.record(clickEvent(2, "session-2", "event-2"))
    ).rejects.toThrow("Intentional mapper failure");

    await expect(registry.getByTabId(2)).resolves.toMatchObject({
      session: { state: "recording", recordedEventCount: 1 },
      recordedEvents: [{ eventId: "event-1" }],
      draftSteps: [{ type: "click" }]
    });
    await expect(log.list()).resolves.toContainEqual(
      expect.objectContaining({
        event: "failed",
        action: "record click",
        recorderEventId: "event-2",
        message: expect.stringContaining("existing draft was preserved"),
        details: expect.objectContaining({
          name: "Error",
          message: "Intentional mapper failure"
        })
      })
    );
  });

  it("logs an unsupported action without changing the existing draft", async () => {
    const registry = new ChromeRecorderSessionRegistry(new MemoryStorage());
    const log = new InMemoryRecorderLog();
    const bridge = new FakeBridge();
    await registry.save(activeRecord(6));
    const navigation = createNavigation(registry, bridge, log);

    await navigation.record(clickEvent(6, "session-6", "event-1"));
    const unsupported = clickEvent(6, "session-6", "event-2");
    await expect(
      navigation.record({
        ...unsupported,
        payload: { ...unsupported.payload, modifiers: ["Alt"] }
      })
    ).resolves.toBe("ignored");

    await expect(registry.getByTabId(6)).resolves.toMatchObject({
      session: { state: "recording", recordedEventCount: 2 },
      draftSteps: [{ id: "step-event-1", type: "click" }]
    });
    await expect(log.list()).resolves.toContainEqual(
      expect.objectContaining({
        event: "action-skipped",
        action: "skip click",
        recorderEventId: "event-2",
        stepCount: 1,
        message: expect.stringContaining("existing draft was preserved")
      })
    );
  });

  it("reports hostname changes and tab closure as distinct stop reasons", async () => {
    const registry = new ChromeRecorderSessionRegistry(new MemoryStorage());
    const log = new InMemoryRecorderLog();
    const bridge = new FakeBridge();
    const navigation = createNavigation(registry, bridge, log);
    await registry.save(activeRecord(3));
    await registry.save(activeRecord(4));

    await navigation.handleNavigationCommitted({
      tabId: 3,
      url: "https://other.example/path",
      documentId: "other-document",
      navigationId: "other-document",
      transitionType: "link"
    });
    await navigation.handleTabRemoved(4);

    await expect(log.list()).resolves.toEqual([
      expect.objectContaining({
        tabId: 3,
        event: "context-changed",
        stopReason: "tab-context-changed",
        message: expect.stringContaining("left example.com")
      }),
      expect.objectContaining({
        tabId: 4,
        event: "tab-closed",
        stopReason: "tab-closed"
      })
    ]);
  });

  it("logs content-script channel failures with technical details", async () => {
    const registry = new ChromeRecorderSessionRegistry(new MemoryStorage());
    const log = new InMemoryRecorderLog();
    const cause = new Error("Receiving end does not exist");
    const bridge = new FakeBridge(cause);
    const recorder = createRecorder(registry, bridge, log);

    await expect(
      recorder.start({
        sessionId: "session-5",
        tabId: 5,
        url: "https://example.com/form"
      })
    ).rejects.toMatchObject({ code: "recorder-unavailable" });

    await expect(registry.getByTabId(5)).resolves.toMatchObject({
      session: { state: "failed", recordedEventCount: 0 },
      draftSteps: []
    });
    await expect(log.list()).resolves.toContainEqual(
      expect.objectContaining({
        event: "failed",
        action: "start recording",
        message: expect.stringContaining("Unable to start recording"),
        details: expect.objectContaining({
          code: "recorder-unavailable",
          cause: "Error: Receiving end does not exist"
        })
      })
    );
  });
});

function createRecorder(
  registry: ChromeRecorderSessionRegistry,
  bridge: RecorderContentBridge,
  log: InMemoryRecorderLog
): AutomationRecorder {
  let logId = 0;
  return new AutomationRecorder(
    registry,
    bridge,
    new FakeDocuments(),
    { isAutomationActive: async () => false },
    {
      clock: () => "2026-09-29T16:00:00.000Z",
      createLogId: () => `log-${++logId}`,
      log
    }
  );
}

function createNavigation(
  registry: ChromeRecorderSessionRegistry,
  bridge: RecorderContentBridge,
  log: InMemoryRecorderLog,
  mapper: RecordedStepMapper = new RecordedStepMapper({
    createStepId: (event) => `step-${event.eventId}`
  })
): RecorderNavigationController {
  let logId = 100;
  return new RecorderNavigationController(registry, mapper, bridge, {
    clock: () => "2026-09-29T16:01:00.000Z",
    createEventId: () => "navigation-event",
    createLogId: () => `log-${++logId}`,
    log
  });
}

class FailSecondEventMapper extends RecordedStepMapper {
  override map(events: readonly unknown[]): RecordedStepMappingResult {
    if (events.length > 1) {
      throw new Error("Intentional mapper failure");
    }
    return super.map(events);
  }
}

class FakeBridge implements RecorderContentBridge {
  readonly #startError?: Error;

  constructor(startError?: Error) {
    this.#startError = startError;
  }

  async startCapture(_request: StartRecorderCaptureRequest): Promise<void> {
    if (this.#startError !== undefined) {
      throw this.#startError;
    }
  }

  async stopCapture(_tabId: number): Promise<void> {}
}

class FakeDocuments implements RecorderDocumentProvider {
  async getMainDocument(tabId: number): Promise<RecorderDocumentContext> {
    return {
      documentId: `document-${tabId}`,
      url: "https://example.com/form"
    };
  }
}

class MemoryStorage implements ChromeRecorderSessionStorageArea {
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

function activeRecord(tabId: number): RecorderSessionRecord {
  return {
    session: {
      sessionId: `session-${tabId}`,
      tabId,
      context: {
        url: "https://example.com/form",
        hostname: "example.com",
        protocol: "https"
      },
      startedAt: "2026-09-29T15:59:00.000Z",
      recordedEventCount: 0,
      state: "recording"
    },
    documentId: `document-${tabId}`,
    currentUrl: "https://example.com/form",
    recordedEvents: [],
    draftSteps: []
  };
}

function clickEvent(
  tabId: number,
  sessionId: string,
  eventId: string
): RecorderClickEvent {
  return {
    version: 1,
    eventId,
    sessionId,
    tabId,
    documentId: `document-${tabId}`,
    occurredAt: "2026-09-29T16:00:30.000Z",
    url: "https://example.com/form",
    kind: "click",
    target: { locators: [{ type: "testId", value: "submit" }] },
    payload: { button: "left", clickCount: 1, modifiers: [] }
  };
}
