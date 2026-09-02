import type { SongSheet } from "@/types/song-sheet";
import { chordProToSongSheet } from "./chordpro";
import type { StorageLike as StorageLikeBase } from "@/features/practice/results-store";

export type StorageLike = StorageLikeBase;

export const SONG_EDITOR_STORAGE_KEY = "swarai.song-editor.v1";
const EDITOR_DATA_VERSION = 1;
const MAX_STORED_EDITS = 20;
const MAX_DIRTY_CHARS = 200_000;

type SongEditorStoragePayload = {
  version: typeof EDITOR_DATA_VERSION;
  edits: SongEditorDraft[];
};

export type SongEditorDraft = {
  sourceId: string;
  text: string;
  updatedAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDraft(value: unknown): value is SongEditorDraft {
  if (!isRecord(value)) return false;
  return (
    typeof value.sourceId === "string" &&
    value.sourceId.length > 0 &&
    value.sourceId.length <= 200 &&
    typeof value.text === "string" &&
    value.text.length <= MAX_DIRTY_CHARS &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt)
  );
}

function parsePayload(value: unknown): SongEditorDraft[] {
  if (!isRecord(value) || value.version !== EDITOR_DATA_VERSION || !Array.isArray(value.edits)) return [];
  return value.edits.filter(isDraft).slice(0, MAX_STORED_EDITS);
}

export function readSongEditorDrafts(storage: StorageLike | null): SongEditorDraft[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(SONG_EDITOR_STORAGE_KEY);
    return raw ? parsePayload(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function readSongEditorDraft(storage: StorageLike | null, sourceId: string): SongEditorDraft | null {
  return readSongEditorDrafts(storage).find((draft) => draft.sourceId === sourceId) ?? null;
}

export function writeSongEditorDrafts(storage: StorageLike | null, edits: SongEditorDraft[]): boolean {
  if (!storage) return false;
  try {
    const payload: SongEditorStoragePayload = {
      version: EDITOR_DATA_VERSION,
      edits: edits.slice(0, MAX_STORED_EDITS),
    };
    storage.setItem(SONG_EDITOR_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves an in-progress edited ChordPro text for a song. If the text matches the
 * latest saved draft, no write happens. Returns the updated list of drafts.
 */
export function saveSongEditorDraft(storage: StorageLike | null, draft: SongEditorDraft): SongEditorDraft[] {
  if (!storage) return readSongEditorDrafts(null);
  const existing = readSongEditorDrafts(storage);
  const previous = existing.find((item) => item.sourceId === draft.sourceId);
  if (previous && previous.text === draft.text) return existing;
  const rest = existing.filter((item) => item.sourceId !== draft.sourceId);
  const next = [draft, ...rest].slice(0, MAX_STORED_EDITS);
  writeSongEditorDrafts(storage, next);
  return next;
}

export function hasSongEditorDraft(storage: StorageLike | null, sourceId: string): boolean {
  return readSongEditorDraft(storage, sourceId) !== null;
}

export function getBrowserStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Applies a stored draft back onto a fresh SongSheet so the reader shows the corrected version. */
export function applySongEditorDraft(sheet: SongSheet, draft: SongEditorDraft): SongSheet {
  const parsed = chordProToSongSheet(draft.text, { metadata: sheet.metadata, chordsUsed: sheet.chordsUsed });
  return {
    ...sheet,
    id: `edited-${sheet.id}`,
    metadata: { ...sheet.metadata, title: parsed.metadata.title, key: parsed.metadata.key },
    chordsUsed: parsed.chordsUsed.length > 0 ? parsed.chordsUsed : sheet.chordsUsed,
    sections: parsed.sections,
  };
}