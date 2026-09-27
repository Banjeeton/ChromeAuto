import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import App from "../../src/sidepanel/App";

describe("side panel React entry", () => {
  it("renders the automation workspace heading", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Automation workspace");
    expect(html).toContain(
      "The TypeScript, React, Vite and Vitest toolchain is ready."
    );
  });
});
