import { describe, expect, it } from "vitest";

import {
  ChromeRecorderSessionRegistry,
  type ChromeRecorderSessionStorageArea
} from "../../src/adapters/storage/chrome-recorder-session-registry";
import {
  ChromePresetRepository,
  type ChromeStorageArea
} from "../../src/adapters/storage/chrome-storage";
import { AutomationRecorder } from "../../src/core/application/automation-recorder";
import { RecordedPresetController } from "../../src/core/application/recorded-preset-controller";
import { RecordedStepMapper } from "../../src/core/application/recorded-step-mapper";
import { RecorderNavigationController } from "../../src/core/application/recorder-navigation-controller";
import { RecorderPanelController } from "../../src/core/application/recorder-panel-controller";
import type { RecorderEvent } from "../../src/core/domain/recorder-event";
import type {
  RecorderContentBridge,
  StartRecorderCaptureRequest
} from "../../src/core/ports/recorder-content-bridge";
import type {
  RecorderDocumentContext,
  RecorderDocumentProvider
} from "../../src/core/ports/recorder-document-provider";
import {
  RecorderDomCapture,
  type RecorderCaptureElement,
  type RecorderCaptureOptions,
  type RecorderDocumentEventSource
} from "../../src/content/recorder-dom-capture";

const TAB_ID = 71;
const PAGE_URL = "https://recorder.example/form";
const PRESET_ID = "550e8400-e29b-41d4-a716-446655440071";

describe("Automation Recorder MVP integration", () => {
  it("records DOM click and input, stops, and saves a portable preset", async () => {
    const sessionStorage = new MemoryStorage();
    const localStorage = new MemoryStorage();
    const registry = new ChromeRecorderSessionRegistry(sessionStorage);
    const repository = new ChromePresetRepository(localStorage);
    const source = new FakeDocumentSource();
    const scheduler = new ManualScheduler();
    const emitted: RecorderEvent[] = [];
    let eventId = 0;
    const capture = new RecorderDomCapture(
      source,
      (event) => emitted.push(event),
      {
        createEventId: () => `event-${++eventId}`,
        clock: () => "2026-09-29T18:01:00.000Z",
        schedule: scheduler.schedule,
        cancelScheduled: scheduler.cancel,
        generateTarget: createTarget
      }
    );
    const bridge = new CaptureContentBridge(capture);
    const recorder = new AutomationRecorder(
      registry,
      bridge,
      new FixedDocumentProvider(),
      { isAutomationActive: async () => false },
      { clock: () => "2026-09-29T18:00:00.000Z" }
    );
    const panel = new RecorderPanelController(recorder, registry, {
      createSessionId: () => "recorder-71"
    });
    let stepId = 0;
    const navigation = new RecorderNavigationController(
      registry,
      new RecordedStepMapper({
        createStepId: () => `recorded-step-${++stepId}`
      }),
      bridge
    );

    await expect(panel.start(TAB_ID, PAGE_URL)).resolves.toMatchObject({
      state: "recording",
      sessionId: "recorder-71",
      stepCount: 0
    });

    const submit = new FakeElement("button", {
      "data-testid": "submit-order"
    });
    const email = new FakeElement("input", {
      name: "email",
      type: "email",
      placeholder: "Email"
    });
    source.dispatch("click", trustedEvent(submit));
    email.value = "user@example.com";
    source.dispatch("input", trustedEvent(email));
    scheduler.flushAll();

    expect(emitted.map(({ kind }) => kind)).toEqual(["click", "input"]);
    for (const event of emitted) {
      await expect(navigation.record(event)).resolves.toBe("recorded");
    }

    await expect(panel.stop(TAB_ID, PAGE_URL)).resolves.toMatchObject({
      state: "stopped",
      stepCount: 2
    });
    const stopped = await registry.getByTabId(TAB_ID);
    expect(stopped?.draftSteps).toEqual([
      expect.objectContaining({
        type: "click",
        target: {
          primary: { type: "testId", value: "submit-order" },
          fallbacks: []
        }
      }),
      expect.objectContaining({
        type: "input",
        value: "user@example.com",
        clearFirst: true,
        inputMode: "default",
        target: {
          primary: { type: "placeholder", value: "Email", exact: true },
          fallbacks: []
        }
      })
    ]);
    expect(new Set(stopped?.draftSteps.map(({ id }) => id)).size).toBe(2);
    expect(
      stopped?.draftSteps.every(({ id }) => id.startsWith("recorded-step-"))
    ).toBe(true);
    if (stopped === undefined) {
      throw new Error("Expected the stopped recorder draft.");
    }

    const save = new RecordedPresetController(registry, repository, {
      createId: () => PRESET_ID,
      now: () => new Date("2026-09-29T18:05:00.000Z")
    });
    const result = await save.save({
      tabId: TAB_ID,
      sessionId: stopped.session.sessionId,
      name: "Recorded form",
      steps: stopped.draftSteps
    });

    expect(result).toMatchObject({
      status: "saved",
      preset: {
        schemaVersion: 1,
        id: PRESET_ID,
        createdAt: "2026-09-29T18:05:00.000Z",
        updatedAt: "2026-09-29T18:05:00.000Z",
        site: { hostname: "recorder.example", protocols: ["https"] },
        automation: {
          steps: [
            expect.objectContaining({ type: "click" }),
            expect.objectContaining({
              type: "input",
              value: "user@example.com"
            })
          ]
        }
      }
    });
    await expect(repository.getById(PRESET_ID)).resolves.toEqual(
      result.status === "saved" ? result.preset : undefined
    );
    await expect(registry.getByTabId(TAB_ID)).resolves.toBeUndefined();

    const serialized = JSON.stringify(
      result.status === "saved" ? result.preset : undefined
    );
    expect(serialized).not.toContain("sessionId");
    expect(serialized).not.toContain("tabId");
    expect(serialized).not.toContain("recordedEvents");
    expect(serialized).not.toContain("draftSteps");
  });
});

class CaptureContentBridge implements RecorderContentBridge {
  readonly #capture: RecorderDomCapture;

  constructor(capture: RecorderDomCapture) {
    this.#capture = capture;
  }

  async startCapture(request: StartRecorderCaptureRequest): Promise<void> {
    this.#capture.start(request);
  }

  async stopCapture(_tabId: number): Promise<void> {
    this.#capture.stop();
  }
}

class FixedDocumentProvider implements RecorderDocumentProvider {
  async getMainDocument(_tabId: number): Promise<RecorderDocumentContext> {
    return { documentId: "document-71", url: PAGE_URL };
  }
}

type DocumentListener = Parameters<
  RecorderDocumentEventSource["addEventListener"]
>[1];

class FakeDocumentSource implements RecorderDocumentEventSource {
  readonly #listeners = new Map<"click" | "input", Set<DocumentListener>>();

  addEventListener(
    type: "click" | "input",
    listener: DocumentListener
  ): void {
    const listeners = this.#listeners.get(type) ?? new Set<DocumentListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(
    type: "click" | "input",
    listener: DocumentListener
  ): void {
    this.#listeners.get(type)?.delete(listener);
  }

  dispatch(type: "click" | "input", event: ReturnType<typeof trustedEvent>) {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakeElement implements RecorderCaptureElement {
  readonly tagName: string;
  readonly #attributes: Readonly<Record<string, string>>;
  value = "";
  textContent = "";
  isContentEditable = false;

  constructor(tagName: string, attributes: Record<string, string> = {}) {
    this.tagName = tagName.toUpperCase();
    this.#attributes = attributes;
  }

  getAttribute(name: string): string | null {
    return this.#attributes[name] ?? null;
  }
}

function trustedEvent(target: FakeElement) {
  return {
    isTrusted: true,
    target: target as unknown as EventTarget,
    composedPath: () => [target as unknown as EventTarget]
  };
}

function createTarget(element: RecorderCaptureElement) {
  const testId = element.getAttribute("data-testid");
  if (testId !== null) {
    return { locators: [{ type: "testId" as const, value: testId }] };
  }
  const placeholder = element.getAttribute("placeholder");
  if (placeholder !== null) {
    return {
      locators: [
        { type: "placeholder" as const, value: placeholder, exact: true }
      ]
    };
  }
  return {
    locators: [{ type: "css" as const, value: element.tagName.toLowerCase() }]
  };
}

class ManualScheduler {
  readonly #tasks = new Map<ReturnType<typeof setTimeout>, () => void>();
  #nextId = 0;

  readonly schedule: NonNullable<RecorderCaptureOptions["schedule"]> = (
    callback
  ) => {
    const handle = { id: ++this.#nextId } as unknown as ReturnType<
      typeof setTimeout
    >;
    this.#tasks.set(handle, callback);
    return handle;
  };

  readonly cancel: NonNullable<RecorderCaptureOptions["cancelScheduled"]> = (
    handle
  ) => {
    this.#tasks.delete(handle);
  };

  flushAll(): void {
    const tasks = [...this.#tasks.values()];
    this.#tasks.clear();
    tasks.forEach((task) => task());
  }
}

class MemoryStorage
  implements ChromeStorageArea, ChromeRecorderSessionStorageArea
{
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
