"use client";

import { useState } from "react";
import type { DetectedLesson } from "../lesson/detected-lesson";
import type { CorrectionDerivedState, CorrectionNoteInput } from "./correction-engine";
import { CorrectionSession, createCorrectionSession } from "./correction-session";
import type { LessonExercise } from "../../types/lesson";

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
 * Owns the correction session for the currently loaded detected lesson.
 * The session is created on mount (and whenever the detected lesson changes,
 * so corrections survive exiting edit mode but start clean for a new upload)
 * and becomes null when no detected lesson is loaded. The session object is
 * mutated in place by the engine operations and a version counter forces the
 * UI to re-read the fresh derived state, so the corrected exercise returned
 * here always drives the lesson engine, visualiser and generated piano.
 */
export function useCorrectionEditor(detectedLesson: DetectedLesson | null) {
  const [session, setSession] = useState<CorrectionSession | null>(() => createCorrectionSession(detectedLesson));
  const [loadedLesson, setLoadedLesson] = useState(detectedLesson);
  const [, setVersion] = useState(0);

  if (loadedLesson !== detectedLesson) {
    setLoadedLesson(detectedLesson);
    setSession(createCorrectionSession(detectedLesson));
  }

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
