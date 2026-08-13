import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Studio } from "./studio";

describe("Studio (performance: lazy panels + SSR safety)", () => {
  it("renders the studio shell without throwing and keeps the heavy panels lazy", () => {
    const html = renderToString(<Studio />).replace(/<!--[\s\S]*?-->/g, "");
    // Studio shell must render server-side.
    expect(html).toContain('id="studio"');
    expect(html).toContain("Practice room");
    // Below-the-fold panels are deferred: the SSR output shows the loading
    // placeholders rather than eagerly pulling Tone.js / Web MIDI.
    expect(html).toContain("panel-skeleton");
  });
});
