import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AutomationEngineError,
  isAutomationEngineError
} from "../../src/core/domain/automation-engine-error";
import type {
  AutomationEngine,
  AutomationSessionHandle,
  AutomationStepExecutionResult,
  ExecuteAutomationStepRequest,
  StartAutomationRequest,
  StopAllAutomationsRequest,
  StopAutomationRequest
} from "../../src/core/ports/automation-engine";

describe("AutomationEngine port", () => {
  it("defines the complete engine lifecycle without driver-specific types", () => {
    expectTypeOf<AutomationEngine["start"]>().toEqualTypeOf<
      (request: StartAutomationRequest) => Promise<AutomationSessionHandle>
    >();
    expectTypeOf<AutomationEngine["executeStep"]>().toEqualTypeOf<
      (
        request: ExecuteAutomationStepRequest
      ) => Promise<AutomationStepExecutionResult>
    >();
    expectTypeOf<AutomationEngine["complete"]>().toBeFunction();
    expectTypeOf<AutomationEngine["stop"]>().toEqualTypeOf<
      (request: StopAutomationRequest) => Promise<void>
    >();
    expectTypeOf<AutomationEngine["stopAll"]>().toEqualTypeOf<
      (request: StopAllAutomationsRequest) => Promise<void>
    >();
  });
});

describe("AutomationEngineError", () => {
  it("preserves a stable code, execution context and original cause", () => {
    const cause = new Error("Playwright detail that must not leak to core");
    const error = new AutomationEngineError(
      "step-timeout",
      "Step timed out",
      {
        cause,
        context: {
          sessionId: "session-1",
          tabId: 42,
          stepId: "wait-for-dialog",
          stepIndex: 3
        }
      }
    );

    expect(error).toMatchObject({
      name: "AutomationEngineError",
      code: "step-timeout",
      message: "Step timed out",
      context: {
        sessionId: "session-1",
        tabId: 42,
        stepId: "wait-for-dialog",
        stepIndex: 3
      },
      cause
    });
  });

  it("narrows only domain engine errors", () => {
    expect(
      isAutomationEngineError(
        new AutomationEngineError("engine-unavailable", "Unavailable")
      )
    ).toBe(true);
    expect(isAutomationEngineError(new Error("Unknown failure"))).toBe(false);
  });

  it("does not expose mutable error context", () => {
    const context = { sessionId: "session-1" };
    const error = new AutomationEngineError("session-not-found", "Missing", {
      context
    });

    context.sessionId = "changed-outside";

    expect(error.context.sessionId).toBe("session-1");
    expect(Object.isFrozen(error.context)).toBe(true);
  });
});
