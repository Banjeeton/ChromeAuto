import { describe, expect, it, vi } from "vitest";

import {
  exportPresetJson,
  importPresetJson,
  importPresetJsonSafely,
  parsePresetJson,
  PresetJsonSyntaxError
} from "../../src/adapters/storage/preset-import-export";
import type { PresetV1 } from "../../src/core/domain/preset";
import { PresetValidationError } from "../../src/core/domain/preset-validator";
import type { PresetRepository } from "../../src/core/ports/preset-repository";
import validPresetJson from "../fixtures/presets/valid-full.json";

describe("preset JSON import and export", () => {
  it("validates and saves an imported preset", async () => {
    const repository = createRepository();
    const source = JSON.stringify(validPresetJson);

    await expect(importPresetJson(source, repository)).resolves.toEqual(
      validPresetJson
    );
    expect(repository.save).toHaveBeenCalledWith(validPresetJson);
  });

  it("requires explicit confirmation before overwriting an imported preset", async () => {
    const existing = structuredClone(validPresetJson) as PresetV1;
    existing.name = "Saved preset";
    const incoming = structuredClone(validPresetJson) as PresetV1;
    incoming.name = "Imported preset";
    const repository = createRepository(existing);

    await expect(
      importPresetJsonSafely(JSON.stringify(incoming), repository)
    ).resolves.toMatchObject({
      status: "confirmation-required",
      incomingPreset: { name: "Imported preset" },
      existingPreset: { name: "Saved preset" }
    });
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.saveIfUnchanged).not.toHaveBeenCalled();
  });

  it("overwrites only the unchanged preset that the user confirmed", async () => {
    const existing = structuredClone(validPresetJson) as PresetV1;
    const incoming = structuredClone(validPresetJson) as PresetV1;
    incoming.name = "Imported preset";
    const repository = createRepository(existing);

    await expect(
      importPresetJsonSafely(
        JSON.stringify(incoming),
        repository,
        existing.updatedAt
      )
    ).resolves.toMatchObject({
      status: "imported",
      preset: { name: "Imported preset" }
    });
    expect(repository.saveIfUnchanged).toHaveBeenCalledWith(
      incoming,
      existing.updatedAt
    );
  });

  it("asks again when the saved preset changed after confirmation", async () => {
    const existing = structuredClone(validPresetJson) as PresetV1;
    existing.updatedAt = "2026-09-28T12:00:00.000Z";
    const repository = createRepository(existing);

    await expect(
      importPresetJsonSafely(
        JSON.stringify(validPresetJson),
        repository,
        "2026-09-27T12:00:00.000Z"
      )
    ).resolves.toMatchObject({ status: "confirmation-required" });
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.saveIfUnchanged).not.toHaveBeenCalled();
  });

  it("reports malformed JSON at the document root", () => {
    expect(() => parsePresetJson("{not-json"))
      .toThrowError(PresetJsonSyntaxError);

    try {
      parsePresetJson("{not-json");
    } catch (error) {
      expect(error).toMatchObject({
        path: "/",
        issues: [
          {
            code: "schema_json_syntax",
            path: "/",
            message: "The file is not valid JSON."
          }
        ]
      });
    }
  });

  it("does not save a structurally invalid import", async () => {
    const repository = createRepository();
    const invalid = structuredClone(validPresetJson) as Record<string, unknown>;
    delete invalid.name;

    await expect(
      importPresetJson(JSON.stringify(invalid), repository)
    ).rejects.toMatchObject({
      name: "PresetValidationError",
      issues: [
        expect.objectContaining({
          code: "schema_required",
          path: "/name"
        })
      ]
    } satisfies Partial<PresetValidationError>);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("does not save a semantically invalid import", async () => {
    const repository = createRepository();
    const invalid = structuredClone(validPresetJson) as PresetV1;
    invalid.automation.steps[1].id = invalid.automation.steps[0].id;

    await expect(
      importPresetJson(JSON.stringify(invalid), repository)
    ).rejects.toMatchObject({
      name: "PresetValidationError",
      issues: [
        expect.objectContaining({
          code: "duplicate_step_id",
          path: "/automation/steps/1/id"
        })
      ]
    } satisfies Partial<PresetValidationError>);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("exports only a valid portable preset", () => {
    const preset = structuredClone(validPresetJson) as PresetV1;
    const exported = JSON.parse(exportPresetJson(preset)) as PresetV1;
    expect(exported).toEqual(validPresetJson);
    expect(exported.automation).toEqual(validPresetJson.automation);
    expect(exported.siteSettings).toEqual(validPresetJson.siteSettings);
    expect(exported).not.toHaveProperty("runtimeState");

    preset.automation.steps[1].id = preset.automation.steps[0].id;
    expect(() => exportPresetJson(preset)).toThrowError(PresetValidationError);
  });
});

function createRepository(existing?: PresetV1): PresetRepository & {
  save: ReturnType<typeof vi.fn>;
  saveIfUnchanged: ReturnType<typeof vi.fn>;
} {
  return {
    list: vi.fn(async () => (existing === undefined ? [] : [existing])),
    getById: vi.fn(async (id: string) =>
      existing?.id === id ? structuredClone(existing) : undefined
    ),
    save: vi.fn(async () => undefined),
    saveIfUnchanged: vi.fn(
      async (_preset: PresetV1, expectedUpdatedAt: string | null) =>
        expectedUpdatedAt === (existing?.updatedAt ?? null)
    ),
    saveReplacingActiveHostname: vi.fn(async () => undefined),
    remove: vi.fn(async () => false)
  };
}
