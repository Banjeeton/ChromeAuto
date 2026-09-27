import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import App from "../../src/sidepanel/App";

describe("side panel React entry", () => {
  it("renders the Playwright CRX smoke test controls", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Playwright CRX smoke test");
    expect(html).toContain("Test reload");
    expect(html).toContain("Test HTML modal");
    expect(html).toContain("Attached tabs");
  });
});
