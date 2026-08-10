import { describe, expect, it } from "vitest";
import type { DetectedLesson } from "../lesson/detected-lesson";
import {
  canEditDetectedLesson,
  CorrectionSession,
  createCorrectionSession,
  getResetSelectedStatus,
  mapCorrectionShortcut,
  requiresConfirmation,
} from "./correction-session";
import { CorrectionValidationError } from "./correction-engine";
import type { LessonExercise, NoteEvent } from "../../types/lesson";

function note(id: string, midi: number, name: string, start: number, duration = 0.5, velocity = 100): NoteEvent {
  return { id, midi, name, start, duration, velocity, hand: null };
}

function makeExercise(): LessonExercise {
  return {
    id: "detected-abc",
    title: "Detected melody",
    description: "test",
    bpm: 80,
    beatsPerMeasure: 4,
    duration: 3,
    events: [
      note("n1", 60, "C4", 0),
      note("n2", 62, "D4", 0.7),
      note("n3", 64, "E4", 1.4),
      note("n4", 67, "G4", 2.1),
    ],
  };
}

function makeDetectedLesson(): DetectedLesson {
  return {
    exercise: makeExercise(),
    audioFile: new File([new Uint8Array([1, 2, 3])], "melody.wav", { type: "audio/wav" }),
    estimatedBpm: 80,
    melodyConfidence: 0.9,
    warnings: [],
  };
}

describe("canEditDetectedLesson", () => {
  it("allows editing only when a detected lesson is loaded", () => {
    expect(canEditDetectedLesson({ isDetected: true, detectedLesson: makeDetectedLesson() })).toBe(true);
    expect(canEditDetectedLesson({ isDetected: false, detectedLesson: makeDetectedLesson() })).toBe(false);
    expect(canEditDetectedLesson({ isDetected: true, detectedLesson: null })).toBe(false);
    expect(canEditDetectedLesson({ isDetected: false, detectedLesson: null })).toBe(false);
  });
});

describe("requiresConfirmation", () => {
  it("requires confirmation for deleting, resetting the whole lesson and resetting a note", () => {
    expect(requiresConfirmation("delete-note")).toBe(true);
    expect(requiresConfirmation("reset-all")).toBe(true);
    expect(requiresConfirmation("reset-note")).toBe(true);
    expect(requiresConfirmation("add-note")).toBe(false);
    expect(requiresConfirmation("shift")).toBe(false);
    expect(requiresConfirmation("move")).toBe(false);
    expect(requiresConfirmation("field")).toBe(false);
  });
});

describe("getResetSelectedStatus", () => {
  it("is disabled when no note is selected", () => {
    expect(getResetSelectedStatus(null, [], [])).toEqual({ enabled: false, reason: "no-selection" });
  });

  it("is enabled only when the selected note was edited", () => {
    expect(getResetSelectedStatus("n2", ["n2"], [])).toEqual({ enabled: true });
    expect(getResetSelectedStatus("n1", ["n2"], [])).toEqual({ enabled: false, reason: "not-edited" });
    expect(getResetSelectedStatus("n1", [], [])).toEqual({ enabled: false, reason: "not-edited" });
  });

  it("is disabled for an added note, which has no original to reset to", () => {
    expect(getResetSelectedStatus("added-1", [], ["added-1"])).toEqual({ enabled: false, reason: "added" });
    expect(getResetSelectedStatus("added-1", ["added-1"], ["added-1"])).toEqual({ enabled: false, reason: "added" });
  });
});

describe("mapCorrectionShortcut", () => {
  it("maps Ctrl/Cmd+Z to undo and Shift variants to redo", () => {
    expect(mapCorrectionShortcut({ key: "z", ctrlKey: true, metaKey: false, shiftKey: false })).toBe("undo");
    expect(mapCorrectionShortcut({ key: "z", ctrlKey: true, metaKey: false, shiftKey: true })).toBe("redo");
    expect(mapCorrectionShortcut({ key: "y", ctrlKey: true, metaKey: false, shiftKey: false })).toBe("redo");
    expect(mapCorrectionShortcut({ key: "z", ctrlKey: false, metaKey: true, shiftKey: false })).toBe("undo");
    expect(mapCorrectionShortcut({ key: "z", ctrlKey: false, metaKey: true, shiftKey: true })).toBe("redo");
    expect(mapCorrectionShortcut({ key: "y", ctrlKey: false, metaKey: true, shiftKey: false })).toBe("redo");
  });

  it("never maps plain keys so piano shortcuts keep working", () => {
    expect(mapCorrectionShortcut({ key: "a", ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull();
    expect(mapCorrectionShortcut({ key: "z", ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull();
    expect(mapCorrectionShortcut({ key: "y", ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull();
    expect(mapCorrectionShortcut({ key: "Delete", ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull();
  });
});

describe("createCorrectionSession", () => {
  it("creates a clean session from a detected lesson", () => {
    const session = createCorrectionSession(makeDetectedLesson());
    expect(session).not.toBeNull();
    expect(session?.getDerived().dirty).toBe(false);
    expect(session?.getDerived().correctionCount).toBe(0);
    expect(session?.getExercise().events).toHaveLength(4);
  });

  it("returns null when there is no detected lesson (file removed or demo mode)", () => {
    expect(createCorrectionSession(null)).toBeNull();
  });
});

describe("enter/exit edit mode keeps the session", () => {
  it("preserves corrections made during the session across mode toggles", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.changeMidi("n2", 65);
    // Exiting edit mode only closes the panel; the session remains.
    // Entering again reuses the same session object.
    const exerciseBefore = session.getExercise();
    expect(exerciseBefore.events.find((event) => event.id === "n2")?.midi).toBe(65);
    expect(session.getDerived().dirty).toBe(true);
    expect(session.getDerived().correctionCount).toBe(1);
  });

  it("a fresh session for a new upload starts clean again", () => {
    const first = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    first.changeMidi("n1", 65);
    expect(first.getDerived().dirty).toBe(true);
    const replacement = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    expect(replacement.getDerived().dirty).toBe(false);
    expect(replacement.getDerived().correctionCount).toBe(0);
    expect(replacement.getExercise().events.map((event) => event.midi)).toEqual([60, 62, 64, 67]);
  });
});

describe("note selection", () => {
  it("selects by click (id) and clears with null", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.select("n2");
    expect(session.selectedNoteId).toBe("n2");
    expect(session.getSelectedIndex()).toBe(1);
    expect(session.getSelectedNote()?.name).toBe("D4");
    session.select(null);
    expect(session.selectedNoteId).toBeNull();
    expect(session.getSelectedIndex()).toBe(-1);
  });

  it("navigates previous/next in note order", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.select("n2");
    session.selectNext();
    expect(session.selectedNoteId).toBe("n3");
    session.selectNext();
    expect(session.selectedNoteId).toBe("n4");
    session.selectNext();
    expect(session.selectedNoteId).toBe("n4");
    session.selectPrevious();
    expect(session.selectedNoteId).toBe("n3");
    session.selectPrevious();
    session.selectPrevious();
    expect(session.selectedNoteId).toBe("n1");
    session.selectPrevious();
    expect(session.selectedNoteId).toBe("n1");
  });

  it("selects the first note with next when nothing is selected", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.selectNext();
    expect(session.selectedNoteId).toBe("n1");
  });

  it("selects by index", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.selectByIndex(3);
    expect(session.selectedNoteId).toBe("n4");
  });
});

describe("every field edit", () => {
  it("edits pitch, start, duration and velocity through the session", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.changeMidi("n2", 65);
    session.changeStart("n2", 1.2);
    session.changeDuration("n2", 0.8);
    session.changeVelocity("n2", 44);
    const event = session.getExercise().events.find((item) => item.id === "n2");
    expect(event).toMatchObject({ midi: 65, name: "F4", start: 1.2, duration: 0.8, velocity: 44 });
    expect(session.getDerived().editedNoteIds).toEqual(["n2"]);
    expect(session.getDerived().correctionCount).toBe(1);
  });

  it("invalid values throw and leave the session unchanged", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    const before = session.getExercise();
    expect(() => session.changeStart("n1", -1)).toThrow(CorrectionValidationError);
    expect(() => session.changeMidi("n1", 200)).toThrow(CorrectionValidationError);
    expect(() => session.changeDuration("n1", 0)).toThrow(CorrectionValidationError);
    expect(() => session.changeVelocity("n1", 0)).toThrow(CorrectionValidationError);
    expect(session.getExercise()).toEqual(before);
    expect(session.getDerived().dirty).toBe(false);
    expect(session.getState().past).toHaveLength(0);
  });
});

describe("add/delete/reset", () => {
  it("adds a note, returns its id and tracks it as added", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    const id = session.addNote({ midi: 65, start: 2.6, duration: 0.4, velocity: 88 });
    expect(id).toBe("added-1");
    expect(session.getNoteCount()).toBe(5);
    expect(session.getDerived().addedNoteIds).toEqual(["added-1"]);
    expect(session.getDerived().correctionCount).toBe(1);
  });

  it("deletes a note and clears an overlapping selection", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.select("n2");
    session.deleteSelected();
    expect(session.getNoteCount()).toBe(3);
    expect(session.selectedNoteId).toBeNull();
    expect(session.getDerived().deletedNoteIds).toEqual(["n2"]);
  });

  it("resets a single note and an added note", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.changeMidi("n1", 65);
    session.resetNote("n1");
    expect(session.getDerived().dirty).toBe(false);
    const withAdd = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    const id = withAdd.addNote({ midi: 65, start: 2.6, duration: 0.4, velocity: 88 });
    withAdd.resetNote(id as string);
    expect(withAdd.getNoteCount()).toBe(4);
    expect(withAdd.getDerived().addedNoteIds).toEqual([]);
  });

  it("resetting the selected note restores its original value and keeps it selected", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.select("n2");
    session.changeMidi("n2", 65);
    expect(session.getSelectedNote()?.name).toBe("F4");
    session.resetSelected();
    expect(session.getSelectedNote()?.name).toBe("D4");
    expect(session.selectedNoteId).toBe("n2");
    expect(session.getDerived().editedNoteIds).toEqual([]);
    expect(session.getDerived().dirty).toBe(false);
  });

  it("a reset stays undoable and redoable", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.changeMidi("n1", 65);
    session.resetNote("n1");
    expect(session.getExercise().events.find((event) => event.id === "n1")?.name).toBe("C4");
    expect(session.getDerived().canUndo).toBe(true);
    session.undo();
    expect(session.getExercise().events.find((event) => event.id === "n1")?.name).toBe("F4");
    expect(session.getDerived().canRedo).toBe(true);
    session.redo();
    expect(session.getExercise().events.find((event) => event.id === "n1")?.name).toBe("C4");
    expect(session.getDerived().dirty).toBe(false);
  });

  it("resets the whole lesson and stays undoable", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.changeMidi("n1", 65);
    session.deleteNote("n2");
    session.resetAll();
    expect(session.getExercise()).toEqual(makeExercise());
    expect(session.getDerived().dirty).toBe(false);
    expect(session.getDerived().correctionCount).toBe(0);
    expect(session.getDerived().canUndo).toBe(true);
    session.undo();
    expect(session.getDerived().dirty).toBe(true);
  });
});

describe("global shift and selected moves", () => {
  it("moves the selected note and clamps at zero", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.select("n1");
    session.moveSelected(0.5);
    expect(session.getExercise().events.find((event) => event.id === "n1")?.start).toBe(0.5);
    session.moveSelected(-1);
    expect(session.getExercise().events.find((event) => event.id === "n1")?.start).toBe(0);
  });

  it("shifts every note by a global offset", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.shiftAll(0.5);
    expect(session.getExercise().events.map((event) => event.start)).toEqual([0.5, 1.2, 1.9, 2.6]);
    session.shiftAll(-0.8);
    const starts = session.getExercise().events.map((event) => event.start);
    starts.forEach((value, index) => expect(value).toBeCloseTo([0, 0.4, 1.1, 1.8][index], 9));
  });
});

describe("undo/redo and no-op history", () => {
  it("undoes and redoes an edit", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.changeMidi("n1", 72);
    expect(session.getDerived().canUndo).toBe(true);
    session.undo();
    expect(session.getExercise().events.find((event) => event.id === "n1")?.midi).toBe(60);
    expect(session.getDerived().canRedo).toBe(true);
    session.redo();
    expect(session.getExercise().events.find((event) => event.id === "n1")?.midi).toBe(72);
  });

  it("no-op edits do not enter history", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.changeStart("n1", 0);
    expect(session.getDerived().canUndo).toBe(false);
    expect(session.getState().past).toHaveLength(0);
    session.changeMidi("n1", 60);
    expect(session.getState().past).toHaveLength(0);
  });
});

describe("corrected visualiser updates", () => {
  it("returns an up-to-date NoteEvent-compatible lesson", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.changeMidi("n4", 65);
    session.addNote({ midi: 72, start: 2.8, duration: 0.4, velocity: 90 });
    const corrected = session.getExercise();
    expect(corrected.events).toHaveLength(5);
    const events: NoteEvent[] = corrected.events;
    expect(events.some((event) => event.id === "added-1")).toBe(true);
    expect(corrected.bpm).toBe(80);
  });

  it("extends the exercise duration when notes run longer", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.changeDuration("n4", 2);
    expect(session.getExercise().duration).toBe(4.1);
  });
});

describe("audio and original analysis stay untouched", () => {
  it("keeps the uploaded audio file reference and original exercise intact", () => {
    const detected = makeDetectedLesson();
    const audioFile = detected.audioFile;
    const originalSnapshot = JSON.stringify(detected.exercise);
    const session = createCorrectionSession(detected) as CorrectionSession;
    session.changeMidi("n1", 65);
    session.deleteNote("n3");
    session.addNote({ midi: 72, start: 2.8, duration: 0.4, velocity: 90 });
    session.shiftAll(0.3);
    session.resetAll();
    expect(detected.audioFile).toBe(audioFile);
    expect(JSON.stringify(detected.exercise)).toBe(originalSnapshot);
    expect(session.getExercise()).toEqual(makeExercise());
  });

  it("history never stores file or object URL data", () => {
    const session = createCorrectionSession(makeDetectedLesson()) as CorrectionSession;
    session.changeMidi("n1", 65);
    session.changeStart("n2", 1.3);
    session.undo();
    const snapshots = [...session.getState().past, ...session.getState().future];
    for (const events of snapshots) {
      expect(JSON.stringify({ events })).not.toContain("blob:");
      for (const event of events) {
        expect(event).not.toBeInstanceOf(File);
      }
    }
  });
});
