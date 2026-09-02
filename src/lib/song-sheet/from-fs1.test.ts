import { describe, expect, it } from "vitest";
import { fs1ResultToSongSheet } from "./from-fs1";
import type { Fs1Result } from "@/lib/fs1-api";

function makeResult(overrides: { sections?: Fs1Result["song_sheet"]["sections"]; metadata?: Record<string, unknown> } = {}): Fs1Result {
  return {
    analysis_version: "fs1.0.0",
    duration: 60,
    language: "en",
    language_confidence: 0.8,
    bpm: 120,
    beat_source: "percussive",
    lyric_words: [],
    lyric_lines: [],
    chord_events: [],
    chord_anchors: [],
    song_sheet: {
      id: "fs1-abc",
      metadata: overrides.metadata ?? {
        title: "My Song",
        composer: "Detected (unverified)",
        periodOrOrigin: "Automatic full-song detection",
        attribution: "AI-detected — verify before publication",
        difficulty: "Beginner",
        key: "C major",
        originalKey: "C major",
        timeSignature: "4/4",
        tuning: "E A D G B E",
        defaultCapo: 0,
        description: "Description",
        isPublicDomain: false,
      },
      chordsUsed: ["C", "G", "Am"],
      sections: overrides.sections ?? [
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
    },
    warnings: [],
    model_info: {
      demucs: { name: "demucs", available: true },
      whisper: { name: "whisper", available: true },
      ffmpeg: { name: "ffmpeg", available: true },
    },
    processing_time_seconds: 5,
  };
}

describe("fs1ResultToSongSheet", () => {
  it("maps metadata and de-duplicates chords", () => {
    const sheet = fs1ResultToSongSheet(makeResult());
    expect(sheet.id).toBe("fs1-abc");
    expect(sheet.metadata.title).toBe("My Song");
    expect(sheet.metadata.key).toBe("C major");
    expect(sheet.chordsUsed).toEqual(["C", "G", "Am"]);
  });

  it("maps sections and preserves chord anchors and text", () => {
    const sheet = fs1ResultToSongSheet(makeResult());
    expect(sheet.sections).toHaveLength(1);
    expect(sheet.sections[0].title).toBe("Verse");
    expect(sheet.sections[0].lines[0].segments).toEqual([
      { chord: "C", text: "Hello " },
      { chord: "G", text: "world" },
    ]);
  });

  it("flattens duplicate chords in chordsUsed", () => {
    const result = makeResult();
    result.song_sheet.chordsUsed = ["C", "C", "G", "Am", "C"];
    const sheet = fs1ResultToSongSheet(result);
    expect(sheet.chordsUsed).toEqual(["C", "G", "Am"]);
  });

  it("falls back gracefully for missing metadata and coerces difficulty", () => {
    const result = makeResult({ metadata: { difficulty: "Advanced" } });
    const sheet = fs1ResultToSongSheet(result);
    expect(sheet.metadata.title).toBe("Untitled song");
    expect(sheet.metadata.difficulty).toBe("Advanced");
    expect(sheet.metadata.key).toBe("C major");
    expect(sheet.metadata.isPublicDomain).toBe(false);
  });

  it("accepts sections without line ids", () => {
    const result = makeResult({
      sections: [
        {
          id: "s1",
          title: "Chorus",
          type: "chorus",
          lines: [{ id: undefined, segments: [{ chord: null, text: "la la" }] }],
        },
      ],
    });
    const sheet = fs1ResultToSongSheet(result);
    expect(sheet.sections[0].lines[0].id).toBeUndefined();
    expect(sheet.sections[0].lines[0].segments[0].chord).toBeNull();
  });
});