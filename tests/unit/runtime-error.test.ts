import { describe, expect, it } from "vitest";

import {
  createRuntimeErrorDetails,
  formatRuntimeErrorDetails
} from "../../src/shared/utils";

describe("automation runtime error diagnostics", () => {
  it("preserves the action, reason and technical context", () => {
    const cause = new Error("storage quota exceeded");
    const error = Object.assign(
      new Error("Preset could not be written", { cause }),
      {
        name: "PresetRepositoryWriteError",
        code: "storage_write_failed",
        issues: [{ path: "/name", message: "Name is required." }]
      }
    );

    const details = createRuntimeErrorDetails("create-preset", error);

    expect(details).toMatchObject({
      action: "create-preset",
      name: "PresetRepositoryWriteError",
      message: "Preset could not be written",
      code: "storage_write_failed",
      cause: "Error: storage quota exceeded"
    });
    expect(details.data).toContain("/name");
    expect(formatRuntimeErrorDetails(details)).toContain(
      "Action: create-preset"
    );
    expect(formatRuntimeErrorDetails(details)).toContain(
      "Cause: Error: storage quota exceeded"
    );
  });

  it("serializes non-Error failures without losing their reason", () => {
    expect(createRuntimeErrorDetails("presets", "connection closed")).toEqual({
      action: "presets",
      name: "UnknownError",
      message: "connection closed"
    });
  });

  it("redacts credentials and URL query data from technical errors", () => {
    const error = Object.assign(
      new Error(
        "Request failed at https://example.com/account?token=url-secret password=form-secret"
      ),
      { authorization: "Bearer-secret", cookie: "session-secret" }
    );

    const serialized = JSON.stringify(createRuntimeErrorDetails("run", error));
    expect(serialized).not.toContain("url-secret");
    expect(serialized).not.toContain("form-secret");
    expect(serialized).not.toContain("Bearer-secret");
    expect(serialized).not.toContain("session-secret");
    expect(serialized).toContain("[REDACTED]");
  });
});
