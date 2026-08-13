import { describe, expect, it, vi } from "vitest";
import { PRACTICE_PRESETS, scorePerformance, type PerformedNote, type ScoreNoteEvent } from "@/lib/practice/scoring";
import {
  MAX_RESULTS,
  STORAGE_KEY,
  addResult,
  clearResults,
  computeStats,
  createResultId,
  createStoredResult,
  deleteResult,
  filterResults,
  isStoredResult,
  parseResultsExport,
  readResults,
  serializeResultsExport,
  validateResultsArray,
  writeResults,
  type NewStoredResult,
  type StorageLike,
  type StoredPracticeResult,
} from "./results-store";

function makeStorage(initial?: Record<string, string>): StorageLike {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const EVENTS: ScoreNoteEvent[] = [
  { id: "e1", midi: 60, name: "C4", start: 0, duration: 0.5 },
  { id: "e2", midi: 62, name: "D4", start: 1, duration: 0.5 },
];

function scoreResult(performed: PerformedNote[]) {
  return scorePerformance(EVENTS, performed, PRACTICE_PRESETS.standard, { endTime: 2 });
}

function makeResult(overrides: Partial<NewStoredResult> = {}, performance: PerformedNote[] = [{ id: "p1", midi: 60, name: "C4", onset: 0.02, offset: 0.5 }]): StoredPracticeResult {
  return createStoredResult({
    id: "r-1",
    lessonId: "morning-steps",
    lessonTitle: "Morning Steps",
    input: "midi",
    focus: "full",
    preset: "standard",
    handMode: "both",
    createdAt: 1000,
    result: scoreResult(performance),
    ...overrides,
  });
}

/** A valid, minimal stored result without going through scoring. */
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

describe("createStoredResult", () => {
  it("keeps only compact, rounded summary data", () => {
    const stored = makeResult();
    expect(stored.version).toBe(1);
    expect(stored.overall).toBe(Math.round(scoreResult([{ id: "p1", midi: 60, name: "C4", onset: 0.02, offset: 0.5 }]).scores.overall.value));
    expect(stored.counts.expected).toBe(2);
    expect(stored.problems).toContainEqual({ name: "D4", at: 1, kind: "missed" });
    expect(Object.keys(stored)).not.toContain("performedNotes");
    expect(Object.keys(stored)).not.toContain("expectedNotes");
  });

  it("derives difficult notes from wrong pitches and missed events", () => {
    const stored = makeResult({}, [
      { id: "p1", midi: 65, name: "F4", onset: 0.02, offset: 0.5 }, // wrong pitch for e1
    ]);
    expect(stored.problems).toContainEqual({ name: "F4", at: 0.02, kind: "wrong" });
    expect(stored.problems).toContainEqual({ name: "D4", at: 1, kind: "missed" });
  });

  it("calls the count of performed notes on the wrong classification early", () => {
    const stored = makeResult({}, [
      { id: "p1", midi: 60, name: "C4", onset: 0.2, offset: 0.5 }, // late
    ]);
    expect(stored.problems.some((problem) => problem.kind === "late")).toBe(true);
  });

  it("caps the lesson title length", () => {
    const stored = makeResult({ lessonTitle: "x".repeat(500) });
    expect(stored.lessonTitle.length).toBeLessThanOrEqual(120);
  });
});

describe("readResults / validateResultsArray", () => {
  it("returns an empty list for null storage or an empty store", () => {
    expect(readResults(null)).toEqual([]);
    expect(readResults(makeStorage())).toEqual([]);
  });

  it("returns empty on corrupted or non-array payloads", () => {
    expect(readResults(makeStorage({ [STORAGE_KEY]: "{not json" }))).toEqual([]);
    expect(readResults(makeStorage({ [STORAGE_KEY]: JSON.stringify({ results: [] }) }))).toEqual([]);
    expect(validateResultsArray("nope")).toEqual([]);
  });

  it("filters out invalid entries and sorts newest first", () => {
    const older = rawResult({ id: "a", createdAt: 100 });
    const newer = rawResult({ id: "b", createdAt: 200 });
    const badVersion = rawResult({ id: "c", createdAt: 300, version: 99 as never });
    const badScore = rawResult({ id: "d", createdAt: 400, overall: 500 });
    const parsed = validateResultsArray([older, badVersion, newer, badScore, "junk"]);
    expect(parsed.map((result) => result.id)).toEqual(["b", "a"]);
  });

  it("caps the history at MAX_RESULTS", () => {
    const many = Array.from({ length: MAX_RESULTS + 10 }, (_, index) => rawResult({ id: `r-${index}`, createdAt: index }));
    expect(validateResultsArray(many)).toHaveLength(MAX_RESULTS);
  });

  it("removes duplicate legacy ids on read, keeping the newest valid result", () => {
    const legacy = [
      rawResult({ id: "dup", createdAt: 100, overall: 50 }),
      rawResult({ id: "dup", createdAt: 200, overall: 90 }),
      rawResult({ id: "unique", createdAt: 150, overall: 70 }),
    ];
    const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify(legacy) });
    const results = readResults(storage);
    expect(results.map((result) => result.id)).toEqual(["dup", "unique"]);
    const duplicate = results.find((result) => result.id === "dup");
    expect(duplicate?.createdAt).toBe(200);
    expect(duplicate?.overall).toBe(90);
    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]").map((result: StoredPracticeResult) => result.id)).toEqual(["dup", "unique"]);
  });
});

describe("createResultId", () => {
  it("produces collision-resistant ids across attempts created in the same millisecond", () => {
    const first = createResultId();
    const second = createResultId();
    expect(first).not.toBe(second);
    const storage = makeStorage();
    addResult(storage, rawResult({ id: first, createdAt: 1000 }));
    addResult(storage, rawResult({ id: second, createdAt: 1000 }));
    const ids = readResults(storage).map((result) => result.id);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining([first, second]));
  });

  it("falls back to a unique id when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", { randomUUID: undefined } as unknown as Crypto);
    try {
      const a = createResultId();
      const b = createResultId();
      expect(a).not.toBe(b);
      expect(a.startsWith("p-")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("saving exactly once", () => {
  it("stores a single attempt exactly once and never duplicates its id", () => {
    const storage = makeStorage();
    addResult(storage, rawResult({ id: "x", createdAt: 100 }));
    expect(readResults(storage)).toHaveLength(1);
    // A same-id re-add collapses to one record (newest wins) instead of duplicating.
    addResult(storage, rawResult({ id: "x", createdAt: 200 }));
    const results = readResults(storage);
    expect(results).toHaveLength(1);
    expect(results[0].createdAt).toBe(200);
  });
});

describe("addResult / deleteResult / clearResults", () => {
  it("prepends and persists the new result", () => {
    const storage = makeStorage();
    addResult(storage, rawResult({ id: "a", createdAt: 100 }));
    addResult(storage, rawResult({ id: "b", createdAt: 200 }));
    const results = readResults(storage);
    expect(results.map((result) => result.id)).toEqual(["b", "a"]);
    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]")).toHaveLength(2);
  });

  it("does not grow beyond MAX_RESULTS", () => {
    const storage = makeStorage();
    for (let index = 0; index < MAX_RESULTS + 5; index += 1) {
      addResult(storage, rawResult({ id: `r-${index}`, createdAt: index }));
    }
    expect(readResults(storage)).toHaveLength(MAX_RESULTS);
  });

  it("deletes a single attempt by id", () => {
    const storage = makeStorage();
    addResult(storage, rawResult({ id: "a", createdAt: 100 }));
    addResult(storage, rawResult({ id: "b", createdAt: 200 }));
    const next = deleteResult(storage, "a");
    expect(next.map((result) => result.id)).toEqual(["b"]);
    expect(readResults(storage).map((result) => result.id)).toEqual(["b"]);
  });

  it("clears the whole history and the stored key", () => {
    const storage = makeStorage();
    addResult(storage, rawResult({ id: "a", createdAt: 100 }));
    expect(clearResults(storage)).toEqual([]);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("export round-trip", () => {
  it("serializes and parses back to the same validated results", () => {
    const results = [rawResult({ id: "a", createdAt: 200 }), rawResult({ id: "b", createdAt: 100 })];
    const exported = serializeResultsExport(results);
    expect(JSON.parse(exported).schema).toBe("piano-practice-results");
    const parsed = parseResultsExport(exported);
    expect(parsed).toEqual(results);
  });

  it("rejects garbage and invalid results on parse", () => {
    expect(parseResultsExport("{nope")).toEqual([]);
    expect(parseResultsExport(JSON.stringify({ schema: "piano-practice-results", results: [{ version: 1 }] }))).toEqual([]);
  });
});

describe("writeResults quota handling", () => {
  it("drops oldest entries when the store keeps refusing writes", () => {
    const storage = makeStorage();
    storage.setItem = () => {
      throw new Error("quota exceeded");
    };
    expect(writeResults(storage, [rawResult({ id: "a" }), rawResult({ id: "b" })])).toBe(false);
  });

  it("drops oldest until a write succeeds", () => {
    let calls = 0;
    const storage = makeStorage();
    const originalSet = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      calls += 1;
      if (calls === 1) throw new Error("quota exceeded");
      originalSet(key, value);
    };
    const results = [rawResult({ id: "a", createdAt: 100 }), rawResult({ id: "b", createdAt: 200 })];
    expect(writeResults(storage, results)).toBe(true);
    expect(readResults(storage).map((result) => result.id)).toEqual(["a"]);
  });
});

describe("filters and stats", () => {
  const base = [
    rawResult({ id: "a", lessonId: "morning-steps", lessonTitle: "Morning Steps", input: "midi", focus: "full", preset: "standard", createdAt: 300, overall: 70 }),
    rawResult({ id: "b", lessonId: "morning-steps", lessonTitle: "Morning Steps", input: "microphone", focus: "melody", preset: "strict", createdAt: 200, overall: 90 }),
    rawResult({ id: "c", lessonId: "open-fifths", lessonTitle: "Open Fifths", input: "midi", focus: "rhythm", preset: "beginner", createdAt: 100, overall: 50 }),
  ];

  it("filters by lesson, input, focus, and preset", () => {
    expect(filterResults(base, { lessonId: "open-fifths", input: null, focus: null, preset: null }).map((result) => result.id)).toEqual(["c"]);
    expect(filterResults(base, { lessonId: null, input: "microphone", focus: null, preset: null }).map((result) => result.id)).toEqual(["b"]);
    expect(filterResults(base, { lessonId: null, input: null, focus: "rhythm", preset: null }).map((result) => result.id)).toEqual(["c"]);
    expect(filterResults(base, { lessonId: null, input: null, focus: null, preset: "beginner" }).map((result) => result.id)).toEqual(["c"]);
    expect(filterResults(base, { lessonId: "missing", input: null, focus: null, preset: null })).toEqual([]);
  });

  it("computes latest, best, and average over the given list", () => {
    const stats = computeStats(base);
    expect(stats.count).toBe(3);
    expect(stats.latest?.id).toBe("a");
    expect(stats.best?.id).toBe("b");
    expect(stats.average).toBe(70);
  });

  it("returns empty stats for an empty list", () => {
    expect(computeStats([])).toEqual({ count: 0, latest: null, best: null, average: null });
  });
});

describe("isStoredResult", () => {
  it("rejects results of the wrong version", () => {
    expect(isStoredResult(rawResult({ version: 2 as never }))).toBe(false);
  });

  it("rejects non-objects and missing counts", () => {
    expect(isStoredResult(null)).toBe(false);
    expect(isStoredResult("x")).toBe(false);
    expect(isStoredResult(rawResult({ counts: { ...rawResult({}).counts, expected: -1 } }))).toBe(false);
  });

  it("rejects unknown input/focus/preset/hand values", () => {
    expect(isStoredResult(rawResult({ input: "guitar" as never }))).toBe(false);
    expect(isStoredResult(rawResult({ focus: "sight" as never }))).toBe(false);
    expect(isStoredResult(rawResult({ preset: "extreme" as never }))).toBe(false);
    expect(isStoredResult(rawResult({ handMode: "solo" as never }))).toBe(false);
  });

  it("accepts a fully valid result", () => {
    expect(isStoredResult(rawResult({}))).toBe(true);
  });
});
