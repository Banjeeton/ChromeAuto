import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const requirements = readFileSync(
  new URL("../../docs/release-candidate.md", import.meta.url),
  "utf8"
);

describe("Release Candidate documentation", () => {
  it("fixes the RC scope, Definition of Done and defect severity model", () => {
    expect(requirements).toContain("## Функции, входящие в RC");
    expect(requirements).toContain("## Функции вне границ RC");
    expect(requirements).toContain("## Definition of Done");
    expect(requirements).toContain("### Critical");
    expect(requirements).toContain("### High");
    expect(requirements).toContain("### Medium");
    expect(requirements).toContain("### Low");
  });

  it("defines Chrome support and mandatory automatic and manual gates", () => {
    expect(requirements).toContain("Google Chrome 118+");
    expect(requirements).toContain("Google Chrome 153 Stable");
    expect(requirements).toContain("## Обязательные автоматические проверки");
    expect(requirements).toContain("## Обязательные ручные проверки");
    expect(requirements).toContain("npm run verify");
    expect(requirements).toContain("Ручной regression run в Qase");
  });

  it("records Playwright CRX, Manifest V3 and experimental limitations", () => {
    expect(requirements).toContain("## Ограничения Playwright CRX");
    expect(requirements).toContain("## Ограничения Manifest V3");
    expect(requirements).toContain("## Экспериментальные и неподтверждённые возможности");
    expect(requirements).toContain("Cannot access a chrome-extension:// URL");
    expect(requirements).toContain("tests/e2e/extension-flow.spec.ts");
    expect(requirements).toContain("npm run test:e2e");
  });
});
