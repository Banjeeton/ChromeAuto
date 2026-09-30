import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import manifest from "../../public/manifest.json";
import { RECORDER_EVENT_KINDS } from "../../src/core/domain/recorder-event";

describe("extension security audit", () => {
  it("keeps the reviewed minimal permission set", () => {
    expect([...manifest.permissions].sort()).toEqual([
      "alarms",
      "debugger",
      "scripting",
      "sidePanel",
      "storage",
      "tabs",
      "webNavigation"
    ]);
    expect(manifest.host_permissions).toEqual(["http://*/*", "https://*/*"]);
    for (const forbidden of [
      "cookies",
      "history",
      "downloads",
      "clipboardRead",
      "clipboardWrite",
      "management"
    ]) {
      expect(manifest.permissions).not.toContain(forbidden);
    }
  });

  it("does not expose customCode as a recorder event", () => {
    expect(RECORDER_EVENT_KINDS).not.toContain("customCode");
  });

  it("documents every permission and the custom-code trust boundary", () => {
    const audit = readFileSync(
      resolve(process.cwd(), "docs/security-audit.md"),
      "utf8"
    );
    for (const permission of manifest.permissions) {
      expect(audit).toContain(`\`${permission}\``);
    }
    expect(audit).toContain("Recorder не создаёт `customCode`");
    expect(audit).toContain("input[type=password]");
  });
});
