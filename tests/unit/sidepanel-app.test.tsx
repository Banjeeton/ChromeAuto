import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import App from "../../src/sidepanel/App";

describe("side panel React entry", () => {
  it("renders the manual automation controls", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Automation Runner");
    expect(html).toContain("Run automation");
    expect(html).toContain("Current site");
    expect(html).toContain("Running tabs");
    expect(html).toContain(">Stop<");
    expect(html).toContain("Stop All");
  });
});
