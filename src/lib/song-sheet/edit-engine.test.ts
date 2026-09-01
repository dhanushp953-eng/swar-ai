import { describe, expect, it } from "vitest";
import { createSongEditor, getDerivedEditorState } from "./edit-engine";
import type { SongSheet } from "@/types/song-sheet";

const cleanSheet: SongSheet = {
  id: "clean-1",
  metadata: {
    title: "Clean Song",
    composer: "Detected",
    periodOrOrigin: "Full-song analysis",
    attribution: "AI-detected — verify before publication",
    difficulty: "Beginner",
    key: "C major",
    originalKey: "C major",
    timeSignature: "4/4",
    tuning: "E A D G B E",
    defaultCapo: 0,
    description: "Plain lyrics.",
    isPublicDomain: false,
  },
  chordsUsed: ["C", "G", "Am"],
  sections: [
    {
      id: "s1",
      title: "Verse",
      type: "verse",
      lines: [
        {
          id: "l1",
          segments: [
            { chord: "C", text: "Hello " },
            { chord: "G", text: "world" },
          ],
        },
      ],
    },
  ],
};

function makeEditor() {
  return createSongEditor(cleanSheet);
}

describe("song editor engine", () => {
  it("starts clean with the serialized sheet", () => {
    const editor = makeEditor();
    const derived = editor.getDerived();
    expect(derived.dirty).toBe(false);
    expect(derived.canUndo).toBe(false);
    expect(editor.getState().text).toContain("{title:Clean Song}");
    expect(editor.getState().text).toContain("{section:Verse}");
    expect(editor.getState().text).toContain("[C]Hello[G]world");
  });

  it("tracks dirty state and undo/redo history", () => {
    const editor = makeEditor();
    editor.setText("[C]Twinkle, [F]Twinkle");
    expect(editor.getDerived().dirty).toBe(true);
    expect(editor.getDerived().canUndo).toBe(true);
    expect(editor.getDerived().canRedo).toBe(false);
    editor.undo();
    const undone = editor.getDerived();
    expect(undone.dirty).toBe(false);
    expect(undone.canRedo).toBe(true);
    editor.redo();
    expect(editor.getDerived().dirty).toBe(true);
  });

  it("reset restores the original sheet text", () => {
    const editor = makeEditor();
    const original = editor.getState().text;
    editor.setText("[Am]changed");
    editor.reset();
    expect(editor.getState().text).toBe(original);
    expect(editor.getDerived().dirty).toBe(false);
  });

  it("reports chord and line counts from the current text", () => {
    const editor = makeEditor();
    editor.setText("{title:X}\n{key:C}\n\n{section:Verse}\n[C]one\n[G]two\n\n{section:Chorus}\n[Am]three");
    const derived = editor.getDerived();
    expect(derived.chordCount).toBe(3);
    expect(derived.lineCount).toBe(3);
  });

  it("produces an editable sheet preview from the text", () => {
    const editor = makeEditor();
    editor.setText("{title:Changed Title}\n{key:D major}\n\n{section:Verse}\n[Em]hello");
    const sheet = editor.getEditedSheet();
    expect(sheet?.metadata.title).toBe("Changed Title");
    expect(sheet?.metadata.key).toBe("D major");
    expect(sheet?.sections[0].title).toBe("Verse");
    expect(sheet?.sections[0].lines[0].segments[0]).toEqual({ chord: "Em", text: "hello" });
  });

  it("returns a null sheet for empty text", () => {
    const editor = makeEditor();
    editor.setText("");
    expect(editor.getEditedSheet()).toBeNull();
    expect(editor.getDerived().chordCount).toBe(0);
  });

  it("getDerivedEditorState is pure over a state object", () => {
    const state = createSongEditor(cleanSheet).getState();
    const derived = getDerivedEditorState(state, cleanSheet);
    expect(derived.dirty).toBe(false);
    expect(derived.chordCount).toBeGreaterThan(0);
    expect(derived.lineCount).toBeGreaterThan(0);
  });
});