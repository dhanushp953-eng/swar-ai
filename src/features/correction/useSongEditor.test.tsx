// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSongEditor } from "./useSongEditor";
import type { SongSheet } from "@/types/song-sheet";

const cleanSheet: SongSheet = {
  id: "fs1-clean",
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

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useSongEditor", () => {
  it("returns null without a sheet", () => {
    const { result } = renderHook(() => useSongEditor(null));
    expect(result.current).toBeNull();
  });

  it("tracks text edits and derived state", () => {
    const { result } = renderHook(() => useSongEditor(cleanSheet));
    expect(result.current?.derived.dirty).toBe(false);

    act(() => result.current?.setText("[Am]hello"));
    expect(result.current?.text).toBe("[Am]hello");
    expect(result.current?.derived.dirty).toBe(true);
    expect(result.current?.derived.canUndo).toBe(true);
    expect(result.current?.editedSheet?.sections[0].lines[0].segments[0].chord).toBe("Am");

    act(() => result.current?.undo());
    expect(result.current?.derived.dirty).toBe(false);

    act(() => result.current?.redo());
    expect(result.current?.derived.dirty).toBe(true);
  });

  it("persists drafts to localStorage and restores them on a fresh instance", () => {
    const first = renderHook(() => useSongEditor(cleanSheet));
    act(() => first.result.current?.setText("[Dm]persisted"));
    first.unmount();

    const second = renderHook(() => useSongEditor(cleanSheet));
    expect(second.result.current?.text).toBe("[Dm]persisted");
    expect(second.result.current?.derived.dirty).toBe(true);
  });
});