"use client";

import { useState } from "react";
import type { SongSheet } from "@/types/song-sheet";
import { createSongEditor, type SongEditorDerivedState } from "@/lib/song-sheet/edit-engine";
import { getBrowserStorage, readSongEditorDraft, saveSongEditorDraft, type StorageLike } from "@/lib/song-sheet/editor-store";

export type SongEditorHandle = {
  text: string;
  setText: (text: string) => void;
  reset: () => void;
  undo: () => void;
  redo: () => void;
  derived: SongEditorDerivedState;
  editedSheet: SongSheet | null;
  getStateText: () => string;
};

let cachedStorage: StorageLike | null | undefined;

function browserStorage(): StorageLike | null {
  if (cachedStorage === undefined) cachedStorage = getBrowserStorage();
  return cachedStorage ?? null;
}

function createFor(sheet: SongSheet | null) {
  if (!sheet) return null;
  return createSongEditor(sheet, readSongEditorDraft(browserStorage(), sheet.id)?.text ?? undefined);
}

/**
 * Drives the chord/lyrics correction editor for an analyzed song. Creates an
 * implicit history stack over the ChordPro text (undo/redo/reset/dirty) and
 * saves drafts to localStorage on every change, so a partially corrected sheet
 * survives a reload. The edited sheet is recomputed from the text so a preview
 * can always reflect the live correction.
 */
export function useSongEditor(sheet: SongSheet | null): SongEditorHandle | null {
  const [sheetId, setSheetId] = useState<string | null | undefined>(sheet?.id ?? undefined);
  const [editor, setEditor] = useState(() => createFor(sheet));

  if ((sheet?.id ?? undefined) !== sheetId) {
    setSheetId(sheet?.id ?? undefined);
    setEditor(createFor(sheet));
  }

  const [, setVersion] = useState(0);
  const refresh = () => setVersion((version) => version + 1);

  const mutate = <T,>(op: () => T): T | undefined => {
    if (!editor) return undefined;
    const result = op();
    const nextText = editor.getState().text;
    if (sheet) saveSongEditorDraft(browserStorage(), { sourceId: sheet.id, text: nextText, updatedAt: Date.now() });
    refresh();
    return result;
  };

  if (!editor) return null;

  return {
    text: editor.getState().text,
    setText: (text) => {
      mutate(() => editor.setText(text));
    },
    reset: () => {
      mutate(() => editor.reset());
    },
    undo: () => {
      mutate(() => editor.undo());
    },
    redo: () => {
      mutate(() => editor.redo());
    },
    derived: editor.getDerived(),
    editedSheet: editor.getEditedSheet(),
    getStateText: () => editor.getState().text,
  } satisfies SongEditorHandle;
}