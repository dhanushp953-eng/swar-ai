"use client";

import { useState } from "react";
import type { CorrectionDerivedState, CorrectionNoteInput } from "./correction-engine";
import { CorrectionSession } from "./correction-session";
import type { LessonExercise } from "../../types/lesson";

/**
 * Identifies the lesson the correction editor is currently editing. Detected
 * and imported lessons are both editable; demo lessons are read-only and pass
 * null. The sourceKey changes whenever a brand new lesson is loaded (a new
 * audio analysis, or a fresh file import) so corrections never carry over
 * between unrelated lessons.
 */
export type CorrectionSource = {
  origin: "detected" | "imported";
  sourceKey: string;
  exercise: LessonExercise;
};

export type CorrectionEditorApi = {
  select: (id: string | null) => void;
  selectByIndex: (index: number) => void;
  selectPrevious: () => void;
  selectNext: () => void;
  addNote: (input: CorrectionNoteInput) => string | null | undefined;
  deleteNote: (id: string) => void;
  deleteSelected: () => void;
  changeMidi: (id: string, midi: number) => void;
  changeStart: (id: string, start: number) => void;
  changeDuration: (id: string, duration: number) => void;
  changeVelocity: (id: string, velocity: number) => void;
  moveSelected: (deltaSeconds: number) => void;
  shiftAll: (deltaSeconds: number) => void;
  resetSelected: () => void;
  resetAll: () => void;
  undo: () => void;
  redo: () => void;
};

/**
 * Owns the correction session for the currently editable lesson (detected or
 * imported). The session is created on mount and whenever the source key
 * changes, so corrections survive exiting edit mode and switching between
 * lessons, but start clean for a new upload or file import. The session object
 * is mutated in place by the engine operations and a version counter forces
 * the UI to re-read the fresh derived state, so the corrected exercise
 * returned here always drives the lesson engine, visualiser and generated
 * piano.
 */
export function useCorrectionEditor(source: CorrectionSource | null) {
  const [session, setSession] = useState<CorrectionSession | null>(() => (source ? new CorrectionSession(source.exercise) : null));
  const [loadedKey, setLoadedKey] = useState<string | null>(source?.sourceKey ?? null);

  if ((source?.sourceKey ?? null) !== loadedKey) {
    setLoadedKey(source?.sourceKey ?? null);
    setSession(source ? new CorrectionSession(source.exercise) : null);
  }

  const [, setVersion] = useState(0);
  const refresh = () => setVersion((version) => version + 1);

  const run = <T,>(op: (current: CorrectionSession) => T): T | undefined => {
    if (!session) return undefined;
    const result = op(session);
    refresh();
    return result;
  };

  const api: CorrectionEditorApi = {
    select: (id) => {
      run((current) => current.select(id));
    },
    selectByIndex: (index) => {
      run((current) => current.selectByIndex(index));
    },
    selectPrevious: () => {
      run((current) => current.selectPrevious());
    },
    selectNext: () => {
      run((current) => current.selectNext());
    },
    addNote: (input) => run((current) => current.addNote(input)),
    deleteNote: (id) => {
      run((current) => current.deleteNote(id));
    },
    deleteSelected: () => {
      run((current) => current.deleteSelected());
    },
    changeMidi: (id, midi) => {
      run((current) => current.changeMidi(id, midi));
    },
    changeStart: (id, start) => {
      run((current) => current.changeStart(id, start));
    },
    changeDuration: (id, duration) => {
      run((current) => current.changeDuration(id, duration));
    },
    changeVelocity: (id, velocity) => {
      run((current) => current.changeVelocity(id, velocity));
    },
    moveSelected: (delta) => {
      run((current) => current.moveSelected(delta));
    },
    shiftAll: (delta) => {
      run((current) => current.shiftAll(delta));
    },
    resetSelected: () => {
      run((current) => current.resetSelected());
    },
    resetAll: () => {
      run((current) => current.resetAll());
    },
    undo: () => {
      run((current) => current.undo());
    },
    redo: () => {
      run((current) => current.redo());
    },
  };

  const derived: CorrectionDerivedState | null = session ? session.getDerived() : null;
  const exercise: LessonExercise | null = session ? session.getExercise() : null;

  return { session, derived, exercise, api };
}
