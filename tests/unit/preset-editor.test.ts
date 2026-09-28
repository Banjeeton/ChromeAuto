import { describe, expect, it, vi } from "vitest";

import {
  createPresetEditorDefaults,
  duplicateFieldsFromPreset,
  PresetEditorController,
  PresetNotFoundError,
  createPresetV1,
  editableFieldsFromPreset,
  updatePresetV1
} from "../../src/core/application/preset-editor";
import type { PresetV1 } from "../../src/core/domain/preset";
import { assertValidPreset } from "../../src/core/domain/preset-validator";
import type { PresetRepository } from "../../src/core/ports/preset-repository";

describe("preset editor application helpers", () => {
  it("creates a preset with generated identity and timestamps", () => {
    const fields = createPresetEditorDefaults("example.com");
    fields.name = "Example automation";
    const now = new Date("2026-09-28T08:00:00.000Z");

    const preset = createPresetV1(fields, {
      createId: () => "550e8400-e29b-41d4-a716-446655440000",
      now: () => now
    });

    expect(preset).toMatchObject({
      schemaVersion: 1,
      id: "550e8400-e29b-41d4-a716-446655440000",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      name: "Example automation",
      site: { hostname: "example.com" }
    });
    expect(() => assertValidPreset(preset)).not.toThrow();
  });

  it("preserves id and createdAt while advancing updatedAt", () => {
    const initialFields = createPresetEditorDefaults("example.com");
    initialFields.name = "Initial name";
    const existing = createPresetV1(initialFields, {
      createId: () => "550e8400-e29b-41d4-a716-446655440000",
      now: () => new Date("2026-09-28T08:00:00.000Z")
    });
    const edited = editableFieldsFromPreset(existing);
    edited.name = "Updated name";

    const updated = updatePresetV1(existing, edited, {
      now: () => new Date("2026-09-28T09:30:00.000Z")
    });

    expect(updated).toMatchObject({
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: "2026-09-28T09:30:00.000Z",
      name: "Updated name"
    });
  });

  it("always changes updatedAt when the clock has not advanced", () => {
    const fields = createPresetEditorDefaults("example.com");
    fields.name = "Example automation";
    const existing = createPresetV1(fields, {
      createId: () => "550e8400-e29b-41d4-a716-446655440000",
      now: () => new Date("2026-09-28T08:00:00.000Z")
    });

    expect(
      updatePresetV1(existing, fields, {
        now: () => new Date("2026-09-28T08:00:00.000Z")
      }).updatedAt
    ).toBe("2026-09-28T08:00:00.001Z");
  });

  it("returns detached editable fields", () => {
    const fields = createPresetEditorDefaults("example.com");
    fields.name = "Example automation";
    const preset = createPresetV1(fields, {
      createId: () => "550e8400-e29b-41d4-a716-446655440000"
    });
    const editable = editableFieldsFromPreset(preset);

    editable.site.hostname = "changed.example.com";
    expect(preset.site.hostname).toBe("example.com");
  });

  it("creates and updates presets through the repository", async () => {
    let stored: PresetV1 | undefined;
    const repository = createRepository(
      () => stored,
      (preset) => {
        stored = structuredClone(preset);
      }
    );
    let currentTime = new Date("2026-09-28T08:00:00.000Z");
    const controller = new PresetEditorController(repository, {
      createId: () => "550e8400-e29b-41d4-a716-446655440000",
      now: () => currentTime
    });
    const fields = createPresetEditorDefaults("example.com");
    fields.name = "Initial name";

    const created = await controller.create(fields);
    currentTime = new Date("2026-09-28T09:00:00.000Z");
    fields.name = "Updated name";
    const updated = await controller.update(created.id, fields);

    expect(repository.save).toHaveBeenCalledTimes(2);
    expect(updated).toMatchObject({
      id: created.id,
      createdAt: created.createdAt,
      updatedAt: currentTime.toISOString(),
      name: "Updated name"
    });
  });

  it("does not create a result when repository validation rejects save", async () => {
    const validationError = new Error("Preset validation failed at /name");
    const repository = createRepository(
      () => undefined,
      () => {
        throw validationError;
      }
    );
    const controller = new PresetEditorController(repository);

    await expect(
      controller.create(createPresetEditorDefaults("example.com"))
    ).rejects.toBe(validationError);
  });

  it("rejects editing a preset that no longer exists", async () => {
    const repository = createRepository(() => undefined, () => undefined);
    const controller = new PresetEditorController(repository);

    await expect(
      controller.update(
        "550e8400-e29b-41d4-a716-446655440000",
        createPresetEditorDefaults("example.com")
      )
    ).rejects.toBeInstanceOf(PresetNotFoundError);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("prepares a detached duplicate with the original steps and settings", () => {
    const fields = createPresetEditorDefaults("example.com");
    fields.name = "Example automation";
    fields.automation.steps = [
      {
        id: "wait-ready",
        type: "wait",
        enabled: true,
        condition: { type: "timeout", durationMs: 250 }
      }
    ];
    fields.siteSettings.repeat = { enabled: true, intervalMinutes: 5 };
    const source = createPresetV1(fields, {
      createId: () => "550e8400-e29b-41d4-a716-446655440000",
      now: () => new Date("2026-09-28T08:00:00.000Z")
    });

    const duplicate = duplicateFieldsFromPreset(source);

    expect(duplicate).toMatchObject({
      name: "Example automation copy",
      site: { hostname: "", protocols: ["https"] },
      automation: source.automation,
      siteSettings: source.siteSettings
    });
    duplicate.automation.steps[0].enabled = false;
    expect(source.automation.steps[0].enabled).toBe(true);
  });

  it("saves a duplicate with separate identity and timestamps", async () => {
    const sourceFields = createPresetEditorDefaults("example.com");
    sourceFields.name = "Example automation";
    const source = createPresetV1(sourceFields, {
      createId: () => "550e8400-e29b-41d4-a716-446655440000",
      now: () => new Date("2026-09-28T08:00:00.000Z")
    });
    let saved: PresetV1 | undefined;
    const repository = createRepository(
      () => source,
      (preset) => {
        saved = preset;
      }
    );
    const controller = new PresetEditorController(repository, {
      createId: () => "550e8400-e29b-41d4-a716-446655440001",
      now: () => new Date("2026-09-28T09:00:00.000Z")
    });
    const duplicateFields = duplicateFieldsFromPreset(source);
    duplicateFields.site.hostname = "copy.example.com";

    const duplicate = await controller.create(duplicateFields);

    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.createdAt).not.toBe(source.createdAt);
    expect(duplicate.updatedAt).not.toBe(source.updatedAt);
    expect(duplicate.automation).toEqual(source.automation);
    expect(duplicate.siteSettings).toEqual(source.siteSettings);
    expect(saved).toEqual(duplicate);
  });

  it("deletes an existing preset and returns its snapshot", async () => {
    const fields = createPresetEditorDefaults("example.com");
    fields.name = "Example automation";
    let stored: PresetV1 | undefined = createPresetV1(fields, {
      createId: () => "550e8400-e29b-41d4-a716-446655440000"
    });
    const repository = createRepository(
      () => stored,
      () => undefined,
      () => {
        stored = undefined;
        return true;
      }
    );
    const controller = new PresetEditorController(repository);

    const deleted = await controller.remove(
      "550e8400-e29b-41d4-a716-446655440000"
    );

    expect(deleted.id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(repository.remove).toHaveBeenCalledOnce();
  });

  it("leaves the source intact when deletion fails", async () => {
    const fields = createPresetEditorDefaults("example.com");
    fields.name = "Example automation";
    const source = createPresetV1(fields, {
      createId: () => "550e8400-e29b-41d4-a716-446655440000"
    });
    const deleteError = new Error("Storage write failed");
    const repository = createRepository(
      () => source,
      () => undefined,
      () => {
        throw deleteError;
      }
    );
    const controller = new PresetEditorController(repository);

    await expect(controller.remove(source.id)).rejects.toBe(deleteError);
    expect(await repository.getById(source.id)).toEqual(source);
  });
});

function createRepository(
  read: () => PresetV1 | undefined,
  write: (preset: PresetV1) => void,
  remove: (presetId: string) => boolean = () => false
): PresetRepository & {
  save: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    list: vi.fn(async () => {
      const preset = read();
      return preset === undefined ? [] : [preset];
    }),
    getById: vi.fn(async () => read()),
    save: vi.fn(async (preset: PresetV1) => write(preset)),
    saveIfUnchanged: vi.fn(async (preset: PresetV1) => {
      write(preset);
      return true;
    }),
    saveReplacingActiveHostname: vi.fn(async (preset: PresetV1) =>
      write(preset)
    ),
    remove: vi.fn(async (presetId: string) => remove(presetId))
  };
}
