import { describe, expect, it } from "vitest";

import {
  RuntimeRequestError,
  errorTechnicalDetails,
  runtimeResponseError,
  sendRuntimeMessage
} from "../../src/sidepanel/runtime/runtime-client";
import { AUTOMATION_RUNTIME_MESSAGE } from "../../src/shared/types/automation-runtime";

describe("side panel runtime client", () => {
  it("returns a typed response supplied by the message transport", async () => {
    await expect(
      sendRuntimeMessage(
        { type: AUTOMATION_RUNTIME_MESSAGE, action: "presets" },
        {
          timeoutMs: 50,
          sender: async () => ({
            ok: true,
            result: { kind: "presets", presets: [] }
          })
        }
      )
    ).resolves.toMatchObject({ ok: true });
  });

  it("times out without coupling presentation components to chrome.runtime", async () => {
    await expect(
      sendRuntimeMessage(
        { type: AUTOMATION_RUNTIME_MESSAGE, action: "sessions" },
        { timeoutMs: 5, sender: () => new Promise(() => undefined) }
      )
    ).rejects.toThrow(/Background did not respond to .*sessions.* within 5 ms/);
  });

  it("preserves structured background error details for the run log", () => {
    const error = runtimeResponseError({
      ok: false,
      error: "Unable to run automation.",
      details: {
        name: "AutomationEngineError",
        message: "Debugger is unavailable.",
        code: "engine-unavailable",
        action: "run"
      }
    });

    expect(error).toBeInstanceOf(RuntimeRequestError);
    expect(errorTechnicalDetails(error)).toContain("Action: run");
    expect(errorTechnicalDetails(error)).toContain("engine-unavailable");
  });
});
