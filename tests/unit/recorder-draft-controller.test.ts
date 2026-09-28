import { describe, expect, it } from "vitest";

import {
  ChromeRecorderSessionRegistry,
  type ChromeRecorderSessionStorageArea
} from "../../src/adapters/storage/chrome-recorder-session-registry";
import { RecorderDraftController } from "../../src/core/application/recorder-draft-controller";
import type { AutomationStep } from "../../src/core/domain/automation-step";
import type { RecorderSessionRecord } from "../../src/core/ports/recorder-session-registry";

describe("RecorderDraftController", () => {
  it("edits only the stopped runtime draft", async () => {
    const registry = new ChromeRecorderSessionRegistry(
      new MemorySessionStorage()
    );
    const controller = new RecorderDraftController(registry);
    await registry.save(stoppedRecord());
    const updatedSteps: AutomationStep[] = [
      {
        id: "input-email",
        name: "Enter account email",
        type: "input",
        enabled: false,
        target: {
          primary: { type: "testId", value: "account-email" },
          fallbacks: [{ type: "css", value: "input[name='email']" }]
        },
        value: "updated@example.com",
        clearFirst: true,
        inputMode: "human"
      },
      {
        id: "wait-after-input",
        name: "Wait after input",
        type: "wait",
        enabled: true,
        condition: { type: "timeout", durationMs: 750 }
      },
      {
        id: "custom-check",
        type: "customCode",
        enabled: true,
        language: "javascript",
        apiVersion: 1,
        executionContext: "page",
        source: "automation.log(document.title);"
      }
    ];

    const result = await controller.save({
      tabId: 7,
      sessionId: "recorder-7",
      steps: updatedSteps
    });

    expect(result.steps).toEqual(updatedSteps);
    await expect(registry.getByTabId(7)).resolves.toMatchObject({
      draftSteps: updatedSteps,
      recordedEvents: stoppedRecord().recordedEvents
    });
  });

  it("returns validation errors with the failing field path", async () => {
    const registry = new ChromeRecorderSessionRegistry(
      new MemorySessionStorage()
    );
    const controller = new RecorderDraftController(registry);
    const original = stoppedRecord();
    await registry.save(original);

    await expect(
      controller.save({
        tabId: 7,
        sessionId: "recorder-7",
        steps: [
          {
            ...original.draftSteps[0],
            target: {
              primary: { type: "css", value: "" },
              fallbacks: []
            }
          }
        ]
      })
    ).rejects.toMatchObject({
      name: "PresetValidationError",
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining("/automation/steps/0")
        })
      ])
    });
    await expect(registry.getByTabId(7)).resolves.toEqual(original);
  });

  it("requires Stop and discards only the matching draft", async () => {
    const registry = new ChromeRecorderSessionRegistry(
      new MemorySessionStorage()
    );
    const controller = new RecorderDraftController(registry);
    const active = stoppedRecord("recording");
    await registry.save(active);

    await expect(
      controller.save({
        tabId: 7,
        sessionId: "recorder-7",
        steps: active.draftSteps
      })
    ).rejects.toMatchObject({ code: "session-conflict" });
    await expect(
      controller.discard(7, "another-session")
    ).rejects.toMatchObject({ code: "session-not-found" });

    await registry.save(stoppedRecord());
    await expect(controller.discard(7, "recorder-7")).resolves.toBe(true);
    await expect(registry.getByTabId(7)).resolves.toBeUndefined();
  });
});

function stoppedRecord(
  state: "recording" | "stopped" = "stopped"
): RecorderSessionRecord {
  const sessionBase = {
    sessionId: "recorder-7",
    tabId: 7,
    context: {
      url: "https://example.com/form",
      hostname: "example.com",
      protocol: "https" as const
    },
    startedAt: "2026-09-29T14:00:00.000Z",
    recordedEventCount: 1
  };
  return {
    session:
      state === "recording"
        ? { ...sessionBase, state }
        : {
            ...sessionBase,
            state,
            stopReason: "user",
            stoppedAt: "2026-09-29T14:05:00.000Z"
          },
    documentId: "document-7",
    currentUrl: "https://example.com/form",
    recordedEvents: [
      {
        version: 1,
        eventId: "input-event",
        sessionId: "recorder-7",
        tabId: 7,
        documentId: "document-7",
        occurredAt: "2026-09-29T14:01:00.000Z",
        url: "https://example.com/form",
        kind: "input",
        target: { locators: [{ type: "testId", value: "email" }] },
        payload: { value: "first@example.com", inputType: "email" }
      }
    ],
    draftSteps: [
      {
        id: "input-email",
        name: "Enter email",
        type: "input",
        enabled: true,
        target: {
          primary: { type: "testId", value: "email" },
          fallbacks: []
        },
        value: "first@example.com",
        clearFirst: true,
        inputMode: "default"
      }
    ]
  };
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
