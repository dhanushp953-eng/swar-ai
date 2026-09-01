import type { SongSheet } from "@/types/song-sheet";
import { chordProToSongSheet, songSheetToChordPro } from "./chordpro";

export const MAX_SONG_EDITOR_HISTORY = 50;

export type SongEditorState = {
  originalText: string;
  text: string;
  past: string[];
  future: string[];
};

export type SongEditorDerivedState = {
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  chordCount: number;
  lineCount: number;
};

export class SongEditorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SongEditorError";
  }
}

function sameText(left: string, right: string): boolean {
  return left === right;
}

function commit(state: SongEditorState, nextText: string): SongEditorState {
  if (sameText(state.text, nextText)) return state;
  const past = [...state.past, state.text];
  if (past.length > MAX_SONG_EDITOR_HISTORY) past.shift();
  return { ...state, text: nextText, past, future: [] };
}

export function createSongEditorState(sheet: SongSheet): SongEditorState {
  const originalText = songSheetToChordPro(sheet);
  return { originalText, text: originalText, past: [], future: [] };
}

export function setText(state: SongEditorState, text: string): SongEditorState {
  return commit(state, text);
}

/** Resets text to the original auto-generated sheet. */
export function resetText(state: SongEditorState): SongEditorState {
  if (sameText(state.text, state.originalText)) return state;
  return commit(state, state.originalText);
}

export function undo(state: SongEditorState): SongEditorState {
  if (state.past.length === 0) return state;
  const text = state.past[state.past.length - 1];
  const past = state.past.slice(0, -1);
  const future = [state.text, ...state.future];
  return { ...state, text, past, future };
}

export function redo(state: SongEditorState): SongEditorState {
  if (state.future.length === 0) return state;
  const text = state.future[0];
  const future = state.future.slice(1);
  const past = [...state.past, state.text];
  return { ...state, text, past, future };
}

export function getDerivedEditorState(state: SongEditorState, source: Pick<SongSheet, "metadata" | "chordsUsed">): SongEditorDerivedState {
  const parsed = state.text.trim() === "" ? null : chordProToSongSheet(state.text, source);
  const chordCount = parsed ? parsed.chordsUsed.length : 0;
  const lineCount = parsed ? parsed.sections.reduce((count, section) => count + section.lines.length, 0) : 0;
  return {
    dirty: !sameText(state.text, state.originalText),
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    chordCount,
    lineCount,
  };
}

export function getEditedSheet(state: SongEditorState, source: Pick<SongSheet, "metadata" | "chordsUsed">): SongSheet | null {
  if (state.text.trim() === "") return null;
  return chordProToSongSheet(state.text, source);
}

export type SongEditorApi = {
  getState: () => SongEditorState;
  setText: (text: string) => void;
  reset: () => void;
  undo: () => void;
  redo: () => void;
  getDerived: () => SongEditorDerivedState;
  getEditedSheet: () => SongSheet | null;
};

export function createSongEditor(sheet: SongSheet, seedText?: string): SongEditorApi {
  const originalText = songSheetToChordPro(sheet);
  let state: SongEditorState = {
    originalText,
    text: seedText ?? originalText,
    past: [],
    future: [],
  };
  const source = { metadata: sheet.metadata, chordsUsed: sheet.chordsUsed };
  return {
    getState: () => state,
    setText: (text) => {
      state = setText(state, text);
    },
    reset: () => {
      state = resetText(state);
    },
    undo: () => {
      state = undo(state);
    },
    redo: () => {
      state = redo(state);
    },
    getDerived: () => getDerivedEditorState(state, source),
    getEditedSheet: () => getEditedSheet(state, source),
  };
}