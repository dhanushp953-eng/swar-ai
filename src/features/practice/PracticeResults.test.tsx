import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PracticeResults } from "./PracticeResults";
import type { StoredPracticeResult } from "./results-store";

function rawResult(overrides: Partial<StoredPracticeResult>): StoredPracticeResult {
  return {
    version: 1,
    id: "r-1",
    lessonId: "morning-steps",
    lessonTitle: "Morning Steps",
    input: "midi",
    focus: "full",
    preset: "standard",
    handMode: "both",
    createdAt: 1000,
    overall: 80,
    pitch: 80,
    timing: 80,
    duration: 80,
    correctNotes: 80,
    counts: { expected: 1, performed: 1, correct: 1, early: 0, late: 0, wrong: 0, extra: 0, matched: 1, missed: 0, pending: 0 },
    problems: [],
    ...overrides,
  };
}

function render(props: Partial<React.ComponentProps<typeof PracticeResults>> = {}) {
  return renderToString(
    <PracticeResults
      results={props.results ?? []}
      hasStorage={props.hasStorage ?? true}
      exportStatus={props.exportStatus ?? null}
      onDelete={props.onDelete ?? (() => undefined)}
      onClear={props.onClear ?? (() => undefined)}
      onExport={props.onExport ?? (() => undefined)}
      onPracticeAgain={props.onPracticeAgain ?? null}
    />,
  ).replace(/<!--[\s\S]*?-->/g, "");
}

describe("PracticeResults", () => {
  it("shows an empty state when there is no history", () => {
    const html = render();
    expect(html).toContain("Results dashboard");
    expect(html).toContain("No saved attempts yet");
    expect(html).not.toContain("Export results");
  });

  it("explains when local storage is unavailable", () => {
    const html = render({ hasStorage: false });
    expect(html).toContain("local storage, which is unavailable");
    expect(html).not.toContain("No saved attempts yet");
  });

  it("renders latest, best, average, and attempt rows", () => {
    const results = [
      rawResult({ id: "a", lessonId: "morning-steps", lessonTitle: "Morning Steps", createdAt: 300, overall: 70, counts: { ...rawResult({}).counts, matched: 0, missed: 1 } }),
      rawResult({ id: "b", lessonId: "open-fifths", lessonTitle: "Open Fifths", createdAt: 200, overall: 95, input: "microphone", focus: "melody", preset: "strict" }),
    ];
    const html = render({ results });
    expect(html).toContain("Latest");
    expect(html).toContain("Best");
    expect(html).toContain("Average");
    expect(html).toContain("70");
    expect(html).toContain("95");
    expect(html).toContain("Morning Steps");
    expect(html).toContain("Open Fifths");
    expect(html).toContain("MIDI keyboard");
    expect(html).toContain("Melody");
    expect(html).toContain("Strict");
    expect(html).toContain("Matched 0 of 1");
  });

  it("shows trend chart metadata with multiple attempts", () => {
    const results = [
      rawResult({ id: "a", createdAt: 300, overall: 70 }),
      rawResult({ id: "b", createdAt: 200, overall: 95 }),
      rawResult({ id: "c", createdAt: 100, overall: 60 }),
    ];
    const html = render({ results });
    expect(html).toContain('aria-label="Score trend, oldest to newest: 60 to 95 to 70 out of 100"');
  });

  it("exposes labeled filter controls and reset", () => {
    const html = render({ results: [rawResult({ id: "a", lessonId: "morning-steps", lessonTitle: "Morning Steps" })] });
    expect(html).toContain('aria-label="Filter by lesson"');
    expect(html).toContain('aria-label="Filter by input"');
    expect(html).toContain('aria-label="Filter by focus mode"');
    expect(html).toContain('aria-label="Filter by strictness"');
    expect(html).toContain('aria-label="Saved practice attempts"');
    expect(html).not.toContain("Reset filters");
  });

  it("lists difficult notes per attempt", () => {
    const results = [
      rawResult({
        id: "a",
        lessonId: "morning-steps",
        lessonTitle: "Morning Steps",
        problems: [
          { name: "C4", at: 0.1, kind: "late" },
          { name: "D4", at: 1, kind: "missed" },
        ],
      }),
    ];
    const html = render({ results });
    expect(html).toContain('aria-label="Difficult notes for Morning Steps"');
    expect(html).toContain("late");
    expect(html).toContain("missed");
    expect(html).toContain("C4");
    expect(html).toContain("D4");
  });

  it("offers practise-again and accessible delete actions", () => {
    const results = [rawResult({ id: "a", lessonTitle: "Morning Steps", createdAt: 1000 })];
    const html = render({ results, onPracticeAgain: () => undefined });
    expect(html).toContain("Practise again");
    expect(html).toContain('aria-label="Delete attempt');
    expect(html).toContain("Clear all history");
  });

  it("hides practise-again when no lesson callback is provided", () => {
    const html = render({ results: [rawResult({ id: "a", lessonTitle: "Morning Steps" })] });
    expect(html).not.toContain("Practise again");
  });

  it("renders the export status in a live region", () => {
    const html = render({ results: [rawResult({ id: "a" })], exportStatus: "Exported 1 attempt as Practice results.json." });
    expect(html).toContain('role="status"');
    expect(html).toContain("Exported 1 attempt as Practice results.json.");
  });
});
