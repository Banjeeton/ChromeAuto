import type { AutomationStep } from "../../../core/domain/automation-step";

export const STEP_TYPES = [
  "click",
  "input",
  "select",
  "check",
  "uncheck",
  "pressKey",
  "wait",
  "reload",
  "customCode"
] as const satisfies readonly AutomationStep["type"][];

export function createStepTemplate(
  type: AutomationStep["type"],
  id = `step-${crypto.randomUUID()}`
): AutomationStep {
  const base = { id, type, enabled: true };
  const target = {
    primary: { type: "css" as const, value: "body" },
    fallbacks: []
  };

  switch (type) {
    case "click":
      return { ...base, type, target, button: "left", clickCount: 1 };
    case "input":
      return {
        ...base,
        type,
        target,
        value: "",
        clearFirst: true,
        inputMode: "default"
      };
    case "select":
      return {
        ...base,
        type,
        target,
        option: { by: "value", value: "" }
      };
    case "check":
      return { ...base, type, target };
    case "uncheck":
      return { ...base, type, target };
    case "pressKey":
      return { ...base, type, key: "Enter" };
    case "wait":
      return {
        ...base,
        type,
        condition: { type: "timeout", durationMs: 1_000 }
      };
    case "reload":
      return { ...base, type, waitUntil: "domcontentloaded" };
    case "customCode":
      return {
        ...base,
        type,
        language: "javascript",
        apiVersion: 1,
        executionContext: "page",
        source: "automation.log(document.title);"
      };
  }
}
