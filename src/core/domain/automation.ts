import type { AutomationStep } from "./automation-step";

export interface HumanInputDefaults {
  enabled: boolean;
  minDelayMs: number;
  maxDelayMs: number;
}

export interface AutomationDefaults {
  timeoutMs: number;
  postActionDelayMs: number;
  humanInput: HumanInputDefaults;
}

export interface AutomationDefinition {
  defaults: AutomationDefaults;
  steps: AutomationStep[];
}

export interface RepeatSettings {
  enabled: boolean;
  intervalMinutes: number;
}

export interface SiteSettings {
  enabled: boolean;
  repeat: RepeatSettings;
}
