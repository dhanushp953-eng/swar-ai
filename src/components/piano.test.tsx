import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Piano } from "./piano";

describe("Piano highlighting", () => {
  it("applies only the MIDI highlight for MIDI-held notes", () => {
    const html = renderToString(<Piano midiHeldNotes={new Set([60])} />);
    expect(html).toContain('class="piano-key white-key is-midi"');
    expect(html).not.toContain("is-active");
    expect(html).toContain('aria-pressed="true"');
  });

  it("applies only the lesson highlight for lesson-active notes", () => {
    const html = renderToString(<Piano lessonActiveMidi={new Set([60])} />);
    expect(html).toContain('class="piano-key white-key is-active"');
    expect(html).not.toContain("is-midi");
  });

  it("combines both highlights when a note is lesson-active and MIDI-held", () => {
    const html = renderToString(<Piano lessonActiveMidi={new Set([60])} midiHeldNotes={new Set([60])} />);
    expect(html).toContain('class="piano-key white-key is-active is-midi"');
  });

  it("highlights black keys separately from adjacent white keys", () => {
    const html = renderToString(<Piano midiHeldNotes={new Set([61])} />);
    expect(html).toContain('class="piano-key black-key is-midi"');
    expect(html).toContain('class="piano-key white-key"');
  });
});
