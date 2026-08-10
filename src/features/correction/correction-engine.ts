import type { LessonExercise, LessonHand, NoteEvent } from "../../types/lesson";
import { midiToNote, PIANO_KEY_COUNT, PIANO_START_MIDI } from "../../utils/music";

export const CORRECTION_MIDI_MIN = PIANO_START_MIDI;
export const CORRECTION_MIDI_MAX = PIANO_START_MIDI + PIANO_KEY_COUNT - 1;
export const CORRECTION_VELOCITY_MIN = 1;
export const CORRECTION_VELOCITY_MAX = 127;
export const MAX_CORRECTION_HISTORY = 50;

export type CorrectionNote = NoteEvent & {
  confidence?: number | null;
};

export type CorrectionNoteInput = {
  id?: string;
  midi: number;
  start: number;
  duration: number;
  velocity: number;
  confidence?: number | null;
  hand?: LessonHand | null;
  finger?: NoteEvent["finger"];
};

export type CorrectionWarning = {
  type: "overlap";
  message: string;
  eventIds: [string, string];
};

export type CorrectionState = {
  originalExercise: Readonly<Omit<LessonExercise, "events"> & { events: readonly CorrectionNote[] }>;
  originalEvents: readonly CorrectionNote[];
  events: CorrectionNote[];
  past: CorrectionNote[][];
  future: CorrectionNote[][];
  selectedNoteId: string | null;
};

export type CorrectionDerivedState = {
  dirty: boolean;
  editedNoteIds: string[];
  addedNoteIds: string[];
  deletedNoteIds: string[];
  canUndo: boolean;
  canRedo: boolean;
  correctionCount: number;
  warnings: CorrectionWarning[];
};

export class CorrectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorrectionError";
  }
}

export class CorrectionValidationError extends CorrectionError {
  constructor(message: string) {
    super(message);
    this.name = "CorrectionValidationError";
  }
}

function cloneEvents(events: readonly CorrectionNote[]): CorrectionNote[] {
  return events.map((event) => ({ ...event }));
}

function sortEvents(events: readonly CorrectionNote[]): CorrectionNote[] {
  return [...events].sort((left, right) => left.start - right.start || left.midi - right.midi);
}

export function correctionNoteEqual(left: CorrectionNote, right: CorrectionNote): boolean {
  return left.id === right.id && left.midi === right.midi && left.name === right.name && left.start === right.start && left.duration === right.duration && left.velocity === right.velocity && left.hand === right.hand && left.finger === right.finger && left.confidence === right.confidence;
}

function correctionEventsEqual(left: readonly CorrectionNote[], right: readonly CorrectionNote[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((note, index) => correctionNoteEqual(note, right[index]));
}

export function validateCorrectionNote(note: CorrectionNote): string[] {
  const errors: string[] = [];
  if (typeof note.id !== "string" || note.id.trim() === "") errors.push("Note id must be a non-empty string.");
  if (!Number.isInteger(note.midi) || note.midi < CORRECTION_MIDI_MIN || note.midi > CORRECTION_MIDI_MAX) errors.push(`MIDI value must be an integer between ${CORRECTION_MIDI_MIN} and ${CORRECTION_MIDI_MAX}.`);
  if (!Number.isFinite(note.start) || note.start < 0) errors.push("Start time must be a finite, non-negative number.");
  if (!Number.isFinite(note.duration) || note.duration <= 0) errors.push("Duration must be a positive, finite number.");
  if (!Number.isInteger(note.velocity) || note.velocity < CORRECTION_VELOCITY_MIN || note.velocity > CORRECTION_VELOCITY_MAX) errors.push(`Velocity must be an integer between ${CORRECTION_VELOCITY_MIN} and ${CORRECTION_VELOCITY_MAX}.`);
  if (note.confidence !== undefined && note.confidence !== null && (!Number.isFinite(note.confidence) || note.confidence < 0 || note.confidence > 1)) errors.push("Confidence must be between 0 and 1.");
  if (note.name !== midiToNote(note.midi).name) errors.push(`Note name "${note.name}" does not match MIDI value ${note.midi}.`);
  if (note.hand !== null && note.hand !== "left" && note.hand !== "right") errors.push("Hand must be 'left', 'right' or null.");
  if (note.finger !== null && note.finger !== undefined && ![1, 2, 3, 4, 5].includes(note.finger)) errors.push("Finger must be between 1 and 5, or null.");
  return errors;
}

export function validateCorrectionEvents(events: readonly CorrectionNote[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  events.forEach((note) => {
    if (seen.has(note.id)) errors.push(`Duplicate note id "${note.id}".`);
    seen.add(note.id);
    errors.push(...validateCorrectionNote(note));
  });
  return errors;
}

export function getOverlapWarnings(events: readonly CorrectionNote[]): CorrectionWarning[] {
  const warnings: CorrectionWarning[] = [];
  for (let left = 0; left < events.length; left += 1) {
    for (let right = left + 1; right < events.length; right += 1) {
      const a = events[left];
      const b = events[right];
      if (a.start < b.start + b.duration && b.start < a.start + a.duration) {
        warnings.push({ type: "overlap", eventIds: [a.id, b.id], message: `Note "${a.id}" overlaps note "${b.id}".` });
      }
    }
  }
  return warnings;
}

function generateNoteId(events: readonly CorrectionNote[]): string {
  let index = 1;
  while (events.some((event) => event.id === `added-${index}`)) index += 1;
  return `added-${index}`;
}

function requireNoteIndex(events: readonly CorrectionNote[], id: string): number {
  const index = events.findIndex((event) => event.id === id);
  if (index === -1) throw new CorrectionError(`Note "${id}" does not exist.`);
  return index;
}

function commit(state: CorrectionState, nextEvents: CorrectionNote[]): CorrectionState {
  const sorted = sortEvents(nextEvents);
  const errors = validateCorrectionEvents(sorted);
  if (errors.length > 0) throw new CorrectionValidationError(`Rejected edit: ${errors.join(" ")}`);
  if (correctionEventsEqual(state.events, sorted)) return state;
  const past = [...state.past, cloneEvents(state.events)];
  if (past.length > MAX_CORRECTION_HISTORY) past.shift();
  return { ...state, events: sorted, past, future: [] };
}

function ensureSelectionValid(state: CorrectionState): CorrectionState {
  if (state.selectedNoteId === null) return state;
  if (state.events.some((event) => event.id === state.selectedNoteId)) return state;
  return { ...state, selectedNoteId: null };
}

export function createCorrectionState(exercise: LessonExercise): CorrectionState {
  const originalEvents = exercise.events.map((event) => Object.freeze({ ...event }) as CorrectionNote);
  const originalExercise = Object.freeze({ ...exercise, events: Object.freeze(originalEvents) }) as Readonly<Omit<LessonExercise, "events"> & { events: readonly CorrectionNote[] }>;
  const errors = validateCorrectionEvents(originalEvents);
  if (errors.length > 0) throw new CorrectionValidationError(`Original lesson contains invalid notes: ${errors.join(" ")}`);
  return { originalExercise, originalEvents, events: cloneEvents(originalEvents), past: [], future: [], selectedNoteId: null };
}

export function selectNote(state: CorrectionState, id: string | null): CorrectionState {
  if (id === null) return { ...state, selectedNoteId: null };
  requireNoteIndex(state.events, id);
  if (state.selectedNoteId === id) return state;
  return { ...state, selectedNoteId: id };
}

export function addNote(state: CorrectionState, input: CorrectionNoteInput): CorrectionState {
  const id = input.id && input.id.trim() !== "" ? input.id : generateNoteId(state.events);
  if (state.events.some((event) => event.id === id)) throw new CorrectionValidationError(`A note with id "${id}" already exists.`);
  const note: CorrectionNote = {
    id,
    midi: input.midi,
    name: midiToNote(input.midi).name,
    start: input.start,
    duration: input.duration,
    velocity: input.velocity,
    hand: input.hand ?? null,
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    ...(input.finger !== undefined ? { finger: input.finger } : {}),
  };
  return commit(state, [...state.events, note]);
}

export function deleteNote(state: CorrectionState, id: string): CorrectionState {
  const next = state.events.filter((event) => event.id !== id);
  if (next.length === state.events.length) throw new CorrectionError(`Note "${id}" does not exist.`);
  return ensureSelectionValid(commit(state, next));
}

export function changeMidi(state: CorrectionState, id: string, midi: number): CorrectionState {
  if (!Number.isInteger(midi) || midi < CORRECTION_MIDI_MIN || midi > CORRECTION_MIDI_MAX) throw new CorrectionValidationError(`MIDI value must be an integer between ${CORRECTION_MIDI_MIN} and ${CORRECTION_MIDI_MAX}.`);
  const index = requireNoteIndex(state.events, id);
  const next = state.events.map((event, i) => (i === index ? { ...event, midi, name: midiToNote(midi).name } : event));
  return commit(state, next);
}

export function changeStart(state: CorrectionState, id: string, start: number): CorrectionState {
  if (!Number.isFinite(start) || start < 0) throw new CorrectionValidationError("Start time must be a finite, non-negative number.");
  const index = requireNoteIndex(state.events, id);
  const next = state.events.map((event, i) => (i === index ? { ...event, start } : event));
  return commit(state, next);
}

export function changeDuration(state: CorrectionState, id: string, duration: number): CorrectionState {
  if (!Number.isFinite(duration) || duration <= 0) throw new CorrectionValidationError("Duration must be a positive, finite number.");
  const index = requireNoteIndex(state.events, id);
  const next = state.events.map((event, i) => (i === index ? { ...event, duration } : event));
  return commit(state, next);
}

export function changeVelocity(state: CorrectionState, id: string, velocity: number): CorrectionState {
  if (!Number.isInteger(velocity) || velocity < CORRECTION_VELOCITY_MIN || velocity > CORRECTION_VELOCITY_MAX) throw new CorrectionValidationError(`Velocity must be an integer between ${CORRECTION_VELOCITY_MIN} and ${CORRECTION_VELOCITY_MAX}.`);
  const index = requireNoteIndex(state.events, id);
  const next = state.events.map((event, i) => (i === index ? { ...event, velocity } : event));
  return commit(state, next);
}

export function changeConfidence(state: CorrectionState, id: string, confidence: number): CorrectionState {
  const index = requireNoteIndex(state.events, id);
  if (state.events[index].confidence === undefined) throw new CorrectionValidationError("Confidence is not available for this note and cannot be changed.");
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new CorrectionValidationError("Confidence must be between 0 and 1.");
  const next = state.events.map((event, i) => (i === index ? { ...event, confidence } : event));
  return commit(state, next);
}

export function moveNote(state: CorrectionState, id: string, deltaSeconds: number): CorrectionState {
  if (!Number.isFinite(deltaSeconds)) throw new CorrectionValidationError("Move offset must be a finite number.");
  if (deltaSeconds === 0) return state;
  const index = requireNoteIndex(state.events, id);
  const start = Math.max(0, state.events[index].start + deltaSeconds);
  const next = state.events.map((event, i) => (i === index ? { ...event, start } : event));
  return commit(state, next);
}

export function shiftAll(state: CorrectionState, deltaSeconds: number): CorrectionState {
  if (!Number.isFinite(deltaSeconds)) throw new CorrectionValidationError("Time shift must be a finite number.");
  if (deltaSeconds === 0) return state;
  const next = state.events.map((event) => ({ ...event, start: Math.max(0, event.start + deltaSeconds) }));
  return commit(state, next);
}

export function resetNote(state: CorrectionState, id: string): CorrectionState {
  const index = requireNoteIndex(state.events, id);
  const original = state.originalEvents.find((event) => event.id === id);
  const next = original ? state.events.map((event, i) => (i === index ? { ...original } : event)) : state.events.filter((event) => event.id !== id);
  return ensureSelectionValid(commit(state, next));
}

export function resetAll(state: CorrectionState): CorrectionState {
  return ensureSelectionValid(commit(state, cloneEvents(state.originalEvents)));
}

export function undo(state: CorrectionState): CorrectionState {
  if (state.past.length === 0) return state;
  const events = state.past[state.past.length - 1];
  const past = state.past.slice(0, -1);
  const future = [cloneEvents(state.events), ...state.future];
  return ensureSelectionValid({ ...state, events: cloneEvents(events), past, future });
}

export function redo(state: CorrectionState): CorrectionState {
  if (state.future.length === 0) return state;
  const events = state.future[0];
  const future = state.future.slice(1);
  const past = [...state.past, cloneEvents(state.events)];
  return ensureSelectionValid({ ...state, events: cloneEvents(events), past, future });
}

export function getEvents(state: CorrectionState): CorrectionNote[] {
  return cloneEvents(state.events);
}

export function getExercise(state: CorrectionState): LessonExercise {
  const original = state.originalExercise;
  const lastEnd = state.events.reduce((max, event) => Math.max(max, event.start + event.duration), 0);
  return {
    id: original.id,
    title: original.title,
    description: original.description,
    bpm: original.bpm,
    beatsPerMeasure: original.beatsPerMeasure,
    duration: Math.max(original.duration, lastEnd),
    events: cloneEvents(state.events),
  };
}

export function getDerivedState(state: CorrectionState): CorrectionDerivedState {
  const originalById = new Map(state.originalEvents.map((event) => [event.id, event]));
  const currentById = new Set(state.events.map((event) => event.id));
  const editedNoteIds: string[] = [];
  const addedNoteIds: string[] = [];
  const deletedNoteIds: string[] = [];
  for (const event of state.events) {
    const original = originalById.get(event.id);
    if (!original) addedNoteIds.push(event.id);
    else if (!correctionNoteEqual(event, original)) editedNoteIds.push(event.id);
  }
  for (const event of state.originalEvents) {
    if (!currentById.has(event.id)) deletedNoteIds.push(event.id);
  }
  return {
    dirty: editedNoteIds.length > 0 || addedNoteIds.length > 0 || deletedNoteIds.length > 0,
    editedNoteIds,
    addedNoteIds,
    deletedNoteIds,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    correctionCount: editedNoteIds.length + addedNoteIds.length + deletedNoteIds.length,
    warnings: getOverlapWarnings(state.events),
  };
}

export type CorrectionEditor = {
  getState: () => CorrectionState;
  getEvents: () => CorrectionNote[];
  getExercise: () => LessonExercise;
  getDerivedState: () => CorrectionDerivedState;
  selectNote: (id: string | null) => void;
  addNote: (input: CorrectionNoteInput) => void;
  deleteNote: (id: string) => void;
  changeMidi: (id: string, midi: number) => void;
  changeStart: (id: string, start: number) => void;
  changeDuration: (id: string, duration: number) => void;
  changeVelocity: (id: string, velocity: number) => void;
  changeConfidence: (id: string, confidence: number) => void;
  moveNote: (id: string, deltaSeconds: number) => void;
  shiftAll: (deltaSeconds: number) => void;
  resetNote: (id: string) => void;
  resetAll: () => void;
  undo: () => void;
  redo: () => void;
};

export function createCorrectionEditor(exercise: LessonExercise): CorrectionEditor {
  let state = createCorrectionState(exercise);
  return {
    getState: () => state,
    getEvents: () => getEvents(state),
    getExercise: () => getExercise(state),
    getDerivedState: () => getDerivedState(state),
    selectNote: (id) => {
      state = selectNote(state, id);
    },
    addNote: (input) => {
      state = addNote(state, input);
    },
    deleteNote: (id) => {
      state = deleteNote(state, id);
    },
    changeMidi: (id, midi) => {
      state = changeMidi(state, id, midi);
    },
    changeStart: (id, start) => {
      state = changeStart(state, id, start);
    },
    changeDuration: (id, duration) => {
      state = changeDuration(state, id, duration);
    },
    changeVelocity: (id, velocity) => {
      state = changeVelocity(state, id, velocity);
    },
    changeConfidence: (id, confidence) => {
      state = changeConfidence(state, id, confidence);
    },
    moveNote: (id, deltaSeconds) => {
      state = moveNote(state, id, deltaSeconds);
    },
    shiftAll: (deltaSeconds) => {
      state = shiftAll(state, deltaSeconds);
    },
    resetNote: (id) => {
      state = resetNote(state, id);
    },
    resetAll: () => {
      state = resetAll(state);
    },
    undo: () => {
      state = undo(state);
    },
    redo: () => {
      state = redo(state);
    },
  };
}
