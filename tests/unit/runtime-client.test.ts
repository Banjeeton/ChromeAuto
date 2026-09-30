import { describe, expect, it, vi } from "vitest";

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
    ).rejects.toThrow(/Background did not respond to .*sessions.* within 5 ms.*chrome:\/\/extensions/);
  });

  it("reconnects once after a transient service-worker disconnect using the same request id", async () => {
    const sender = vi.fn()
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockResolvedValueOnce({
        ok: true,
        result: { kind: "stop", stop: { stopped: false, tabId: 7 } }
      });

    await expect(sendRuntimeMessage(
      { type: AUTOMATION_RUNTIME_MESSAGE, action: "stop", tabId: 7 },
      { sender, retryDelayMs: 0, timeoutMs: 50 }
    )).resolves.toMatchObject({ ok: true });

    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[0][0].requestId).toBeTruthy();
    expect(sender.mock.calls[1][0].requestId).toBe(
      sender.mock.calls[0][0].requestId
    );
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
