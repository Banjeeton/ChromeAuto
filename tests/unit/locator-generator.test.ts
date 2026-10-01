import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DEFAULT_MAX_LOCATOR_FALLBACKS,
  generateStableLocatorTarget,
  type LocatorElement,
  type LocatorEnvironment
} from "../../src/content/locator-generator";
import type { ElementLocator } from "../../src/core/domain/automation-step";
import { RecorderError } from "../../src/core/domain/recorder-error";
import type { RecorderTargetCandidate } from "../../src/core/domain/recorder-event";

describe("stable locator generator", () => {
  it("prioritizes testId, role, label and placeholder", () => {
    const label = new FakeElement("label", { for: "email-field" }, "Email");
    const input = new FakeElement("input", {
      id: "email-field",
      name: "email",
      placeholder: "you@example.com",
      "data-testid": "email-input"
    });
    const environment = new FakeLocatorEnvironment([label, input])
      .resolve('[data-testid="email-input"]', input)
      .resolve("#email-field", input)
      .resolve('input[name="email"]', input)
      .resolve("input", input);

    const target = generateStableLocatorTarget(input, environment);

    expect(target.locators).toEqual([
      { type: "testId", value: "email-input" },
      { type: "role", role: "textbox", name: "Email", exact: true },
      { type: "label", value: "Email", exact: true },
      { type: "placeholder", value: "you@example.com", exact: true }
    ]);
    expect(target.locators).toHaveLength(
      DEFAULT_MAX_LOCATOR_FALLBACKS + 1
    );
  });

  it("skips a duplicated testId and verifies role against the source element", () => {
    const primary = new FakeElement("button", {
      id: "primary-save",
      "data-testid": "save",
      "aria-label": "Save primary"
    });
    const secondary = new FakeElement("button", {
      id: "secondary-save",
      "data-testid": "save",
      "aria-label": "Save secondary"
    });
    const environment = new FakeLocatorEnvironment([primary, secondary])
      .resolve('[data-testid="save"]', primary, secondary)
      .resolve("#primary-save", primary)
      .resolve("button", primary, secondary);

    const target = generateStableLocatorTarget(primary, environment);

    expect(target.locators[0]).toEqual({
      type: "role",
      role: "button",
      name: "Save primary",
      exact: true
    });
    expect(target.locators).not.toContainEqual({
      type: "testId",
      value: "save"
    });
  });

  it("uses stable attributes and excludes dynamic ids and classes", () => {
    const element = new FakeElement("div", {
      id: ":r7:",
      class: "css-a1b2c3 active",
      "data-action": "checkout"
    });
    const environment = new FakeLocatorEnvironment([element])
      .resolve('div[data-action="checkout"]', element)
      .resolve("div", element);

    const target = generateStableLocatorTarget(element, environment);

    expect(target.locators[0]).toEqual({
      type: "css",
      value: 'div[data-action="checkout"]'
    });
    expect(JSON.stringify(target)).not.toContain(":r7:");
    expect(JSON.stringify(target)).not.toContain("css-a1b2c3");
    expect(JSON.stringify(target)).not.toContain("active");
  });

  it("does not use all option text as the accessible name of a select", () => {
    const select = new FakeElement(
      "select",
      { id: "project_sel" },
      "Select Project Project A Project B"
    );
    const environment = new FakeLocatorEnvironment([select]).resolve(
      "#project_sel",
      select
    );

    const target = generateStableLocatorTarget(select, environment);

    expect(target.locators[0]).toEqual({
      type: "css",
      value: "#project_sel"
    });
    expect(target.locators).not.toContainEqual(
      expect.objectContaining({ type: "role" })
    );
  });

  it("falls back to a verified structural CSS path", () => {
    const panel = new FakeElement("section", { id: "settings-panel" });
    const targetElement = new FakeElement("div");
    const sibling = new FakeElement("div");
    panel.append(targetElement, sibling);
    const environment = new FakeLocatorEnvironment([
      panel,
      targetElement,
      sibling
    ])
      .resolve("div:nth-of-type(1)", targetElement, sibling)
      .resolve("#settings-panel > div:nth-of-type(1)", targetElement);

    const target = generateStableLocatorTarget(targetElement, environment);

    expect(target.locators[0]).toEqual({
      type: "css",
      value: "#settings-panel > div:nth-of-type(1)"
    });
  });

  it("prefers text for the visible dropdown option when hidden copies exist", () => {
    const hiddenItem = new FakeElement(
      "li",
      { class: "el-select-dropdown__item" },
      "No"
    ).hide();
    const hiddenOption = new FakeElement("span", {}, "No");
    hiddenItem.append(hiddenOption);
    const visibleItem = new FakeElement(
      "li",
      { class: "el-select-dropdown__item" },
      "No"
    );
    const visibleOption = new FakeElement("span", {}, "No");
    visibleItem.append(visibleOption);
    const environment = new FakeLocatorEnvironment([
      hiddenItem,
      hiddenOption,
      visibleItem,
      visibleOption
    ]).resolve(
      "span:nth-of-type(2)",
      visibleOption
    );

    const target = generateStableLocatorTarget(visibleOption, environment);

    expect(target.locators[0]).toEqual({
      type: "text",
      value: "No",
      exact: true
    });
  });

  it("limits fallback locators and rejects invalid limits", () => {
    const button = new FakeElement(
      "button",
      {
        id: "save-button",
        name: "save",
        "data-testid": "save",
        "aria-label": "Save"
      },
      "Save"
    );
    const environment = new FakeLocatorEnvironment([button])
      .resolve('[data-testid="save"]', button)
      .resolve("#save-button", button)
      .resolve('button[name="save"]', button)
      .resolve("button", button);

    const target = generateStableLocatorTarget(button, environment, {
      maxFallbacks: 1
    });

    expect(target.locators).toHaveLength(2);
    expect(() =>
      generateStableLocatorTarget(button, environment, { maxFallbacks: -1 })
    ).toThrow("maxFallbacks must be a non-negative integer");
  });

  it("fails when no candidate uniquely identifies the source element", () => {
    const first = new FakeElement("div", {}, "Duplicate");
    const second = new FakeElement("div", {}, "Duplicate");
    const environment = new FakeLocatorEnvironment([first, second])
      .resolve("div", first, second);

    expect(() => generateStableLocatorTarget(first, environment)).toThrowError(
      RecorderError
    );
    expect(() => generateStableLocatorTarget(first, environment)).toThrow(
      "Unable to create a unique locator"
    );
  });

  it("returns only portable preset-v1 locator types", () => {
    expectTypeOf<RecorderTargetCandidate["locators"]>().items.toMatchTypeOf<ElementLocator>();

    const button = new FakeElement("button", { "data-testid": "run" });
    const environment = new FakeLocatorEnvironment([button]).resolve(
      '[data-testid="run"]',
      button
    );
    const target = generateStableLocatorTarget(button, environment);

    expect(target).toEqual({
      locators: [{ type: "testId", value: "run" }]
    });
    expect(JSON.stringify(target)).not.toContain("playwright");
  });
});

class FakeElement implements LocatorElement {
  readonly tagName: string;
  readonly #attributes: Readonly<Record<string, string>>;
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  textContent: string;
  visible = true;

  constructor(
    tagName: string,
    attributes: Record<string, string> = {},
    textContent = ""
  ) {
    this.tagName = tagName.toUpperCase();
    this.#attributes = attributes;
    this.textContent = textContent;
  }

  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  hide(): this {
    this.visible = false;
    return this;
  }

  getAttribute(name: string): string | null {
    return this.#attributes[name] ?? null;
  }
}

class FakeLocatorEnvironment implements LocatorEnvironment {
  readonly #elements: readonly LocatorElement[];
  readonly #cssMatches = new Map<string, readonly LocatorElement[]>();

  constructor(elements: readonly LocatorElement[]) {
    this.#elements = elements;
  }

  resolve(selector: string, ...elements: LocatorElement[]): this {
    this.#cssMatches.set(selector, elements);
    return this;
  }

  allElements(): readonly LocatorElement[] {
    return this.#elements;
  }

  isVisible(element: LocatorElement): boolean {
    let current: LocatorElement | null = element;
    while (current !== null) {
      if (current instanceof FakeElement && !current.visible) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  }

  queryCss(selector: string): readonly LocatorElement[] {
    return this.#cssMatches.get(selector) ?? [];
  }
}
