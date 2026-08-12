import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { PracticeResults } from "./PracticeResults";
import { hydratePracticeResultsState, usePracticeResults } from "./usePracticeResults";
import { STORAGE_KEY, type StorageLike, type StoredPracticeResult } from "./results-store";

function storedResult(): StoredPracticeResult {
  return {
    version: 1,
    id: "hydration-result",
    lessonId: "morning-steps",
    lessonTitle: "Morning Steps",
    input: "midi",
    focus: "full",
    preset: "standard",
    handMode: "both",
    createdAt: 1_700_000_000_000,
    overall: 82,
    pitch: 88,
    timing: 77,
    duration: 80,
    correctNotes: 84,
    counts: { expected: 1, performed: 1, correct: 1, early: 0, late: 0, wrong: 0, extra: 0, matched: 1, missed: 0, pending: 0 },
    problems: [],
  };
}

function ResultsProbe() {
  const practiceResults = usePracticeResults();
  return <PracticeResults results={practiceResults.results} hasStorage={practiceResults.hasStorage} exportStatus={null} onDelete={() => undefined} onClear={() => undefined} onExport={() => undefined} onPracticeAgain={null} />;
}

describe("usePracticeResults hydration", () => {
  it("keeps server and browser first render identical before loading localStorage", () => {
    const serverHtml = renderToString(<ResultsProbe />).replace(/<!--[\s\S]*?-->/g, "");
    const stored = JSON.stringify([storedResult()]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === STORAGE_KEY ? stored : null, setItem: vi.fn(), removeItem: vi.fn() });
    const browserFirstRenderHtml = renderToString(<ResultsProbe />).replace(/<!--[\s\S]*?-->/g, "");

    expect(browserFirstRenderHtml).toBe(serverHtml);
    expect(browserFirstRenderHtml).toContain("local storage, which is unavailable");
    expect(browserFirstRenderHtml).not.toContain("82");
    vi.unstubAllGlobals();
  });

  it("does not schedule another update when the same storage is hydrated again", () => {
    const storage: StorageLike = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() };
    const current = { storage, results: [storedResult()], hydrated: true };
    const hydrated = hydratePracticeResultsState(
      current,
      storage,
      [storedResult()],
    );

    expect(hydrated.results).toHaveLength(1);
    expect(hydrated).toBe(current);
  });

  it("hydrates once across rerenders that create new options objects", () => {
    const storage: StorageLike = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() };
    const first = hydratePracticeResultsState({ storage: null, results: [], hydrated: false }, storage, [storedResult()]);
    const second = hydratePracticeResultsState(first, storage, [storedResult()]);

    expect(second).toBe(first);
    expect(second.results).toHaveLength(1);
  });
});
