import { describe, expect, it } from "vitest";
import { PRACTICE_PRESETS, type ScoreNoteEvent } from "./scoring";
import { PracticeSession } from "./session";

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

const CONFIG = PRACTICE_PRESETS.standard;

describe("PracticeSession", () => {
  it("feeds note-ons into live results without waiting for note-off", () => {
    const session = new PracticeSession(SCALE, CONFIG);
    const first = session.noteOn({ midi: 60, name: "C4" }, 0.02);
    expect(first.counts).toMatchObject({ performed: 1, correct: 1, pending: 4, missed: 0 });

    const second = session.noteOn({ midi: 62, name: "D4" }, 1.02);
    expect(second.counts).toMatchObject({ performed: 2, correct: 2, pending: 3 });
    expect(second.performedNotes.map((r) => r.classification)).toEqual(["correct", "correct"]);
  });

  it("closes a note on note-off and recomputes", () => {
    const session = new PracticeSession(SCALE, CONFIG);
    session.noteOn({ midi: 60, name: "C4" }, 0.02);
    const result = session.noteOff(0, 60, 0.5)!;
    expect(result).not.toBeNull();
    expect(result.performedNotes[0].offset).toBe(0.5);
    expect(result.counts.correct).toBe(1);
  });

  it("returns null when releasing a note that is not held", () => {
    const session = new PracticeSession(SCALE, CONFIG);
    expect(session.noteOff(0, 72, 4)).toBeNull();
  });

  it("ignores a duplicate note-on for an already-held key", () => {
    const session = new PracticeSession(SCALE, CONFIG);
    session.noteOn({ midi: 60, name: "C4" }, 0);
    session.noteOn({ midi: 60, name: "C4" }, 0.5);
    expect(session.performedCount).toBe(1);
    session.noteOff(0, 60, 1);
    expect(session.performedCount).toBe(1);
  });

  it("finalize closes held notes at endTime and resolves pending events", () => {
    const session = new PracticeSession(SCALE, CONFIG);
    session.noteOn({ midi: 60, name: "C4" }, 0.02);
    session.noteOn({ midi: 62, name: "D4" }, 1.02);
    const result = session.finalize(4.5);

    expect(session.getPerformedSnapshot().map((note) => note.offset)).toEqual([4.5, 4.5]);
    expect(result.counts).toMatchObject({ performed: 2, correct: 2, matched: 2, missed: 3, pending: 0 });
    expect(result.expectedNotes.every((e) => e.classification !== "pending")).toBe(true);
  });

  it("closes a stuck note (never released) at finalize endTime and ignores a late release", () => {
    const session = new PracticeSession(SCALE, CONFIG);
    session.noteOn({ midi: 60, name: "C4" }, 0.02);
    const result = session.finalize(4.5);
    expect(result.performedNotes[0].offset).toBe(4.5);
    expect(result.performedNotes[0].classification).toBe("correct");
    expect(session.noteOff(0, 60, 5)).toBeNull();
  });

  it("keeps live results available between events", () => {
    const session = new PracticeSession(SCALE, CONFIG);
    expect(session.currentResult).toBeNull();
    session.noteOn({ midi: 60, name: "C4" }, 0);
    const snapshot = session.currentResult!;
    expect(snapshot.counts.performed).toBe(1);
    expect(session.getPerformedSnapshot()[0].id).toBe("perf-0");
  });

  it("assigns unique sequential performed ids", () => {
    const session = new PracticeSession(SCALE, CONFIG);
    session.noteOn({ midi: 60, name: "C4" }, 0);
    session.noteOff(0, 60, 0.5);
    session.noteOn({ midi: 62, name: "D4" }, 1);
    const ids = session.getPerformedSnapshot().map((note) => note.id);
    expect(ids).toEqual(["perf-0", "perf-1"]);
    expect(new Set(ids).size).toBe(2);
  });

  it("treats a still-held note as held-so-far for live duration scoring", () => {
    const session = new PracticeSession(SCALE, CONFIG);
    session.noteOn({ midi: 60, name: "C4" }, 0);
    const early = session.currentResult!;
    expect(early.performedNotes[0].durationDeviation).toBeCloseTo(-0.5);
    session.noteOn({ midi: 62, name: "D4" }, 1);
    const later = session.currentResult!;
    const c4 = later.performedNotes.find((r) => r.noteName === "C4")!;
    expect(c4.durationDeviation).toBeCloseTo(0.5);
  });
});
