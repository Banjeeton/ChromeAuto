import { describe, expect, it } from "vitest";

import {
  ChromeRecorderSessionRegistry,
  type ChromeRecorderSessionStorageArea
} from "../../src/adapters/storage/chrome-recorder-session-registry";
import { RecorderRecoveryController } from "../../src/core/application/recorder-recovery-controller";
import type { RecorderSessionRecord } from "../../src/core/ports/recorder-session-registry";
import type {
  RecorderContentBridge,
  StartRecorderCaptureRequest
} from "../../src/core/ports/recorder-content-bridge";
import type {
  RecorderDocumentContext,
  RecorderDocumentProvider
} from "../../src/core/ports/recorder-document-provider";

describe("service-worker runtime recovery integration", () => {
  it("restores recording sessions from chrome.storage.session exactly once per recovery", async () => {
    const storage = new MemorySessionStorage();
    const firstWorkerRegistry = new ChromeRecorderSessionRegistry(storage);
    await firstWorkerRegistry.save(recordingRecord(11));

    const bridge = new FakeBridge();
    const recreatedWorkerRegistry = new ChromeRecorderSessionRegistry(storage);
    const controller = new RecorderRecoveryController(
      recreatedWorkerRegistry,
      bridge,
      new FakeDocuments(new Map([[11, {
        documentId: "document-after-restart",
        url: "https://example.com/form"
      }]]))
    );

    const [first, concurrent] = await Promise.all([
      controller.recover(),
      controller.recover()
    ]);

    expect(first).toEqual({ restored: 1, finalized: 0, stopped: 0 });
    expect(concurrent).toEqual(first);
    expect(bridge.started).toHaveLength(1);
    expect(bridge.started[0]).toMatchObject({
      sessionId: "session-11",
      tabId: 11,
      documentId: "document-after-restart"
    });
    await expect(recreatedWorkerRegistry.getByTabId(11)).resolves.toMatchObject({
      session: { state: "recording" },
      documentId: "document-after-restart"
    });
  });

  it("finalizes interrupted Stop and preserves its draft", async () => {
    const storage = new MemorySessionStorage();
    const registry = new ChromeRecorderSessionRegistry(storage);
    const interrupted = recordingRecord(12);
    await registry.save({
      ...interrupted,
      draftSteps: [{
        id: "wait-1",
        type: "wait",
        enabled: true,
        condition: { type: "timeout", durationMs: 100 }
      }],
      session: {
        ...interrupted.session,
        state: "stopping",
        stopReason: "user"
      }
    });
    const bridge = new FakeBridge();
    const controller = new RecorderRecoveryController(
      registry,
      bridge,
      new FakeDocuments(),
      () => "2026-09-30T12:00:00.000Z"
    );

    await expect(controller.recover()).resolves.toEqual({
      restored: 0,
      finalized: 1,
      stopped: 0
    });
    expect(bridge.stopped).toEqual([12]);
    await expect(registry.getByTabId(12)).resolves.toMatchObject({
      session: {
        state: "stopped",
        stopReason: "user",
        stoppedAt: "2026-09-30T12:00:00.000Z"
      },
      draftSteps: [{ id: "wait-1" }]
    });
  });

  it("stops only stale recorder sessions whose tab disappeared or changed hostname", async () => {
    const storage = new MemorySessionStorage();
    const registry = new ChromeRecorderSessionRegistry(storage);
    await registry.save(recordingRecord(21));
    await registry.save(recordingRecord(22));
    await registry.save(recordingRecord(23));
    const bridge = new FakeBridge();
    const documents = new FakeDocuments(new Map([
      [21, { documentId: "doc-21", url: "https://example.com/current" }],
      [22, { documentId: "doc-22", url: "https://other.example/page" }]
    ]));

    await expect(new RecorderRecoveryController(
      registry,
      bridge,
      documents,
      () => "2026-09-30T13:00:00.000Z"
    ).recover()).resolves.toEqual({ restored: 1, finalized: 0, stopped: 2 });

    await expect(registry.getByTabId(21)).resolves.toMatchObject({
      session: { state: "recording" }
    });
    await expect(registry.getByTabId(22)).resolves.toMatchObject({
      session: { state: "stopped", stopReason: "tab-context-changed" }
    });
    await expect(registry.getByTabId(23)).resolves.toMatchObject({
      session: { state: "stopped", stopReason: "tab-closed" }
    });
  });
});

function recordingRecord(tabId: number): RecorderSessionRecord {
  return {
    session: {
      sessionId: `session-${tabId}`,
      tabId,
      context: {
        url: "https://example.com/form",
        hostname: "example.com",
        protocol: "https"
      },
      startedAt: "2026-09-30T10:00:00.000Z",
      recordedEventCount: 0,
      state: "recording"
    },
    documentId: `document-${tabId}`,
    currentUrl: "https://example.com/form",
    recordedEvents: [],
    draftSteps: []
  };
}

class MemorySessionStorage implements ChromeRecorderSessionStorageArea {
  readonly values: Record<string, unknown> = {};
  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.values ? { [key]: structuredClone(this.values[key]) } : {};
  }
  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
  }
}

class FakeBridge implements RecorderContentBridge {
  readonly started: StartRecorderCaptureRequest[] = [];
  readonly stopped: number[] = [];
  async startCapture(request: StartRecorderCaptureRequest): Promise<void> {
    this.started.push(structuredClone(request));
  }
  async stopCapture(tabId: number): Promise<void> {
    this.stopped.push(tabId);
  }
}

class FakeDocuments implements RecorderDocumentProvider {
  constructor(
    readonly documents = new Map<number, RecorderDocumentContext>()
  ) {}
  async getMainDocument(tabId: number): Promise<RecorderDocumentContext> {
    const document = this.documents.get(tabId);
    if (document === undefined) throw new Error(`Tab ${tabId} was closed.`);
    return document;
  }
}
