import { describe, expect, it } from "vitest";
import {
  classifyOnset,
  clampScore,
  computeScores,
  matchNotes,
  PRACTICE_PRESETS,
  scorePerformance,
  withinWindow,
  type PerformedNote,
  type ScoreNoteEvent,
} from "./scoring";

const n = (id: string, midi: number, name: string, start: number, duration = 0.5): ScoreNoteEvent => ({
  id,
  midi,
  name,
  start,
  duration,
});

const SCALE: ScoreNoteEvent[] = [
  n("e1", 60, "C4", 0),
  n("e2", 62, "D4", 1),
  n("e3", 64, "E4", 2),
  n("e4", 67, "G4", 3),
  n("e5", 72, "C5", 4),
];

const p = (id: string, midi: number, name: string, onset: number, offset: number): PerformedNote => ({
  id,
  midi,
  name,
  onset,
  offset,
});

const STANDARD = PRACTICE_PRESETS.standard;

describe("classifyOnset and withinWindow", () => {
  it("is correct inside the onset tolerance", () => {
    expect(classifyOnset(1.03, 1, STANDARD).timing).toBe("correct");
    expect(classifyOnset(0.97, 1, STANDARD).timing).toBe("correct");
  });

  it("is early or late outside the onset tolerance", () => {
    expect(classifyOnset(0.9, 1, STANDARD)).toMatchObject({ timing: "early" });
    expect(classifyOnset(1.1, 1, STANDARD)).toMatchObject({ timing: "late" });
  });

  it("uses signed deviation (negative = early, positive = late)", () => {
    expect(classifyOnset(0.9, 1, STANDARD).deviation).toBeCloseTo(-0.1);
    expect(classifyOnset(1.1, 1, STANDARD).deviation).toBeCloseTo(0.1);
  });

  it("respects the early/late window edges inclusively", () => {
    expect(withinWindow(1 - STANDARD.windows.early, 1, STANDARD)).toBe(true);
    expect(withinWindow(1 + STANDARD.windows.late, 1, STANDARD)).toBe(true);
    expect(withinWindow(1 - STANDARD.windows.early - 0.001, 1, STANDARD)).toBe(false);
  });
});

describe("matchNotes", () => {
  it("matches a perfect performance one-to-one as correct", () => {
    const performed = [
      p("p1", 60, "C4", 0, 0.5),
      p("p2", 62, "D4", 1, 1.5),
      p("p3", 64, "E4", 2, 2.5),
      p("p4", 67, "G4", 3, 3.5),
      p("p5", 72, "C5", 4, 4.5),
    ];
    const result = scorePerformance(SCALE, performed, STANDARD);
    expect(result.counts).toMatchObject({ correct: 5, early: 0, late: 0, wrong: 0, extra: 0, matched: 5, missed: 0, pending: 0 });
    expect(result.scores.overall.value).toBe(100);
  });

  it("scores near-perfect timing slightly below 100", () => {
    const performed = [
      p("p1", 60, "C4", 0.01, 0.5),
      p("p2", 62, "D4", 1.01, 1.5),
      p("p3", 64, "E4", 2.01, 2.5),
      p("p4", 67, "G4", 3.01, 3.5),
      p("p5", 72, "C5", 4.01, 4.5),
    ];
    const result = scorePerformance(SCALE, performed, STANDARD);
    expect(result.scores.timing.value).toBeCloseTo(96, 5);
    expect(result.scores.overall.value).toBeCloseTo(98.8, 5);
  });

  it("classifies correct, early, late, wrong and extra in one pass", () => {
    const performed = [
      p("p1", 60, "C4", 0.03, 0.53),
      p("p2", 62, "D4", 0.88, 1.45),
      p("p3", 64, "E4", 2.25, 2.75),
      p("p4", 65, "F4", 3, 3.5),
      p("p5", 69, "A4", 3.5, 4),
      p("p6", 72, "C5", 4.05, 4.55),
    ];
    const result = scorePerformance(SCALE, performed, STANDARD);
    expect(result.counts).toMatchObject({
      expected: 5,
      performed: 6,
      correct: 2,
      early: 1,
      late: 1,
      wrong: 1,
      extra: 1,
      matched: 4,
      missed: 1,
      pending: 0,
    });

    const byNote = new Map(result.performedNotes.map((r) => [r.noteName, r.classification]));
    expect(byNote.get("C4")).toBe("correct");
    expect(byNote.get("D4")).toBe("early");
    expect(byNote.get("E4")).toBe("late");
    expect(byNote.get("F4")).toBe("wrong");
    expect(byNote.get("A4")).toBe("extra");

    const wrongNote = result.performedNotes.find((r) => r.classification === "wrong")!;
    expect(wrongNote.matchedEventId).toBe("e4");
    expect(wrongNote.matchedEventName).toBe("G4");
    expect(wrongNote.reason).toContain("Wrong pitch");

    const extraNote = result.performedNotes.find((r) => r.classification === "extra")!;
    expect(extraNote.matchedEventId).toBeNull();
    expect(extraNote.reason).toContain("Extra note");

    const missed = result.expectedNotes.find((e) => e.classification === "missed")!;
    expect(missed.eventId).toBe("e4");
    expect(missed.reason).toContain("Missed");
  });

  it("assigns structured scores with reasons for the mixed scenario", () => {
    const performed = [
      p("p1", 60, "C4", 0.03, 0.53),
      p("p2", 62, "D4", 0.88, 1.45),
      p("p3", 64, "E4", 2.25, 2.75),
      p("p4", 65, "F4", 3, 3.5),
      p("p5", 69, "A4", 3.5, 4),
      p("p6", 72, "C5", 4.05, 4.55),
    ];
    const result = scorePerformance(SCALE, performed, STANDARD);

    expect(result.scores.pitch.value).toBe(80);
    expect(result.scores.correctNotes.value).toBe(80);
    expect(result.scores.timing.value).toBeCloseTo(55, 5);
    expect(result.scores.duration.value).toBeCloseTo(88.125, 5);
    expect(result.scores.overall.value).toBeCloseTo(58.125, 5);

    expect(result.scores.pitch.reasons.length).toBeGreaterThan(0);
    expect(result.scores.timing.reasons[0]).toContain("correctly-pitched");
    expect(result.scores.duration.reasons[0]).toContain("held-duration");
    expect(result.scores.correctNotes.reasons[0]).toContain("4 of 5");
    expect(result.scores.overall.reasons.some((r) => r.includes("Weighted"))).toBe(true);
  });

  it("sorts out-of-order performed notes by onset before matching", () => {
    const performed = [
      p("p3", 64, "E4", 2.01, 2.5),
      p("p1", 60, "C4", 0.01, 0.5),
      p("p2", 62, "D4", 1.01, 1.5),
    ];
    const result = scorePerformance(SCALE, performed, STANDARD, { endTime: 2.5 });
    expect(result.counts.matched).toBe(3);
    expect(result.performedNotes.map((r) => r.noteName)).toEqual(["C4", "D4", "E4"]);
  });

  it("keeps a wrong-consumed event missed rather than matched", () => {
    const performed = [p("p1", 65, "F4", 2, 2.5)];
    const result = scorePerformance(SCALE, performed, STANDARD);
    expect(result.counts.wrong).toBe(1);
    expect(result.counts.matched).toBe(0);
    expect(result.counts.missed).toBe(5);
    const e3 = result.expectedNotes.find((e) => e.eventId === "e3")!;
    expect(e3.classification).toBe("missed");
    expect(e3.reason).toContain("wrong pitch");
  });

  it("classifies events whose window is still open as pending during live scoring", () => {
    const performed = [p("p1", 60, "C4", 0.01, 0.5)];
    const result = scorePerformance(SCALE, performed, STANDARD, { endTime: 0.5 });
    expect(result.counts.pending).toBe(4);
    expect(result.counts.missed).toBe(0);
    expect(result.expectedNotes.filter((e) => e.classification === "pending").length).toBe(4);
  });

  it("is deterministic for identical inputs", () => {
    const performed = [
      p("p1", 60, "C4", 0.03, 0.53),
      p("p2", 62, "D4", 0.88, 1.45),
      p("p3", 64, "E4", 2.25, 2.75),
    ];
    const first = scorePerformance(SCALE, performed, STANDARD);
    const second = scorePerformance(SCALE, performed, STANDARD);
    expect(first).toEqual(second);
  });
});

describe("computeScores", () => {
  it("reports all zero with reasons when nothing was played", () => {
    const result = scorePerformance(SCALE, [], STANDARD);
    expect(result.scores.overall.value).toBe(0);
    expect(result.scores.pitch.value).toBe(0);
    expect(result.scores.pitch.reasons[0]).toBe("No notes were played.");
    expect(result.scores.timing.reasons[0]).toBe("No correctly-pitched notes to evaluate timing on.");
    expect(result.scores.duration.reasons[0]).toBe("No correctly-pitched notes to evaluate duration on.");
  });

  it("clamps a heavily penalised performance to zero", () => {
    const result = scorePerformance(SCALE, [], STANDARD);
    const base = computeScores([], result.expectedNotes.map((e) => ({ ...e, classification: "missed" as const })), STANDARD);
    expect(base.scores.overall.value).toBe(0);
  });

  it("clamps individual scores into 0..100", () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(150)).toBe(100);
  });

  it("derives pending counts from expected classification", () => {
    const { expectedNotes } = matchNotes(SCALE, [p("p1", 60, "C4", 0, 0.5)], STANDARD, { endTime: 0.5 });
    const result = computeScores([], expectedNotes, STANDARD);
    expect(result.counts.pending).toBe(4);
  });
});

describe("presets", () => {
  it("orders presets from forgiving to strict", () => {
    expect(STANDARD.windows.early).toBeGreaterThan(PRACTICE_PRESETS.strict.windows.early);
    expect(STANDARD.windows.early).toBeLessThan(PRACTICE_PRESETS.beginner.windows.early);
  });

  it("flags the same onset differently under different presets", () => {
    const lateNote = p("p1", 60, "C4", 0.3, 0.8);
    const beginner = scorePerformance(SCALE, [lateNote], PRACTICE_PRESETS.beginner, { endTime: 0.8 });
    const strict = scorePerformance(SCALE, [lateNote], PRACTICE_PRESETS.strict, { endTime: 0.8 });
    expect(beginner.counts.late).toBe(1);
    expect(strict.counts.extra).toBe(1);
  });
});
