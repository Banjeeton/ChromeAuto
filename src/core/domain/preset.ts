import type {
  AutomationDefinition,
  SiteSettings
} from "./automation";
import type { SiteBinding } from "./site-binding";

export interface PresetV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  site: SiteBinding;
  automation: AutomationDefinition;
  siteSettings: SiteSettings;
}

export type { AutomationDefinition, SiteSettings } from "./automation";
export type {
  AutomationStep,
  ElementLocator,
  ElementTarget
} from "./automation-step";
export type { SiteBinding, SiteProtocol } from "./site-binding";
