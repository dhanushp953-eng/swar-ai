import { describe, expect, it } from "vitest";
import type { LessonExercise, NoteEvent } from "../../types/lesson";
import {
  addNote,
  changeConfidence,
  changeDuration,
  changeMidi,
  changeStart,
  changeVelocity,
  CORRECTION_MIDI_MAX,
  CORRECTION_MIDI_MIN,
  CORRECTION_VELOCITY_MAX,
  CORRECTION_VELOCITY_MIN,
  CorrectionError,
  CorrectionValidationError,
  createCorrectionEditor,
  createCorrectionState,
  deleteNote,
  getDerivedState,
  getEvents,
  getExercise,
  getOverlapWarnings,
  MAX_CORRECTION_HISTORY,
  moveNote,
  redo,
  resetAll,
  resetNote,
  selectNote,
  shiftAll,
  undo,
  validateCorrectionNote,
  type CorrectionNote,
  type CorrectionState,
} from "./correction-engine";

type TestNote = NoteEvent & { confidence?: number | null };

const note = (overrides: Partial<TestNote> & { id: string }): TestNote => ({
  midi: 60,
  name: "C4",
  start: 0,
  duration: 0.5,
  velocity: 100,
  hand: null,
  confidence: 0.9,
  ...overrides,
});

function makeExercise(): Omit<LessonExercise, "events"> & { events: TestNote[] } {
  return {
    id: "detected-test",
    title: "Detected melody",
    description: "test",
    bpm: 80,
    beatsPerMeasure: 4,
    duration: 3,
    events: [
      note({ id: "n1", midi: 60, name: "C4", start: 0, duration: 0.5, velocity: 100, confidence: 0.95 }),
      note({ id: "n2", midi: 62, name: "D4", start: 0.7, duration: 0.5, velocity: 100, confidence: 0.9 }),
      note({ id: "n3", midi: 64, name: "E4", start: 1.4, duration: 0.5, velocity: 100, confidence: 0.85 }),
      note({ id: "n4", midi: 67, name: "G4", start: 2.1, duration: 0.5, velocity: 100, confidence: 0.8 }),
    ],
  };
}

function makeExerciseWithoutConfidence(): LessonExercise {
  const exercise = makeExercise();
  return {
    ...exercise,
    events: exercise.events.map(({ id, midi, name, start, duration, velocity, hand, finger }) => ({
      id,
      midi,
      name,
      start,
      duration,
      velocity,
      hand,
      finger,
    })),
  };
}

const snapshot = (exercise: LessonExercise) => JSON.parse(JSON.stringify(exercise)) as LessonExercise;

describe("createCorrectionState", () => {
  it("starts clean with a working copy of the original", () => {
    const state = createCorrectionState(makeExercise());
    expect(state.events).toHaveLength(4);
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([]);
    expect(getDerivedState(state).dirty).toBe(false);
    expect(state.selectedNoteId).toBeNull();
    expect(state.events).not.toBe(state.originalEvents);
  });

  it("freezes the original events and leaves the working copy mutable", () => {
    const state = createCorrectionState(makeExercise());
    expect(Object.isFrozen(state.originalEvents)).toBe(true);
    expect(Object.isFrozen(state.originalEvents[0])).toBe(true);
    expect(Object.isFrozen(state.events)).toBe(false);
    expect(Object.isFrozen(state.events[0])).toBe(false);
  });

  it("rejects an invalid original lesson", () => {
    const exercise = makeExercise();
    exercise.events = [{ ...exercise.events[0], id: "n1", midi: 10, name: "F#0" }];
    expect(() => createCorrectionState(exercise)).toThrow(CorrectionValidationError);
  });

  it("rejects an original lesson with duplicate ids", () => {
    const exercise = makeExercise();
    exercise.events = [note({ id: "n1" }), note({ id: "n1" })];
    expect(() => createCorrectionState(exercise)).toThrow(/Duplicate note id/);
  });
});

describe("selectNote", () => {
  it("selects an existing note without creating history", () => {
    let state = createCorrectionState(makeExercise());
    state = selectNote(state, "n2");
    expect(state.selectedNoteId).toBe("n2");
    expect(getDerivedState(state).canUndo).toBe(false);
  });

  it("clears selection with null", () => {
    let state = createCorrectionState(makeExercise());
    state = selectNote(state, "n2");
    state = selectNote(state, null);
    expect(state.selectedNoteId).toBeNull();
  });

  it("rejects an unknown note id", () => {
    const state = createCorrectionState(makeExercise());
    expect(() => selectNote(state, "missing")).toThrow(CorrectionError);
  });
});

describe("addNote", () => {
  it("adds a note with a generated unique id, derived name and sorted position", () => {
    let state = createCorrectionState(makeExercise());
    state = addNote(state, { midi: 65, start: 2.6, duration: 0.4, velocity: 90, confidence: 0.7 });
    const events = state.events;
    expect(events).toHaveLength(5);
    expect(events.map((event) => event.id)).toEqual(["n1", "n2", "n3", "n4", "added-1"]);
    expect(events[4]).toMatchObject({ id: "added-1", midi: 65, name: "F4", start: 2.6, duration: 0.4, velocity: 90, confidence: 0.7, hand: null });
    const derived = getDerivedState(state);
    expect(derived.addedNoteIds).toEqual(["added-1"]);
    expect(derived.dirty).toBe(true);
    expect(derived.correctionCount).toBe(1);
    expect(derived.canUndo).toBe(true);
  });

  it("inserts in sorted position when start falls in the middle", () => {
    let state = createCorrectionState(makeExercise());
    state = addNote(state, { midi: 61, start: 1.0, duration: 0.5, velocity: 88 });
    const starts = state.events.map((event) => event.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(state.events.find((event) => event.id === "added-1")?.start).toBe(1.0);
  });

  it("uses an explicit unique id", () => {
    let state = createCorrectionState(makeExercise());
    state = addNote(state, { id: "manual-1", midi: 65, start: 2.6, duration: 0.4, velocity: 90 });
    expect(state.events.map((event) => event.id)).toContain("manual-1");
  });

  it("rejects a duplicate explicit id", () => {
    const state = createCorrectionState(makeExercise());
    expect(() => addNote(state, { id: "n1", midi: 65, start: 2.6, duration: 0.4, velocity: 90 })).toThrow(/already exists/);
  });

  it.each([
    ["midi too low", { midi: CORRECTION_MIDI_MIN - 1 }],
    ["midi too high", { midi: CORRECTION_MIDI_MAX + 1 }],
    ["midi non-integer", { midi: 60.5 }],
    ["start negative", { start: -0.1 }],
    ["start NaN", { start: Number.NaN }],
    ["duration zero", { duration: 0 }],
    ["duration negative", { duration: -1 }],
    ["velocity too low", { velocity: CORRECTION_VELOCITY_MIN - 1 }],
    ["velocity too high", { velocity: CORRECTION_VELOCITY_MAX + 1 }],
    ["velocity non-integer", { velocity: 88.5 }],
    ["confidence too high", { confidence: 1.5 }],
    ["confidence negative", { confidence: -0.1 }],
  ])("rejects invalid add input: %s", (_label, input) => {
    const state = createCorrectionState(makeExercise());
    expect(() => addNote(state, { midi: 60, start: 0, duration: 0.5, velocity: 88, ...input })).toThrow(CorrectionValidationError);
  });
});

describe("deleteNote", () => {
  it("removes the note and tracks it as deleted", () => {
    let state = createCorrectionState(makeExercise());
    state = deleteNote(state, "n2");
    expect(state.events.map((event) => event.id)).toEqual(["n1", "n3", "n4"]);
    const derived = getDerivedState(state);
    expect(derived.deletedNoteIds).toEqual(["n2"]);
    expect(derived.dirty).toBe(true);
    expect(derived.correctionCount).toBe(1);
  });

  it("rejects an unknown note id", () => {
    const state = createCorrectionState(makeExercise());
    expect(() => deleteNote(state, "missing")).toThrow(CorrectionError);
  });

  it("clears selection when the selected note is deleted", () => {
    let state = createCorrectionState(makeExercise());
    state = selectNote(state, "n2");
    state = deleteNote(state, "n2");
    expect(state.selectedNoteId).toBeNull();
  });
});

describe("changeMidi", () => {
  it("changes pitch and regenerates the scientific note name", () => {
    let state = createCorrectionState(makeExercise());
    state = changeMidi(state, "n2", 65);
    const event = state.events.find((item) => item.id === "n2");
    expect(event?.midi).toBe(65);
    expect(event?.name).toBe("F4");
    expect(getDerivedState(state).editedNoteIds).toEqual(["n2"]);
  });

  it("rejects out-of-range and non-integer midi", () => {
    const state = createCorrectionState(makeExercise());
    expect(() => changeMidi(state, "n1", CORRECTION_MIDI_MIN - 1)).toThrow(CorrectionValidationError);
    expect(() => changeMidi(state, "n1", CORRECTION_MIDI_MAX + 1)).toThrow(CorrectionValidationError);
    expect(() => changeMidi(state, "n1", 60.5)).toThrow(CorrectionValidationError);
  });
});

describe("changeStart", () => {
  it("changes the start time and keeps events sorted", () => {
    let state = createCorrectionState(makeExercise());
    state = changeStart(state, "n4", 0.2);
    const starts = state.events.map((event) => event.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(state.events.find((event) => event.id === "n4")?.start).toBe(0.2);
  });

  it("rejects negative or non-finite start times", () => {
    const state = createCorrectionState(makeExercise());
    expect(() => changeStart(state, "n1", -0.1)).toThrow(CorrectionValidationError);
    expect(() => changeStart(state, "n1", Number.NaN)).toThrow(CorrectionValidationError);
    expect(() => changeStart(state, "n1", Number.POSITIVE_INFINITY)).toThrow(CorrectionValidationError);
  });
});

describe("changeDuration", () => {
  it("changes the duration", () => {
    let state = createCorrectionState(makeExercise());
    state = changeDuration(state, "n1", 1.2);
    expect(state.events.find((event) => event.id === "n1")?.duration).toBe(1.2);
  });

  it("rejects zero, negative or non-finite durations", () => {
    const state = createCorrectionState(makeExercise());
    expect(() => changeDuration(state, "n1", 0)).toThrow(CorrectionValidationError);
    expect(() => changeDuration(state, "n1", -1)).toThrow(CorrectionValidationError);
    expect(() => changeDuration(state, "n1", Number.NaN)).toThrow(CorrectionValidationError);
  });
});

describe("changeVelocity", () => {
  it("accepts the full supported range", () => {
    let state = createCorrectionState(makeExercise());
    state = changeVelocity(state, "n1", CORRECTION_VELOCITY_MIN);
    expect(state.events.find((event) => event.id === "n1")?.velocity).toBe(1);
    state = changeVelocity(state, "n1", CORRECTION_VELOCITY_MAX);
    expect(state.events.find((event) => event.id === "n1")?.velocity).toBe(127);
  });

  it("rejects values outside the supported range and non-integers", () => {
    const state = createCorrectionState(makeExercise());
    expect(() => changeVelocity(state, "n1", 0)).toThrow(CorrectionValidationError);
    expect(() => changeVelocity(state, "n1", 128)).toThrow(CorrectionValidationError);
    expect(() => changeVelocity(state, "n1", 88.5)).toThrow(CorrectionValidationError);
  });
});

describe("changeConfidence", () => {
  it("changes confidence when the note carries one (imported/manual data)", () => {
    let state = createCorrectionState(makeExercise());
    state = changeConfidence(state, "n1", 0.5);
    expect(state.events.find((event) => event.id === "n1")?.confidence).toBe(0.5);
    expect(getDerivedState(state).editedNoteIds).toEqual(["n1"]);
  });

  it("accepts the 0..1 boundaries", () => {
    let state = createCorrectionState(makeExercise());
    state = changeConfidence(state, "n1", 0);
    state = changeConfidence(state, "n1", 1);
    expect(state.events.find((event) => event.id === "n1")?.confidence).toBe(1);
  });

  it("rejects out-of-range or non-finite confidence", () => {
    const state = createCorrectionState(makeExercise());
    expect(() => changeConfidence(state, "n1", -0.01)).toThrow(CorrectionValidationError);
    expect(() => changeConfidence(state, "n1", 1.01)).toThrow(CorrectionValidationError);
    expect(() => changeConfidence(state, "n1", Number.NaN)).toThrow(CorrectionValidationError);
  });

  it("rejects confidence edits when the note has no confidence value", () => {
    const state = createCorrectionState(makeExerciseWithoutConfidence());
    expect(() => changeConfidence(state, "n1", 0.5)).toThrow(CorrectionValidationError);
  });
});

describe("moveNote", () => {
  it("moves a note later", () => {
    let state = createCorrectionState(makeExercise());
    state = moveNote(state, "n1", 1.5);
    expect(state.events.find((event) => event.id === "n1")?.start).toBe(1.5);
  });

  it("moves a note earlier", () => {
    let state = createCorrectionState(makeExercise());
    state = moveNote(state, "n4", -0.5);
    expect(state.events.find((event) => event.id === "n4")?.start).toBe(1.6);
  });

  it("clamps earlier moves at zero", () => {
    let state = createCorrectionState(makeExercise());
    state = moveNote(state, "n1", -2);
    expect(state.events.find((event) => event.id === "n1")?.start).toBe(0);
  });

  it("treats a zero offset as a no-op without history", () => {
    const state = createCorrectionState(makeExercise());
    const next = moveNote(state, "n1", 0);
    expect(next).toBe(state);
    expect(getDerivedState(next).canUndo).toBe(false);
  });
});

describe("shiftAll", () => {
  it("shifts every note by a global offset", () => {
    let state = createCorrectionState(makeExercise());
    state = shiftAll(state, 0.5);
    expect(state.events.map((event) => event.start)).toEqual([0.5, 1.2, 1.9, 2.6]);
  });

  it("clamps the shift so no start goes negative", () => {
    let state = createCorrectionState(makeExercise());
    state = shiftAll(state, -0.8);
    const starts = state.events.map((event) => event.start);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBe(0);
    expect(starts[2]).toBeCloseTo(0.6, 10);
    expect(starts[3]).toBeCloseTo(1.3, 10);
  });

  it("treats a zero shift as a no-op without history", () => {
    const state = createCorrectionState(makeExercise());
    expect(shiftAll(state, 0)).toBe(state);
  });
});

describe("undo / redo", () => {
  it("undoes and redoes an edit", () => {
    let state = createCorrectionState(makeExercise());
    state = changeMidi(state, "n1", 72);
    expect(getDerivedState(state).canUndo).toBe(true);
    state = undo(state);
    expect(state.events.find((event) => event.id === "n1")?.midi).toBe(60);
    expect(getDerivedState(state).canRedo).toBe(true);
    state = redo(state);
    expect(state.events.find((event) => event.id === "n1")?.midi).toBe(72);
  });

  it.each([
    ["addNote", (s: CorrectionState) => addNote(s, { midi: 65, start: 2.6, duration: 0.4, velocity: 88 })],
    ["deleteNote", (s: CorrectionState) => deleteNote(s, "n2")],
    ["changeMidi", (s: CorrectionState) => changeMidi(s, "n2", 65)],
    ["changeStart", (s: CorrectionState) => changeStart(s, "n2", 0.9)],
    ["changeDuration", (s: CorrectionState) => changeDuration(s, "n2", 0.9)],
    ["changeVelocity", (s: CorrectionState) => changeVelocity(s, "n2", 70)],
    ["changeConfidence", (s: CorrectionState) => changeConfidence(s, "n2", 0.4)],
    ["moveNote", (s: CorrectionState) => moveNote(s, "n2", 0.3)],
    ["shiftAll", (s: CorrectionState) => shiftAll(s, 0.3)],
  ])("undoes %s", (_label, edit) => {
    let state = createCorrectionState(makeExercise());
    state = edit(state);
    const edited = snapshot(getExercise(state));
    expect(edited).not.toEqual(snapshot(makeExercise()));
    state = undo(state);
    expect(getExercise(state)).toEqual(makeExercise());
    state = redo(state);
    expect(getExercise(state)).toEqual(edited);
  });

  it("undoes a full reset", () => {
    let state = createCorrectionState(makeExercise());
    state = changeMidi(state, "n1", 72);
    state = deleteNote(state, "n3");
    state = resetAll(state);
    expect(getExercise(state)).toEqual(makeExercise());
    expect(getDerivedState(state).canUndo).toBe(true);
    state = undo(state);
    const derived = getDerivedState(state);
    expect(derived.dirty).toBe(true);
    expect(derived.correctionCount).toBe(2);
  });

  it("clears redo history after a new edit following undo", () => {
    let state = createCorrectionState(makeExercise());
    state = changeMidi(state, "n1", 72);
    state = undo(state);
    expect(getDerivedState(state).canRedo).toBe(true);
    state = changeStart(state, "n2", 0.9);
    expect(getDerivedState(state).canRedo).toBe(false);
  });

  it("no-op edits do not create history entries", () => {
    let state = createCorrectionState(makeExercise());
    state = changeMidi(state, "n1", 72);
    const pastLength = state.past.length;
    state = changeMidi(state, "n1", 72);
    state = changeStart(state, "n1", 0);
    expect(state.past.length).toBe(pastLength);
    expect(getDerivedState(state).canUndo).toBe(true);
  });

  it("keeps history bounded", () => {
    let state = createCorrectionState(makeExercise());
    for (let index = 0; index < MAX_CORRECTION_HISTORY + 10; index += 1) {
      state = changeMidi(state, "n1", index % 2 === 0 ? 60 : 61);
    }
    expect(state.past.length).toBe(MAX_CORRECTION_HISTORY);
    expect(getDerivedState(state).canUndo).toBe(true);
  });

  it("undo and redo are safe at the history limits", () => {
    const state = createCorrectionState(makeExercise());
    expect(undo(state)).toBe(state);
    expect(redo(state)).toBe(state);
  });
});

describe("reset", () => {
  it("resets one note back to its original value", () => {
    let state = createCorrectionState(makeExercise());
    state = changeMidi(state, "n2", 65);
    state = changeStart(state, "n2", 0.9);
    state = changeVelocity(state, "n2", 44);
    state = resetNote(state, "n2");
    const event = state.events.find((item) => item.id === "n2");
    expect(event).toEqual(makeExercise().events[1]);
    expect(getDerivedState(state).dirty).toBe(false);
  });

  it("resetting a note that already matches the original is a no-op", () => {
    const state = createCorrectionState(makeExercise());
    const next = resetNote(state, "n1");
    expect(next).toBe(state);
  });

  it("resetting an added note deletes it", () => {
    let state = createCorrectionState(makeExercise());
    state = addNote(state, { midi: 65, start: 2.6, duration: 0.4, velocity: 88 });
    expect(state.events).toHaveLength(5);
    state = resetNote(state, "added-1");
    expect(state.events).toHaveLength(4);
    expect(getDerivedState(state).dirty).toBe(false);
  });

  it("rejects an unknown note id", () => {
    const state = createCorrectionState(makeExercise());
    expect(() => resetNote(state, "missing")).toThrow(CorrectionError);
  });

  it("resets the full lesson to the original analysis", () => {
    let state = createCorrectionState(makeExercise());
    state = changeMidi(state, "n1", 72);
    state = deleteNote(state, "n3");
    state = addNote(state, { midi: 65, start: 2.6, duration: 0.4, velocity: 88 });
    state = resetAll(state);
    expect(getExercise(state)).toEqual(makeExercise());
    const derived = getDerivedState(state);
    expect(derived.dirty).toBe(false);
    expect(derived.editedNoteIds).toEqual([]);
    expect(derived.addedNoteIds).toEqual([]);
    expect(derived.deletedNoteIds).toEqual([]);
    expect(derived.correctionCount).toBe(0);
  });
});

describe("derived state", () => {
  it("reports edited, added and deleted note ids and the correction count", () => {
    let state = createCorrectionState(makeExercise());
    state = changeMidi(state, "n1", 72);
    state = deleteNote(state, "n3");
    state = addNote(state, { midi: 65, start: 2.6, duration: 0.4, velocity: 88 });
    const derived = getDerivedState(state);
    expect(derived.editedNoteIds).toEqual(["n1"]);
    expect(derived.deletedNoteIds).toEqual(["n3"]);
    expect(derived.addedNoteIds).toEqual(["added-1"]);
    expect(derived.correctionCount).toBe(3);
    expect(derived.dirty).toBe(true);
  });

  it("reports undo/redo availability", () => {
    let state = createCorrectionState(makeExercise());
    expect(getDerivedState(state).canUndo).toBe(false);
    state = changeMidi(state, "n1", 72);
    expect(getDerivedState(state).canUndo).toBe(true);
    state = undo(state);
    expect(getDerivedState(state).canRedo).toBe(true);
  });

  it("warns about overlapping notes without deleting them", () => {
    let state = createCorrectionState(makeExercise());
    expect(getDerivedState(state).warnings).toEqual([]);
    state = changeStart(state, "n2", 0.2);
    const warnings = getDerivedState(state).warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe("overlap");
    expect(warnings[0].eventIds).toEqual(["n1", "n2"]);
    expect(state.events).toHaveLength(4);
    expect(getOverlapWarnings(state.events)).toEqual(warnings);
  });

  it("flags a confidence-only edit as edited", () => {
    let state = createCorrectionState(makeExercise());
    state = changeConfidence(state, "n4", 0.55);
    const derived = getDerivedState(state);
    expect(derived.editedNoteIds).toEqual(["n4"]);
    expect(derived.correctionCount).toBe(1);
  });
});

describe("immutability", () => {
  it("does not mutate the original lesson or its notes through edits", () => {
    const exercise = makeExercise();
    const original = snapshot(exercise);
    let state = createCorrectionState(exercise);
    state = changeMidi(state, "n1", 72);
    state = deleteNote(state, "n3");
    state = addNote(state, { midi: 65, start: 2.6, duration: 0.4, velocity: 88 });
    state = shiftAll(state, 0.5);
    expect(exercise).toEqual(original);
    expect(state.originalEvents).toEqual(exercise.events);
    expect(state.originalEvents).not.toBe(exercise.events);
  });

  it("throws when the frozen original events are mutated", () => {
    const state = createCorrectionState(makeExercise());
    expect(() => {
      (state.originalEvents[0] as unknown as Record<string, unknown>).midi = 1;
    }).toThrow(TypeError);
    expect(() => {
      (state.originalEvents as unknown as CorrectionNote[]).push({} as CorrectionNote);
    }).toThrow(TypeError);
  });

  it("returns defensive copies from getEvents and getExercise", () => {
    const state = createCorrectionState(makeExercise());
    const events = getEvents(state);
    events[0].midi = 1;
    expect(state.events[0].midi).toBe(60);
    const exercise = getExercise(state);
    exercise.events[0].midi = 1;
    expect(state.events[0].midi).toBe(60);
  });
});

describe("history stores only note data", () => {
  it("never stores browser objects, audio elements or object URLs", () => {
    const exercise = makeExercise();
    let state = createCorrectionState(exercise);
    for (let index = 0; index < 6; index += 1) {
      state = index % 2 === 0 ? changeMidi(state, "n1", 61) : changeStart(state, "n1", 0.1);
    }
    state = undo(state);
    state = undo(state);
    const snapshots = [...state.past, ...state.future, state.events];
    const allowedKeys = new Set(["id", "midi", "name", "start", "duration", "velocity", "hand", "finger", "confidence"]);
    for (const events of snapshots) {
      for (const event of events) {
        for (const key of Object.keys(event)) {
          expect(allowedKeys.has(key)).toBe(true);
        }
        const value = event as unknown as Record<string, unknown>;
        expect(value instanceof File).toBe(false);
        if (typeof HTMLAudioElement !== "undefined") {
          expect(value instanceof HTMLAudioElement).toBe(false);
        }
        expect(JSON.stringify(value)).not.toMatch(/blob:/);
      }
    }
    expect(() => JSON.stringify(state)).not.toThrow();
  });
});

describe("integration with the lesson engine", () => {
  it("produces a NoteEvent-compatible corrected exercise", () => {
    const exercise = makeExercise();
    const editor = createCorrectionEditor(exercise);
    editor.selectNote("n2");
    editor.addNote({ midi: 65, start: 2.6, duration: 0.4, velocity: 90, confidence: 0.7 });
    editor.changeMidi("n2", 66);
    const corrected = editor.getExercise();
    const events: NoteEvent[] = corrected.events;
    expect(events).toHaveLength(5);
    expect(corrected.id).toBe(exercise.id);
    expect(corrected.bpm).toBe(exercise.bpm);
    expect(corrected.duration).toBeGreaterThanOrEqual(exercise.duration);
    expect(editor.getDerivedState().correctionCount).toBe(2);
    editor.undo();
    expect(editor.getExercise().events.find((event) => event.id === "n2")?.midi).toBe(62);
    editor.redo();
    expect(editor.getExercise().events.find((event) => event.id === "n2")?.midi).toBe(66);
  });

  it("extends the exercise duration when notes are moved past the end", () => {
    let state = createCorrectionState(makeExercise());
    state = moveNote(state, "n4", 5);
    const exercise = getExercise(state);
    expect(exercise.duration).toBe(7.6);
  });

  it("exposes pure validation helpers", () => {
    const state = createCorrectionState(makeExercise());
    expect(validateCorrectionNote(state.originalEvents[0])).toEqual([]);
    expect(getOverlapWarnings(state.events)).toEqual([]);
  });

  it("keeps all note ids unique through a correction session", () => {
    const editor = createCorrectionEditor(makeExercise());
    for (let index = 0; index < 20; index += 1) {
      editor.addNote({ midi: 60 + index, start: 0.05 * index, duration: 0.3, velocity: 88 });
    }
    const ids = editor.getExercise().events.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
