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
});
