import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NaturalPacingPanel } from "../../src/sidepanel/features/natural-pacing";

describe("NaturalPacingPanel", () => {
  it("renders the switch, delay range in seconds and validation feedback", () => {
    const html = renderToStaticMarkup(
      <NaturalPacingPanel
        enabled={true}
        loading={false}
        maximumDelay="2"
        minimumDelay="3"
        onEnabledChange={() => undefined}
        onMaximumDelayChange={() => undefined}
        onMinimumDelayChange={() => undefined}
        onSave={() => undefined}
        saving={false}
        validationErrors={["Minimum delay cannot exceed maximum delay."]}
      />
    );

    expect(html).toContain("Natural pacing");
    expect(html).toContain("Enabled");
    expect(html).toContain("Minimum delay");
    expect(html).toContain("Maximum delay");
    expect(html).toContain("seconds");
    expect(html).toContain("Minimum delay cannot exceed maximum delay.");
    expect(html).toContain("disabled");
  });
});
