import { describe, expect, it } from "vitest";
import {
  applySongEditorDraft,
  hasSongEditorDraft,
  readSongEditorDraft,
  readSongEditorDrafts,
  saveSongEditorDraft,
  SONG_EDITOR_STORAGE_KEY,
  writeSongEditorDrafts,
  type SongEditorDraft,
} from "./editor-store";
import { twinkleLittleStarSongSheet } from "@/data/twinkle-song-sheet";

function makeStorage(initial?: Record<string, string>) {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

const draft: SongEditorDraft = { sourceId: "fs1-abc", text: "[C]hello", updatedAt: 1234 };

describe("song editor draft store", () => {
  it("saves and reads a draft", () => {
    const storage = makeStorage();
    saveSongEditorDraft(storage, draft);
    expect(readSongEditorDraft(storage, "fs1-abc")).toEqual(draft);
    expect(hasSongEditorDraft(storage, "fs1-abc")).toBe(true);
    expect(hasSongEditorDraft(storage, "other")).toBe(false);
  });

  it("does not re-write when the draft is unchanged", () => {
    let writes = 0;
    const storage = {
      getItem: (key: string) => {
        if (key !== SONG_EDITOR_STORAGE_KEY) return null;
        return JSON.stringify({ version: 1, edits: [draft] });
      },
      setItem: () => {
        writes += 1;
      },
      removeItem: () => undefined,
    };
    saveSongEditorDraft(storage, { ...draft, updatedAt: 9999 });
    expect(writes).toBe(0);
  });

  it("rejects malformed payloads and returns empty lists", () => {
    const storage = makeStorage({ [SONG_EDITOR_STORAGE_KEY]: JSON.stringify({ version: 99, edits: [draft] }) });
    expect(readSongEditorDrafts(storage)).toEqual([]);
    const corrupt = makeStorage({ [SONG_EDITOR_STORAGE_KEY]: "not-json" });
    expect(readSongEditorDrafts(corrupt)).toEqual([]);
  });

  it("caps stored drafts", () => {
    const storage = makeStorage();
    for (let index = 0; index < 25; index += 1) {
      saveSongEditorDraft(storage, { sourceId: `song-${index}`, text: `[C]${index}`, updatedAt: index });
    }
    expect(readSongEditorDrafts(storage)).toHaveLength(20);
    expect(readSongEditorDraft(storage, "song-0")).toBeNull();
    expect(readSongEditorDraft(storage, "song-24")).not.toBeNull();
  });

  it("writeSongEditorDrafts persists the exact payload", () => {
    const storage = makeStorage();
    writeSongEditorDrafts(storage, [draft]);
    expect(readSongEditorDrafts(storage)).toEqual([draft]);
  });

  it("ignores a null storage", () => {
    expect(saveSongEditorDraft(null, draft)).toEqual([]);
    expect(readSongEditorDrafts(null)).toEqual([]);
    expect(hasSongEditorDraft(null, "x")).toBe(false);
  });

  it("applySongEditorDraft merges the draft text onto a sheet", () => {
    const applied = applySongEditorDraft(twinkleLittleStarSongSheet, {
      sourceId: "twinkle",
      text: "{title:Correction}\n{key:G major}\n\n{section:Demo}\n[Em]fixed",
      updatedAt: 1,
    });
    expect(applied.metadata.title).toBe("Correction");
    expect(applied.metadata.key).toBe("G major");
    expect(applied.sections[0].lines[0].segments[0]).toEqual({ chord: "Em", text: "fixed" });
  });

  it("keeps the original chords when the draft has no chords", () => {
    const applied = applySongEditorDraft(twinkleLittleStarSongSheet, { sourceId: "twinkle", text: "words only", updatedAt: 1 });
    expect(applied.chordsUsed).toEqual(["C", "F", "G"]);
  });
});