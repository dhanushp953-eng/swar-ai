import type { DetectedLesson } from "../lesson/detected-lesson";
import type { LessonExercise } from "../../types/lesson";
import {
  addNote as engineAddNote,
  changeDuration as engineChangeDuration,
  changeMidi as engineChangeMidi,
  changeStart as engineChangeStart,
  changeVelocity as engineChangeVelocity,
  createCorrectionState,
  deleteNote as engineDeleteNote,
  getDerivedState,
  getEvents,
  getExercise,
  moveNote as engineMoveNote,
  redo as engineRedo,
  resetAll as engineResetAll,
  resetNote as engineResetNote,
  selectNote as engineSelectNote,
  shiftAll as engineShiftAll,
  undo as engineUndo,
  type CorrectionDerivedState,
  type CorrectionNote,
  type CorrectionNoteInput,
  type CorrectionState,
} from "./correction-engine";

export type CorrectionShortcut = "undo" | "redo";

/**
 * The "Edit detected lesson" affordance is only available when a detected
 * lesson is actually loaded. Demo lessons stay read-only and never reach the
 * correction session.
 */
export function canEditDetectedLesson(selection: { isDetected: boolean; detectedLesson: DetectedLesson | null }): boolean {
  return selection.isDetected && Boolean(selection.detectedLesson);
}

/**
 * Deleting a note, resetting the whole lesson and resetting a single note are
 * destructive actions the UI must confirm before applying. Every other edit
 * is applied directly.
 */
export function requiresConfirmation(action: "delete-note" | "reset-all" | "reset-note" | "add-note" | "shift" | "move" | "field"): boolean {
  return action === "delete-note" || action === "reset-all" || action === "reset-note";
}

export type ResetSelectedStatus =
  | { enabled: true }
  | { enabled: false; reason: "no-selection" | "added" | "not-edited" };

/**
 * Describes whether the "Reset selected note" action is available for the
 * currently selected note. A note can only be reset when it was edited away
 * from its original detected value. Added notes have no original to restore
 * to (they must be deleted instead) and untouched original notes already
 * match their detection, so both keep the action disabled.
 */
export function getResetSelectedStatus(
  selectedNoteId: string | null,
  editedNoteIds: readonly string[],
  addedNoteIds: readonly string[],
): ResetSelectedStatus {
  if (!selectedNoteId) return { enabled: false, reason: "no-selection" };
  if (addedNoteIds.includes(selectedNoteId)) return { enabled: false, reason: "added" };
  if (editedNoteIds.includes(selectedNoteId)) return { enabled: true };
  return { enabled: false, reason: "not-edited" };
}

/**
 * Maps editor keyboard events to correction shortcuts. Only Ctrl/Cmd modified
 * combinations are handled so the plain-letter piano shortcuts never clash.
 */
export function mapCorrectionShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): CorrectionShortcut | null {
  const modifier = event.ctrlKey || event.metaKey;
  if (!modifier) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y") return "redo";
  return null;
}

/**
 * Creates a correction session for a loaded detected lesson. Passing null
 * (no detected lesson, or the uploaded audio was removed and the session
 * must be cleared) returns null and the caller falls back to the original
 * exercise.
 */
export function createCorrectionSession(lesson: DetectedLesson | null): CorrectionSession | null {
  return lesson ? new CorrectionSession(lesson.exercise) : null;
}

/**
 * Framework-agnostic session over a single detected lesson. It owns one
 * CorrectionState, applies every edit through the pure correction-engine
 * operations, and exposes the corrected LessonExercise for the visualiser
 * and generated piano. The original lesson passed to the constructor is
 * never mutated (the engine freezes it internally).
 */
export class CorrectionSession {
  private state: CorrectionState;
  private readonly originalExercise: LessonExercise;

  constructor(originalExercise: LessonExercise) {
    this.originalExercise = originalExercise;
    this.state = createCorrectionState(originalExercise);
  }

  getState(): CorrectionState {
    return this.state;
  }

  getDerived(): CorrectionDerivedState {
    return getDerivedState(this.state);
  }

  getExercise(): LessonExercise {
    return getExercise(this.state);
  }

  getEvents(): CorrectionNote[] {
    return getEvents(this.state);
  }

  get selectedNoteId(): string | null {
    return this.state.selectedNoteId;
  }

  getNoteCount(): number {
    return this.state.events.length;
  }

  getSelectedIndex(): number {
    if (!this.state.selectedNoteId) return -1;
    return this.state.events.findIndex((event) => event.id === this.state.selectedNoteId);
  }

  getSelectedNote(): CorrectionNote | null {
    if (!this.state.selectedNoteId) return null;
    return this.state.events.find((event) => event.id === this.state.selectedNoteId) ?? null;
  }

  select(id: string | null): void {
    this.state = engineSelectNote(this.state, id);
  }

  selectByIndex(index: number): void {
    const event = this.state.events[index];
    if (!event) throw new Error(`Correction session has no note at index ${index}.`);
    this.state = engineSelectNote(this.state, event.id);
  }

  selectPrevious(): void {
    const index = this.getSelectedIndex();
    if (index <= 0) return;
    this.selectByIndex(index - 1);
  }

  selectNext(): void {
    const index = this.getSelectedIndex();
    if (index < 0) {
      if (this.state.events.length > 0) this.selectByIndex(0);
      return;
    }
    if (index >= this.state.events.length - 1) return;
    this.selectByIndex(index + 1);
  }

  addNote(input: CorrectionNoteInput): string | null {
    const previousIds = new Set(this.state.events.map((event) => event.id));
    this.state = engineAddNote(this.state, input);
    return this.state.events.find((event) => !previousIds.has(event.id))?.id ?? null;
  }

  deleteNote(id: string): void {
    this.state = engineDeleteNote(this.state, id);
  }

  deleteSelected(): void {
    if (this.state.selectedNoteId) this.state = engineDeleteNote(this.state, this.state.selectedNoteId);
  }

  changeMidi(id: string, midi: number): void {
    this.state = engineChangeMidi(this.state, id, midi);
  }

  changeStart(id: string, start: number): void {
    this.state = engineChangeStart(this.state, id, start);
  }

  changeDuration(id: string, duration: number): void {
    this.state = engineChangeDuration(this.state, id, duration);
  }

  changeVelocity(id: string, velocity: number): void {
    this.state = engineChangeVelocity(this.state, id, velocity);
  }

  moveSelected(deltaSeconds: number): void {
    if (!this.state.selectedNoteId) return;
    this.state = engineMoveNote(this.state, this.state.selectedNoteId, deltaSeconds);
  }

  shiftAll(deltaSeconds: number): void {
    this.state = engineShiftAll(this.state, deltaSeconds);
  }

  resetNote(id: string): void {
    this.state = engineResetNote(this.state, id);
  }

  resetSelected(): void {
    if (!this.state.selectedNoteId) return;
    this.state = engineResetNote(this.state, this.state.selectedNoteId);
  }

  resetAll(): void {
    this.state = engineResetAll(this.state);
  }

  undo(): void {
    this.state = engineUndo(this.state);
  }

  redo(): void {
    this.state = engineRedo(this.state);
  }
}
