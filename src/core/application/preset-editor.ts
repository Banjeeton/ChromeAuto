import type { PresetV1, SiteProtocol } from "../domain/preset";
import type { PresetRepository } from "../ports/preset-repository";

export type PresetEditableFields = Pick<
  PresetV1,
  "name" | "description" | "site" | "automation" | "siteSettings"
>;

export type PresetCreationDependencies = {
  readonly createId?: () => string;
  readonly now?: () => Date;
};

export type PresetUpdateDependencies = {
  readonly now?: () => Date;
};

export class PresetNotFoundError extends Error {
  readonly presetId: string;
  readonly operation: "update" | "delete";

  constructor(presetId: string, operation: "update" | "delete" = "update") {
    super(
      `Preset ${presetId} no longer exists and cannot be ${
        operation === "update" ? "updated" : "deleted"
      }.`
    );
    this.name = "PresetNotFoundError";
    this.presetId = presetId;
    this.operation = operation;
  }
}

export class PresetEditorController {
  readonly #repository: PresetRepository;
  readonly #dependencies: PresetCreationDependencies;

  constructor(
    repository: PresetRepository,
    dependencies: PresetCreationDependencies = {}
  ) {
    this.#repository = repository;
    this.#dependencies = dependencies;
  }

  async create(fields: PresetEditableFields): Promise<PresetV1> {
    const preset = createPresetV1(fields, this.#dependencies);
    await this.#repository.save(preset);
    return structuredClone(preset);
  }

  async update(
    presetId: string,
    fields: PresetEditableFields
  ): Promise<PresetV1> {
    const existing = await this.#repository.getById(presetId);
    if (existing === undefined) {
      throw new PresetNotFoundError(presetId);
    }

    const preset = updatePresetV1(existing, fields, this.#dependencies);
    await this.#repository.save(preset);
    return structuredClone(preset);
  }

  async remove(presetId: string): Promise<PresetV1> {
    const existing = await this.#repository.getById(presetId);
    if (existing === undefined || !(await this.#repository.remove(presetId))) {
      throw new PresetNotFoundError(presetId, "delete");
    }

    return structuredClone(existing);
  }
}

export function createPresetV1(
  fields: PresetEditableFields,
  dependencies: PresetCreationDependencies = {}
): PresetV1 {
  const timestamp = (dependencies.now ?? (() => new Date()))().toISOString();

  return assemblePreset(
    (dependencies.createId ?? (() => crypto.randomUUID()))(),
    timestamp,
    timestamp,
    fields
  );
}

export function updatePresetV1(
  existing: PresetV1,
  fields: PresetEditableFields,
  dependencies: PresetUpdateDependencies = {}
): PresetV1 {
  const timestamp = (dependencies.now ?? (() => new Date()))().toISOString();
  return assemblePreset(
    existing.id,
    existing.createdAt,
    nextTimestamp(existing.updatedAt, timestamp),
    fields
  );
}

export function editableFieldsFromPreset(
  preset: PresetV1
): PresetEditableFields {
  return cloneEditableFields(preset);
}

export function duplicateFieldsFromPreset(
  preset: PresetV1
): PresetEditableFields {
  const fields = cloneEditableFields(preset);
  return {
    ...fields,
    name: `${fields.name} copy`,
    site: {
      ...fields.site,
      hostname: preset.siteSettings.enabled ? "" : fields.site.hostname
    }
  };
}

export function createPresetEditorDefaults(
  hostname = "",
  protocol: SiteProtocol = "https"
): PresetEditableFields {
  return {
    name: "",
    description: "",
    site: {
      hostname: hostname.toLowerCase(),
      protocols: [protocol]
    },
    automation: {
      defaults: {
        timeoutMs: 10_000,
        postActionDelayMs: 0,
        humanInput: {
          enabled: false,
          minDelayMs: 40,
          maxDelayMs: 120
        }
      },
      steps: []
    },
    siteSettings: {
      enabled: true,
      repeat: {
        enabled: false,
        intervalMinutes: 1
      }
    }
  };
}

function assemblePreset(
  id: string,
  createdAt: string,
  updatedAt: string,
  fields: PresetEditableFields
): PresetV1 {
  const editable = cloneEditableFields(fields);
  return {
    schemaVersion: 1,
    id,
    name: editable.name,
    ...(editable.description === undefined
      ? {}
      : { description: editable.description }),
    createdAt,
    updatedAt,
    site: editable.site,
    automation: editable.automation,
    siteSettings: editable.siteSettings
  };
}

function cloneEditableFields(
  fields: PresetEditableFields
): PresetEditableFields {
  return structuredClone({
    name: fields.name,
    ...(fields.description === undefined
      ? {}
      : { description: fields.description }),
    site: fields.site,
    automation: fields.automation,
    siteSettings: fields.siteSettings
  });
}

function nextTimestamp(previous: string, current: string): string {
  if (Date.parse(current) > Date.parse(previous)) {
    return current;
  }

  return new Date(Date.parse(previous) + 1).toISOString();
}
