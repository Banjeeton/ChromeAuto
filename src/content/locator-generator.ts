import type { ElementLocator } from "../core/domain/automation-step";
import { RecorderError } from "../core/domain/recorder-error";
import type { RecorderTargetCandidate } from "../core/domain/recorder-event";

export const DEFAULT_MAX_LOCATOR_FALLBACKS = 3;

export interface LocatorElement {
  readonly tagName: string;
  readonly textContent: string | null;
  readonly parentElement: LocatorElement | null;
  readonly children: ArrayLike<LocatorElement>;
  getAttribute(name: string): string | null;
}

export interface LocatorEnvironment {
  allElements(): readonly LocatorElement[];
  queryCss(selector: string): readonly LocatorElement[];
}

export interface LocatorGeneratorOptions {
  readonly maxFallbacks?: number;
}

interface EvaluatedLocator {
  readonly locator: ElementLocator;
  readonly matchCount: number;
}

/**
 * Creates a preset-v1 target whose primary and fallback locators uniquely
 * resolve to the recorded element. No Playwright types cross this boundary.
 */
export function generateStableLocatorTarget(
  element: LocatorElement,
  environment: LocatorEnvironment,
  options: LocatorGeneratorOptions = {}
): RecorderTargetCandidate {
  const maxFallbacks = normalizeFallbackLimit(options.maxFallbacks);
  const candidates = deduplicateLocators([
    ...testIdCandidates(element),
    ...roleCandidates(element, environment),
    ...labelCandidates(element, environment),
    ...placeholderCandidates(element),
    ...textCandidates(element),
    ...stableCssCandidates(element),
    ...structuralCssCandidates(element, environment)
  ]);

  const verified = candidates
    .map((locator): EvaluatedLocator | undefined => {
      const matches = resolveLocator(locator, environment);
      return matches.length === 1 && matches[0] === element
        ? { locator, matchCount: matches.length }
        : undefined;
    })
    .filter((candidate): candidate is EvaluatedLocator => candidate !== undefined);

  const primary = verified[0];
  if (primary === undefined) {
    throw new RecorderError(
      "invalid-target",
      "Unable to create a unique locator for the recorded element."
    );
  }

  return Object.freeze({
    locators: Object.freeze([
      primary.locator,
      ...verified.slice(1, maxFallbacks + 1).map(({ locator }) => locator)
    ])
  });
}

/** Browser adapter used by the content script. */
export function generateDomLocatorTarget(
  element: Element,
  options: LocatorGeneratorOptions = {}
): RecorderTargetCandidate {
  const root = element.getRootNode();
  if (!(root instanceof Document || root instanceof ShadowRoot)) {
    throw new RecorderError(
      "invalid-target",
      "The recorded element is not attached to a supported document root."
    );
  }
  return generateStableLocatorTarget(
    element as unknown as LocatorElement,
    createDomLocatorEnvironment(root),
    options
  );
}

export function createDomLocatorEnvironment(
  root: Document | ShadowRoot
): LocatorEnvironment {
  return {
    allElements: () =>
      [...root.querySelectorAll("*")] as unknown as LocatorElement[],
    queryCss: (selector) => {
      try {
        return [...root.querySelectorAll(selector)] as unknown as LocatorElement[];
      } catch {
        return [];
      }
    }
  };
}

function testIdCandidates(element: LocatorElement): ElementLocator[] {
  const testId = cleanValue(element.getAttribute("data-testid"));
  return testId === undefined ? [] : [{ type: "testId", value: testId }];
}

function roleCandidates(
  element: LocatorElement,
  environment: LocatorEnvironment
): ElementLocator[] {
  const role = explicitOrImplicitRole(element);
  const name = accessibleName(element, environment);
  return role === undefined || name === undefined
    ? []
    : [{ type: "role", role, name, exact: true }];
}

function labelCandidates(
  element: LocatorElement,
  environment: LocatorEnvironment
): ElementLocator[] {
  const label = associatedLabel(element, environment);
  return label === undefined
    ? []
    : [{ type: "label", value: label, exact: true }];
}

function placeholderCandidates(element: LocatorElement): ElementLocator[] {
  const placeholder = cleanValue(element.getAttribute("placeholder"));
  return placeholder === undefined
    ? []
    : [{ type: "placeholder", value: placeholder, exact: true }];
}

function textCandidates(element: LocatorElement): ElementLocator[] {
  const text = normalizedText(element.textContent);
  return text === undefined || text.length > 120
    ? []
    : [{ type: "text", value: text, exact: true }];
}

function stableCssCandidates(element: LocatorElement): ElementLocator[] {
  const candidates: ElementLocator[] = [];
  const tag = element.tagName.toLowerCase();
  const id = cleanValue(element.getAttribute("id"));
  if (id !== undefined && isStableIdentifier(id)) {
    candidates.push({ type: "css", value: `#${escapeCssIdentifier(id)}` });
  }

  for (const attribute of ["name", "data-action", "data-qa", "data-cy"] as const) {
    const value = cleanValue(element.getAttribute(attribute));
    if (value !== undefined && isStableAttributeValue(value)) {
      candidates.push({
        type: "css",
        value: `${tag}[${attribute}="${escapeCssAttribute(value)}"]`
      });
    }
  }

  const classNames = stableClassNames(element.getAttribute("class"));
  for (const className of classNames.slice(0, 2)) {
    candidates.push({
      type: "css",
      value: `${tag}.${escapeCssIdentifier(className)}`
    });
  }
  return candidates;
}

function structuralCssCandidates(
  element: LocatorElement,
  environment: LocatorEnvironment
): ElementLocator[] {
  const candidates: ElementLocator[] = [];
  const segments: string[] = [];
  let current: LocatorElement | null = element;
  let depth = 0;

  while (current !== null && depth < 6) {
    const stableId = cleanValue(current.getAttribute("id"));
    if (stableId !== undefined && isStableIdentifier(stableId)) {
      segments.unshift(`#${escapeCssIdentifier(stableId)}`);
      candidates.push({ type: "css", value: segments.join(" > ") });
      break;
    }

    segments.unshift(cssPathSegment(current));
    const selector = segments.join(" > ");
    const matches = safeQueryCss(environment, selector);
    if (matches.length === 1 && matches[0] === element) {
      candidates.push({ type: "css", value: selector });
      break;
    }
    current = current.parentElement;
    depth += 1;
  }
  return candidates;
}

function cssPathSegment(element: LocatorElement): string {
  const tag = element.tagName.toLowerCase();
  const className = stableClassNames(element.getAttribute("class"))[0];
  const base = className === undefined
    ? tag
    : `${tag}.${escapeCssIdentifier(className)}`;
  const parent = element.parentElement;
  if (parent === null) {
    return base;
  }

  const sameTagSiblings = [...Array.from(parent.children)].filter(
    (sibling) => sibling.tagName.toLowerCase() === tag
  );
  if (sameTagSiblings.length <= 1) {
    return base;
  }
  const position = sameTagSiblings.indexOf(element) + 1;
  return position > 0 ? `${base}:nth-of-type(${position})` : base;
}

function resolveLocator(
  locator: ElementLocator,
  environment: LocatorEnvironment
): readonly LocatorElement[] {
  switch (locator.type) {
    case "css":
      return safeQueryCss(environment, locator.value);
    case "xpath":
      return [];
    case "testId":
      return safeQueryCss(
        environment,
        `[data-testid="${escapeCssAttribute(locator.value)}"]`
      );
    case "role":
      return environment.allElements().filter((candidate) =>
        explicitOrImplicitRole(candidate) === locator.role &&
        accessibleName(candidate, environment) === locator.name
      );
    case "label":
      return environment.allElements().filter(
        (candidate) => associatedLabel(candidate, environment) === locator.value
      );
    case "placeholder":
      return environment.allElements().filter(
        (candidate) =>
          normalizedText(candidate.getAttribute("placeholder")) === locator.value
      );
    case "text":
      return environment.allElements().filter(
        (candidate) => normalizedText(candidate.textContent) === locator.value
      );
  }
}

function explicitOrImplicitRole(element: LocatorElement): string | undefined {
  const explicit = cleanValue(element.getAttribute("role"));
  if (explicit !== undefined) {
    return explicit;
  }

  const tag = element.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && element.getAttribute("href") !== null) return "link";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag !== "input") return undefined;

  switch ((element.getAttribute("type") ?? "text").toLowerCase()) {
    case "button":
    case "submit":
    case "reset":
      return "button";
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    case "range":
      return "slider";
    case "number":
      return "spinbutton";
    case "search":
      return "searchbox";
    case "hidden":
      return undefined;
    default:
      return "textbox";
  }
}

function accessibleName(
  element: LocatorElement,
  environment: LocatorEnvironment
): string | undefined {
  const ariaLabel = cleanValue(element.getAttribute("aria-label"));
  if (ariaLabel !== undefined) {
    return ariaLabel;
  }

  const labelledBy = cleanValue(element.getAttribute("aria-labelledby"));
  if (labelledBy !== undefined) {
    const value = labelledBy
      .split(/\s+/u)
      .map((id) =>
        environment
          .allElements()
          .find((candidate) => candidate.getAttribute("id") === id)
      )
      .map((candidate) => normalizedText(candidate?.textContent))
      .filter((text): text is string => text !== undefined)
      .join(" ");
    if (value.length > 0) {
      return value;
    }
  }

  const label = associatedLabel(element, environment);
  if (label !== undefined) {
    return label;
  }
  const alt = cleanValue(element.getAttribute("alt"));
  if (alt !== undefined) {
    return alt;
  }
  const value = cleanValue(element.getAttribute("value"));
  if (
    value !== undefined &&
    element.tagName.toLowerCase() === "input" &&
    explicitOrImplicitRole(element) === "button"
  ) {
    return value;
  }
  return normalizedText(element.textContent);
}

function associatedLabel(
  element: LocatorElement,
  environment: LocatorEnvironment
): string | undefined {
  const ariaLabel = cleanValue(element.getAttribute("aria-label"));
  if (ariaLabel !== undefined) {
    return ariaLabel;
  }

  const id = cleanValue(element.getAttribute("id"));
  if (id !== undefined) {
    const explicit = environment
      .allElements()
      .find(
        (candidate) =>
          candidate.tagName.toLowerCase() === "label" &&
          candidate.getAttribute("for") === id
      );
    const text = normalizedText(explicit?.textContent);
    if (text !== undefined) {
      return text;
    }
  }

  let parent = element.parentElement;
  while (parent !== null) {
    if (parent.tagName.toLowerCase() === "label") {
      return normalizedText(parent.textContent);
    }
    parent = parent.parentElement;
  }
  return undefined;
}

function stableClassNames(value: string | null): string[] {
  if (value === null) {
    return [];
  }
  return value
    .split(/\s+/u)
    .map((className) => className.trim())
    .filter(
      (className) =>
        className.length > 0 &&
        isStableIdentifier(className) &&
        !/^(active|checked|disabled|focus|focused|hover|open|selected)$/iu.test(
          className
        ) &&
        !/^(css|sc|jsx)-[a-z0-9]{5,}$/iu.test(className)
    );
}

function isStableIdentifier(value: string): boolean {
  return (
    isStableAttributeValue(value) &&
    !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(value) &&
    !/^[0-9a-f]{8,}$/iu.test(value) &&
    !/(?:^|[-_:])\d{5,}(?:$|[-_:])/u.test(value) &&
    !/^:r[0-9a-z]+:$/iu.test(value)
  );
}

function isStableAttributeValue(value: string): boolean {
  return value.length <= 100 && !/^\s*$/u.test(value);
}

function normalizeFallbackLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_LOCATOR_FALLBACKS;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError("maxFallbacks must be a non-negative integer.");
  }
  return Math.min(value, 5);
}

function deduplicateLocators(
  candidates: readonly ElementLocator[]
): ElementLocator[] {
  const unique = new Map<string, ElementLocator>();
  for (const candidate of candidates) {
    unique.set(JSON.stringify(candidate), candidate);
  }
  return [...unique.values()];
}

function safeQueryCss(
  environment: LocatorEnvironment,
  selector: string
): readonly LocatorElement[] {
  try {
    return environment.queryCss(selector);
  } catch {
    return [];
  }
}

function cleanValue(value: string | null): string | undefined {
  const normalized = normalizedText(value);
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}

function normalizedText(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const normalized = value.replaceAll(/\s+/gu, " ").trim();
  return normalized.length === 0 ? undefined : normalized;
}

function escapeCssIdentifier(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replaceAll(/([^a-zA-Z0-9_-])/g, "\\$1");
}

function escapeCssAttribute(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
