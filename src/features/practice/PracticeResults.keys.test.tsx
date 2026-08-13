// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PracticeResults } from "./PracticeResults";
import type { StoredPracticeResult } from "./results-store";

function rawResult(id: string): StoredPracticeResult {
  return {
    version: 1,
    id,
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
  };
}

const noop = () => undefined;

afterEach(cleanup);

describe("PracticeResults React keys", () => {
  it("renders duplicate-id attempts without a key-collision warning and without hiding data", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const results = [rawResult("dup"), rawResult("dup")];
    render(
      <PracticeResults
        results={results}
        hasStorage
        exportStatus={null}
        onDelete={noop}
        onClear={noop}
        onExport={noop}
        onPracticeAgain={null}
      />,
    );
    const rows = document.querySelectorAll(".practice-results-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Morning Steps");
    expect(rows[1].textContent).toContain("Morning Steps");
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("same key"));
    errorSpy.mockRestore();
  });
});
