import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SidePanelNavigation,
  type SidePanelView
} from "../../src/sidepanel/components/SidePanelNavigation";

describe("side panel workspace navigation", () => {
  it.each<SidePanelView>(["dashboard", "presets", "run-log"])(
    "marks %s as the current section",
    (activeView) => {
      const html = renderToStaticMarkup(
        <SidePanelNavigation
          activeView={activeView}
          onChange={() => undefined}
        />
      );

      expect(html).toContain('aria-label="Side panel sections"');
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      expect(html).toContain('aria-label="Dashboard"');
      expect(html).toContain('aria-label="Presets and editor"');
      expect(html).toContain('aria-label="Run log"');
      expect(html).toContain(`workspace-navigation__icon--${activeView}`);
    }
  );
});
