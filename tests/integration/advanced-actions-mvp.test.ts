import { describe, expect, it, vi } from "vitest";

import { InMemoryExecutionLog } from "../../src/adapters/logging/in-memory-execution-log";
import {
  ChromeRecorderSessionRegistry,
  type ChromeRecorderSessionStorageArea
} from "../../src/adapters/storage/chrome-recorder-session-registry";
import {
  ChromePresetRepository,
  type ChromeStorageArea
} from "../../src/adapters/storage/chrome-storage";
import { AutomationRecorder } from "../../src/core/application/automation-recorder";
import { AutomationRunner } from "../../src/core/application/automation-runner";
import { ManualRunController } from "../../src/core/application/manual-run-controller";
import { RecordedPresetController } from "../../src/core/application/recorded-preset-controller";
import { RecordedStepMapper } from "../../src/core/application/recorded-step-mapper";
import { RecorderDraftController } from "../../src/core/application/recorder-draft-controller";
import { RecorderNavigationController } from "../../src/core/application/recorder-navigation-controller";
import { TabSessionManager } from "../../src/core/application/tab-session-manager";
import type { AutomationStep } from "../../src/core/domain/automation-step";
import type { RecorderEvent } from "../../src/core/domain/recorder-event";
import type { AutomationEngine } from "../../src/core/ports/automation-engine";
import type {
  RecorderContentBridge,
  StartRecorderCaptureRequest
} from "../../src/core/ports/recorder-content-bridge";
import type {
  RecorderDocumentContext,
  RecorderDocumentProvider
} from "../../src/core/ports/recorder-document-provider";

const TAB_ID = 88;
const SESSION_ID = "advanced-recorder-88";
const DOCUMENT_ID = "advanced-document-88";
const PAGE_URL = "https://advanced.example/fixture";
const PRESET_ID = "550e8400-e29b-41d4-a716-446655440088";

describe("Advanced Automation Actions MVP integration", () => {
  it("covers Create → Record → Edit → Save → Run including an HTML modal", async () => {
    const storage = new MemoryStorage();
    const registry = new ChromeRecorderSessionRegistry(storage);
    const bridge = new FakeContentBridge();
    const recorder = new AutomationRecorder(
      registry,
      bridge,
      new FixedDocumentProvider(),
      { isAutomationActive: async () => false },
      { clock: () => "2026-09-29T18:00:00.000Z" }
    );
    let mappedStepId = 0;
    const navigation = new RecorderNavigationController(
      registry,
      new RecordedStepMapper({
        createStepId: () => `recorded-advanced-${++mappedStepId}`
      }),
      bridge
    );

    await recorder.start({
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      url: PAGE_URL
    });
    for (const event of advancedRecorderEvents()) {
      await expect(navigation.record(event)).resolves.toBe("recorded");
    }
    await recorder.stop({ tabId: TAB_ID, reason: "user" });

    const drafts = new RecorderDraftController(registry);
    const captured = await drafts.get(TAB_ID);
    expect(captured?.steps.map(({ type }) => type)).toEqual([
      "select",
      "check",
      "uncheck",
      "pressKey",
      "input",
      "click"
    ]);
    if (captured === undefined) {
      throw new Error("Expected a stopped advanced recorder draft.");
    }

    const editedSteps = editCapturedSteps(captured.steps);
    const edited = await drafts.save({
      tabId: TAB_ID,
      sessionId: SESSION_ID,
      steps: editedSteps
    });
    expect(edited.steps).toEqual(editedSteps);

    const presets = new ChromePresetRepository(storage);
    const recordedPresets = new RecordedPresetController(registry, presets, {
      createId: () => PRESET_ID,
      now: () => new Date("2026-09-29T18:05:00.000Z")
    });
    const saved = await recordedPresets.save({
      tabId: TAB_ID,
      sessionId: SESSION_ID,
      name: "Advanced recorded modal workflow",
      steps: edited.steps
    });
    if (saved.status !== "saved") {
      throw new Error("Expected the advanced recorder preset to be saved.");
    }

    const engine = createEngine();
    const sessions = new TabSessionManager(engine, {
      createSessionId: () => "advanced-run-88"
    });
    const executionLog = new InMemoryExecutionLog();
    const runner = new AutomationRunner(engine, sessions, executionLog);
    const manualRun = new ManualRunController(presets, runner, sessions);

    await expect(manualRun.run(TAB_ID, PAGE_URL)).resolves.toMatchObject({
      presetId: PRESET_ID,
      tabId: TAB_ID,
      executedSteps: editedSteps.length
    });
    const executed = vi.mocked(engine.executeStep).mock.calls.map(
      ([request]) => request.step
    );
    expect(executed.map(({ type }) => type)).toEqual(
      editedSteps.map(({ type }) => type)
    );
    expect(executed).toContainEqual(
      expect.objectContaining({
        type: "input",
        inputMode: "human",
        humanInput: { minDelayMs: 60, maxDelayMs: 135 }
      })
    );
    expect(executed).toContainEqual(
      expect.objectContaining({
        type: "click",
        name: "Save HTML modal",
        target: {
          primary: {
            type: "role",
            role: "button",
            name: "Save",
            exact: true
          },
          fallbacks: [
            { type: "css", value: "[data-test-modal] [data-save]" }
          ]
        }
      })
    );
    expect(executed).toContainEqual(
      expect.objectContaining({
        type: "wait",
        condition: { type: "pageLoad", state: "networkidle" }
      })
    );
    expect(await executionLog.list({ tabId: TAB_ID })).toHaveLength(
      editedSteps.length
    );
    await expect(registry.getByTabId(TAB_ID)).resolves.toBeUndefined();
  });
});

function advancedRecorderEvents(): RecorderEvent[] {
  const base = (eventId: string) => ({
    version: 1 as const,
    eventId,
    sessionId: SESSION_ID,
    tabId: TAB_ID,
    documentId: DOCUMENT_ID,
    occurredAt: "2026-09-29T18:01:00.000Z",
    url: PAGE_URL
  });
  return [
    {
      ...base("select-country"),
      kind: "select",
      target: {
        locators: [
          { type: "label", value: "Country", exact: true },
          { type: "css", value: 'select[name="country"]' }
        ]
      },
      payload: { option: { by: "label", value: "Canada" } }
    },
    {
      ...base("check-terms"),
      kind: "check",
      target: { locators: [{ type: "testId", value: "terms" }] },
      payload: { control: "checkbox", checked: true }
    },
    {
      ...base("uncheck-newsletter"),
      kind: "uncheck",
      target: { locators: [{ type: "testId", value: "newsletter" }] },
      payload: { control: "checkbox", checked: false }
    },
    {
      ...base("press-submit"),
      kind: "pressKey",
      target: {
        locators: [{ type: "placeholder", value: "Search", exact: true }]
      },
      payload: { key: "Control+Enter" }
    },
    {
      ...base("input-modal-title"),
      kind: "input",
      target: {
        locators: [
          { type: "label", value: "Modal title", exact: true },
          { type: "css", value: "[data-test-modal] input[name=title]" }
        ]
      },
      payload: { value: "Recorded modal", inputType: "text" }
    },
    {
      ...base("click-modal-save"),
      kind: "click",
      target: {
        locators: [
          {
            type: "role",
            role: "button",
            name: "Save",
            exact: true
          },
          { type: "css", value: "[data-test-modal] [data-save]" }
        ]
      },
      payload: { button: "left", clickCount: 1, modifiers: [] }
    }
  ];
}

function editCapturedSteps(
  captured: readonly AutomationStep[]
): AutomationStep[] {
  return [
    ...captured.map((step) => {
      if (step.type === "input") {
        return {
          ...step,
          name: "Enter modal title naturally",
          inputMode: "human" as const,
          humanInput: { minDelayMs: 60, maxDelayMs: 135 }
        };
      }
      if (step.type === "click") {
        return { ...step, name: "Save HTML modal" };
      }
      return { ...step, name: `Recorded ${step.type}` };
    }),
    {
      id: "wait-modal-hidden",
      type: "wait",
      enabled: true,
      condition: {
        type: "element",
        state: "hidden",
        target: {
          primary: { type: "css", value: "[data-test-modal]" },
          fallbacks: [{ type: "role", role: "dialog", name: "Edit", exact: true }]
        }
      }
    },
    {
      id: "wait-result-url",
      type: "wait",
      enabled: true,
      condition: {
        type: "url",
        match: "regex",
        value: "advanced\\.example/(fixture|done)"
      }
    },
    {
      id: "wait-page-idle",
      type: "wait",
      enabled: true,
      condition: { type: "pageLoad", state: "networkidle" }
    }
  ];
}

function createEngine(): AutomationEngine {
  return {
    start: vi.fn(async (request) => ({
      sessionId: request.sessionId,
      target: request.target
    })),
    executeStep: vi.fn(async (request) => ({
      sessionId: request.sessionId,
      stepId: request.step.id,
      stepIndex: request.stepIndex
    })),
    complete: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    stopAll: vi.fn(async () => undefined)
  };
}

class FakeContentBridge implements RecorderContentBridge {
  readonly starts: StartRecorderCaptureRequest[] = [];

  async startCapture(request: StartRecorderCaptureRequest): Promise<void> {
    this.starts.push(structuredClone(request));
  }

  async stopCapture(_tabId: number): Promise<void> {}
}

class FixedDocumentProvider implements RecorderDocumentProvider {
  async getMainDocument(_tabId: number): Promise<RecorderDocumentContext> {
    return { documentId: DOCUMENT_ID, url: PAGE_URL };
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
