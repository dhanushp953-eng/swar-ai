import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PracticePanel, Summary } from "./PracticePanel";
import { WebMidiController } from "@/lib/midi/web-midi";
import { makeMidiHarness } from "@/lib/midi/midi-test-utils";
import { PRACTICE_PRESETS, scorePerformance, type PerformedNote, type ScoreNoteEvent } from "@/lib/practice/scoring";

const EVENTS: ScoreNoteEvent[] = [{ id: "e1", midi: 60, name: "C4", start: 0, duration: 0.5 }];

function renderPanel(defaultEnabled = false): string {
  const harness = makeMidiHarness();
  const controller = new WebMidiController(harness.controllerDeps);
  return renderToString(
    <PracticePanel events={EVENTS} controller={controller} getLessonTime={() => 0} status="idle" duration={1} onRestart={() => undefined} defaultEnabled={defaultEnabled} />,
  ).replace(/<!--[\s\S]*?-->/g, "");
}

describe("PracticePanel", () => {
  it("renders the heading, options, and the disabled hint", () => {
    const html = renderPanel();
    expect(html).toContain("Practice scoring");
    expect(html).toContain("Score my playing");
    expect(html).toContain("Strictness");
    expect(html).toContain("Standard");
    expect(html).toContain("Latency compensation");
    expect(html).toContain("Turn on scoring");
    expect(html).toContain("computed locally");
  });

  it("shows live feedback instead of the hint when enabled by default", () => {
    const html = renderPanel(true);
    expect(html).toContain("Live feedback");
    expect(html).toContain("Play a note to begin");
    expect(html).not.toContain("Turn on scoring");
  });

  it("exposes accessible landmarks and labeled controls", () => {
    const html = renderPanel(true);
    expect(html).toContain('aria-labelledby="practice-title"');
    expect(html).toContain('aria-label="Scoring strictness"');
    expect(html).toContain('aria-label="Latency compensation"');
    expect(html).toContain('aria-live="polite"');
  });

  it("explains when an enabled run ends with no scored notes", () => {
    const harness = makeMidiHarness();
    const controller = new WebMidiController(harness.controllerDeps);
    const html = renderToString(
      <PracticePanel events={EVENTS} controller={controller} getLessonTime={() => 1} status="complete" duration={1} onRestart={() => undefined} defaultEnabled />,
    ).replace(/<!--[\s\S]*?-->/g, "");
    expect(html).toContain("No notes were scored during this attempt");
  });
});

describe("Summary", () => {
  const performed: PerformedNote[] = [{ id: "p1", midi: 60, name: "C4", onset: 0.02, offset: 0.5 }];
  const result = scorePerformance(EVENTS, performed, PRACTICE_PRESETS.standard, { endTime: 1 });

  it("shows the overall score, sub-scores, counts, and reasons", () => {
    const html = renderToString(<Summary result={result} onRestart={() => undefined} />).replace(/<!--[\s\S]*?-->/g, "");
    expect(html).toContain("Final attempt");
    expect(html).toContain("overall / 100");
    expect(html).toContain("Correct notes");
    expect(html).toContain("Pitch");
    expect(html).toContain("Timing");
    expect(html).toContain("Duration");
    expect(html).toContain("Practise again");
    expect(html).toContain(String(Math.round(result.scores.overall.value)));
    expect(html).toContain("Weighted");
  });
});
