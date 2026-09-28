import type { PresetRepository } from "../ports/preset-repository";
import type { RepeatCycleRegistry } from "../ports/repeat-cycle-registry";

export interface RepeatCycleStatusView {
  readonly tabId: number;
  readonly presetId: string;
  readonly presetName: string;
  readonly state: "running" | "waiting";
  readonly intervalMinutes: number;
  readonly nextRunAt?: number;
}

export class RepeatCycleStatusController {
  constructor(
    private readonly registry: Pick<RepeatCycleRegistry, "list">,
    private readonly presets: Pick<PresetRepository, "list">
  ) {}

  async list(): Promise<readonly RepeatCycleStatusView[]> {
    const [states, presets] = await Promise.all([
      this.registry.list(),
      this.presets.list()
    ]);
    const presetsById = new Map(presets.map((preset) => [preset.id, preset]));

    return Object.freeze(
      states.flatMap((state) => {
        if (state.state !== "running" && state.state !== "waiting") {
          return [];
        }
        const preset = presetsById.get(state.presetId);
        if (preset === undefined) {
          return [];
        }
        return [
          Object.freeze({
            tabId: state.tabId,
            presetId: state.presetId,
            presetName: preset.name,
            state: state.state,
            intervalMinutes: preset.siteSettings.repeat.intervalMinutes,
            ...(state.nextRunAt === undefined
              ? {}
              : { nextRunAt: state.nextRunAt })
          })
        ];
      })
    );
  }
}
