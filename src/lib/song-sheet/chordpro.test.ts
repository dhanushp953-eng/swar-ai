import { describe, expect, it } from "vitest";
import { chordProToSongSheet, parseChordPro, parseChordProLine, renderChordProLine, songSheetToChordPro } from "./chordpro";
import type { SongSheet } from "@/types/song-sheet";
import { twinkleLittleStarSongSheet } from "@/data/twinkle-song-sheet";

describe("renderChordProLine", () => {
  it("renders segment chords as inline [Chord] markers", () => {
    expect(
      renderChordProLine({
        id: "l1",
        segments: [
          { chord: "C", text: "hello " },
          { chord: "G", text: "world" },
        ],
      }),
    ).toBe("[C]hello[G]world");
  });
});

describe("parseChordProLine", () => {
  it("splits chords and lyrics into segments, anchoring each chord over its text", () => {
    const line = parseChordProLine("[C]hello [G]world");
    expect(line.segments).toEqual([
      { chord: "C", text: "hello " },
      { chord: "G", text: "world" },
    ]);
  });

  it("keeps lyric-only line as a single segment", () => {
    expect(parseChordProLine("just some words").segments).toEqual([{ chord: null, text: "just some words" }]);
  });

  it("keeps leading text before the first chord as a lyric-only segment", () => {
    const line = parseChordProLine("intro [C]start");
    expect(line.segments).toEqual([{ chord: null, text: "intro" }, { chord: "C", text: "start" }]);
  });

  it("round-trips through render", () => {
    const original: SongSheet["sections"][0]["lines"][0] = {
      id: "l",
      segments: [
        { chord: "Am", text: "O " },
        { chord: null, text: "ho" },
      ],
    };
    const reparsed = parseChordProLine(renderChordProLine(original));
    expect(reparsed.segments.every((seg) => seg.text.length > 0)).toBe(true);
    expect(reparsed.segments[0].chord).toBe("Am");
  });
});

describe("parseChordPro", () => {
  it("collects key directives and splits sections on blank lines", () => {
    const { sections, directives } = parseChordPro("{title:My Song}\n{key:C}\n\n[Am]line one\n[G]line two\n\n[F]line three");
    expect(directives.map((directive) => directive.key)).toEqual(["title", "key"]);
    expect(sections).toHaveLength(2);
    expect(sections[0].lines).toHaveLength(2);
    expect(sections[1].lines).toHaveLength(1);
  });

  it("labels sections from {section} and {comment} directives", () => {
    const { sections } = parseChordPro("{comment:Verse}\n[Am]v1\n\n{comment:Chorus}\n[F]c1");
    expect(sections.map((section) => section.title)).toEqual(["Verse", "Chorus"]);
    expect(sections[0].type).toBe("verse");
  });
});

describe("songSheetToChordPro", () => {
  it("writes a title and key header then section blocks", () => {
    const text = songSheetToChordPro(twinkleLittleStarSongSheet);
    expect(text).toContain("{title:Twinkle, Twinkle, Little Star}");
    expect(text).toContain("{key:C major}");
    expect(text).toContain("[");
  });
});

describe("chordProToSongSheet", () => {
  it("rebuilds a sheet from ChordPro with merged metadata", () => {
    const source: SongSheet = {
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
      sections: [{ id: "s1", title: "Verse", type: "verse", lines: [{ id: "l1", segments: [{ chord: "C", text: "Hello " }, { chord: "G", text: "world" }] }] }],
    };
    const text = songSheetToChordPro(source);
    const rebuilt = chordProToSongSheet(text, { metadata: source.metadata, chordsUsed: source.chordsUsed });
    expect(rebuilt.metadata.title).toBe("Clean Song");
    expect(rebuilt.metadata.key).toBe("C major");
    expect(rebuilt.chordsUsed).toEqual(["C", "G"]);
    expect(rebuilt.sections.length).toBeGreaterThan(0);
  });

  it("collects chords actually present in the text", () => {
    const rebuilt = chordProToSongSheet("{title:X}\n[Am]one\n[C]two\n[C]three", {
      metadata: twinkleLittleStarSongSheet.metadata,
      chordsUsed: [],
    });
    expect(rebuilt.chordsUsed).toEqual(["Am", "C"]);
  });
});