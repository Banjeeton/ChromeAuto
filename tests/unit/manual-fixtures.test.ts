import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("manual regression fixtures", () => {
  it("isolates password controls from the Playwright execution fixture", () => {
    const executionFixture = readFixture("playwright-crx-fixture.html");
    const passwordFixture = readFixture("recorder-password-fixture.html");

    expect(executionFixture).not.toMatch(/type=["']password["']/i);
    expect(passwordFixture).toMatch(/type=["']password["']/i);
    expect(passwordFixture).toContain("data-recorder-password");
  });
});

function readFixture(fileName: string): string {
  return readFileSync(resolve(process.cwd(), "public", fileName), "utf8");
}
