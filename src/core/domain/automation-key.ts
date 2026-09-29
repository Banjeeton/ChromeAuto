const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

const NAMED_KEYS = new Set([
  "Enter",
  "Escape",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "Delete",
  "Backspace",
  "Space"
]);

const FUNCTION_KEY_PATTERN = /^F(?:[1-9]|1[0-2])$/;

/** Validates the portable Playwright-compatible key notation used by pressKey. */
export function isSupportedAutomationKey(value: string): boolean {
  if (value.length === 0 || value !== value.trim()) {
    return false;
  }

  const tokens = value.split("+");
  const key = tokens.pop();
  if (key === undefined || !isSupportedKey(key)) {
    return false;
  }

  const modifiers = new Set<string>();
  for (const modifier of tokens) {
    if (!MODIFIER_KEYS.has(modifier) || modifiers.has(modifier)) {
      return false;
    }
    modifiers.add(modifier);
  }

  return true;
}

function isSupportedKey(value: string): boolean {
  return (
    NAMED_KEYS.has(value) ||
    FUNCTION_KEY_PATTERN.test(value) ||
    isPrintableCharacter(value)
  );
}

function isPrintableCharacter(value: string): boolean {
  return [...value].length === 1 && value !== "+" && !/\s/u.test(value);
}
