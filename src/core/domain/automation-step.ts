export type MouseButton = "left" | "right" | "middle";

export interface CssLocator {
  type: "css";
  value: string;
}

export interface XPathLocator {
  type: "xpath";
  value: string;
}

export interface TestIdLocator {
  type: "testId";
  value: string;
}

export interface TextLocator {
  type: "text";
  value: string;
  exact: boolean;
}

export interface LabelLocator {
  type: "label";
  value: string;
  exact: boolean;
}

export interface PlaceholderLocator {
  type: "placeholder";
  value: string;
  exact: boolean;
}

export interface RoleLocator {
  type: "role";
  role: string;
  name: string;
  exact: boolean;
}

export type ElementLocator =
  | CssLocator
  | XPathLocator
  | TestIdLocator
  | TextLocator
  | LabelLocator
  | PlaceholderLocator
  | RoleLocator;

export interface ElementTarget {
  primary: ElementLocator;
  fallbacks: ElementLocator[];
}

export interface AutomationStepBase {
  id: string;
  name?: string;
  enabled: boolean;
  timeoutMs?: number;
  postActionDelayMs?: number;
}

export interface ClickStep extends AutomationStepBase {
  type: "click";
  target: ElementTarget;
  button: MouseButton;
  clickCount: number;
}

export type InputMode = "instant" | "human" | "default";

export interface HumanInputOverride {
  minDelayMs: number;
  maxDelayMs: number;
}

export interface InputStep extends AutomationStepBase {
  type: "input";
  target: ElementTarget;
  value: string;
  clearFirst: boolean;
  inputMode: InputMode;
  humanInput?: HumanInputOverride;
}

export type SelectOption =
  | {
      by: "value" | "label";
      value: string;
    }
  | {
      by: "index";
      value: number;
    };

export interface SelectStep extends AutomationStepBase {
  type: "select";
  target: ElementTarget;
  option: SelectOption;
}

export interface CheckStep extends AutomationStepBase {
  type: "check";
  target: ElementTarget;
}

export interface UncheckStep extends AutomationStepBase {
  type: "uncheck";
  target: ElementTarget;
}

export interface PressKeyStep extends AutomationStepBase {
  type: "pressKey";
  target?: ElementTarget;
  key: string;
}

export interface TimeoutWaitCondition {
  type: "timeout";
  durationMs: number;
}

export interface ElementWaitCondition {
  type: "element";
  state: "attached" | "detached" | "visible" | "hidden";
  target: ElementTarget;
}

export interface UrlWaitCondition {
  type: "url";
  match: "exact" | "contains" | "regex";
  value: string;
}

export interface PageLoadWaitCondition {
  type: "pageLoad";
  state: "domcontentloaded" | "load" | "networkidle";
}

export type WaitCondition =
  | TimeoutWaitCondition
  | ElementWaitCondition
  | UrlWaitCondition
  | PageLoadWaitCondition;

export interface WaitStep extends AutomationStepBase {
  type: "wait";
  condition: WaitCondition;
}

export interface ReloadStep extends AutomationStepBase {
  type: "reload";
  waitUntil: "domcontentloaded" | "load" | "networkidle" | "none";
}

export interface CustomCodeStep extends AutomationStepBase {
  type: "customCode";
  language: "javascript";
  apiVersion: 1;
  executionContext: "page";
  source: string;
}

export type AutomationStep =
  | ClickStep
  | InputStep
  | SelectStep
  | CheckStep
  | UncheckStep
  | PressKeyStep
  | WaitStep
  | ReloadStep
  | CustomCodeStep;
