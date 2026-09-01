// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { SongSheet } from "@/types/song-sheet";
import { twinkleLittleStarSongSheet } from "@/data/twinkle-song-sheet";
import {
  SheetExchangeError,
  exportSongSheetChordPro,
  exportSongSheetJson,
  isChordSymbol,
  parseChordProSheet,
  parseSongSheetJson,
  readSheetImportFile,
  sanitizeSongSheetFilename,
  songSheetToJson,
} from "./sheet-exchange";

type DownloadFn = (fileName: string, content: string, mimeType: string) => void;

function makeDownloadMock() {
  return vi.fn<DownloadFn>();
}

describe("isChordSymbol", () => {
  it("accepts common chord symbols", () => {
    for (const chord of ["C", "Am", "Bb", "F#m7b5", "G7", "Csus4", "Dmaj7", "C/G", "Em7/B", "Gb", "A#m", "E7#9", "N", "NC", "B°"]) {
      expect(isChordSymbol(chord), chord).toBe(true);
    }
  });

  it("rejects unsafe or malformed symbols", () => {
    for (const chord of ["", " ", "H", "C/D/E", "C/", "/G", "C<>", "C<", "C&#x27;", "C<script>", "a".repeat(40)]) {
      expect(isChordSymbol(chord), chord).toBe(false);
    }
  });

  it("accepts extended alteration suffixes", () => {
    expect(isChordSymbol("C#m7b5")).toBe(true);
    expect(isChordSymbol("E7#9")).toBe(true);
    expect(isChordSymbol("C/G")).toBe(true);
  });

  it("rejects HTML fragments and control characters", () => {
    expect(isChordSymbol("<img")).toBe(false);
    expect(isChordSymbol("C\u0000")).toBe(false);
  });
});

describe("sanitizeSongSheetFilename", () => {
  it("strips path separators and reserved characters, replacing them with spaces", () => {
    expect(sanitizeSongSheetFilename('a/b\\c:d*e?f"g<h>i|j', "json")).toBe("a b c d e f g h i j.json");
  });

  it("collapses whitespace and keeps letters and digits", () => {
    expect(sanitizeSongSheetFilename("  My   Great Song  ", "cho")).toBe("My Great Song.cho");
  });

  it("replaces leading dots and strips trailing extension", () => {
    expect(sanitizeSongSheetFilename("..hidden song.json", "txt")).toBe("hidden song.txt");
  });

  it("falls back when the title has no usable characters", () => {
    expect(sanitizeSongSheetFilename("", "json")).toBe("song-sheet.json");
    expect(sanitizeSongSheetFilename("...", "cho")).toBe("song-sheet.cho");
  });

  it("caps length and never returns a path-like name", () => {
    const long = "x".repeat(500);
    const fileName = sanitizeSongSheetFilename(long, "json");
    expect(fileName).not.toContain("/");
    expect(fileName).not.toContain("\\");
    expect(fileName.length).toBeLessThanOrEqual(85);
  });
});

describe("json round-trip", () => {
  it("preserves every field through export and re-import", () => {
    const json = songSheetToJson(twinkleLittleStarSongSheet);
    const rebuilt = parseSongSheetJson(json);
    expect(rebuilt).toEqual(twinkleLittleStarSongSheet);
  });
});

describe("parseSongSheetJson validation", () => {
  it("rejects non-JSON text", () => {
    expect(() => parseSongSheetJson("not json at all")).toThrowError(SheetExchangeError);
  });

  it("rejects an oversized document", () => {
    const big = JSON.stringify({ id: "x", metadata: dummyMetadata(), chordsUsed: [], sections: [] }) + " ".repeat(300 * 1024);
    expect(() => parseSongSheetJson(big)).toThrowError(/too large/i);
  });

  it("rejects missing required fields", () => {
    expect(() => parseSongSheetJson('{"id":"x"}')).toThrowError(/missing required fields/i);
  });

  it("rejects malformed metadata", () => {
    const sheet = withMetadata({ difficulty: "Expert" as unknown as SongSheet["metadata"]["difficulty"] });
    expect(() => parseSongSheetJson(songSheetToJson(sheet))).toThrowError(/difficulty/i);
  });

  it("rejects an invalid chord symbol in chordsUsed", () => {
    const sheet = withChords(["C", "<script>"]);
    expect(() => parseSongSheetJson(songSheetToJson(sheet))).toThrowError(/unrecognised chord/i);
  });

  it("rejects a line with an invalid segment chord", () => {
    const sheet = withSegment({ chord: "Haddock", text: "hi" });
    expect(() => parseSongSheetJson(songSheetToJson(sheet))).toThrowError(/unrecognised chord symbol/i);
  });

  it("rejects HTML fragments in lyric text", () => {
    const sheet = withSegment({ chord: null, text: "<b>bold</b>" });
    expect(() => parseSongSheetJson(songSheetToJson(sheet))).toThrowError(/text/i);
  });

  it("rejects control characters in lyric text", () => {
    const sheet = withSegment({ chord: null, text: "bad\u0007char" });
    expect(() => parseSongSheetJson(songSheetToJson(sheet))).toThrowError(/text/i);
  });
});

describe("sortable chord dedup", () => {
  it("deduplicates repeated chords in chordsUsed", () => {
    const sheet = withChords(["C", "C", "G", "G", "Am"]);
    const rebuilt = parseSongSheetJson(songSheetToJson(sheet));
    expect(rebuilt.chordsUsed).toEqual(["C", "G", "Am"]);
  });
});

describe("ChordPro import", () => {
  it("parses chords and lyrics from ChordPro text", () => {
    const sheet = parseChordProSheet("{title:Twinkle, Twinkle, Little Star}\n{key:C}\n\n{section:Verse}\n[C]Twinkle, [F]twinkle, [C]little [G]star");
    expect(sheet.metadata.title).toBe("Twinkle, Twinkle, Little Star");
    expect(sheet.metadata.key).toBe("C");
    expect(sheet.chordsUsed).toEqual(["C", "F", "G"]);
    expect(sheet.sections).toHaveLength(1);
  });

  it("uses fallback metadata when no directives are present", () => {
    const sheet = parseChordProSheet("[C]hi [G]there", {
      metadata: twinkleLittleStarSongSheet.metadata,
      chordsUsed: [],
    });
    expect(sheet.metadata.title).toBe("Twinkle, Twinkle, Little Star");
  });

  it("rejects an invalid chord symbol", () => {
    expect(() => parseChordProSheet("[Haddock]hi")).toThrowError(/unrecognised chord symbol/i);
  });

  it("rejects oversized ChordPro text", () => {
    const big = "[C]x\n".repeat(150 * 1024);
    expect(() => parseChordProSheet(big)).toThrowError(/too large/i);
  });

  it("rejects unsafe lyric text with HTML fragments", () => {
    expect(() => parseChordProSheet("[C]<script>alert(1)</script>")).toThrowError(/unsafe/i);
  });

  it("strips a leading BOM before parsing", () => {
    const sheet = parseChordProSheet("\uFEFF[C]hi [G]there");
    expect(sheet.sections).toHaveLength(1);
  });
});

describe("export helpers", () => {
  it("exports JSON through the injected downloader", () => {
    const download = makeDownloadMock();
    const fileName = exportSongSheetJson(twinkleLittleStarSongSheet, download);
    expect(fileName).toBe("Twinkle- Twinkle- Little Star.json");
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][1]).toContain('"title": "Twinkle, Twinkle, Little Star"');
  });

  it("exports ChordPro through the injected downloader", () => {
    const download = makeDownloadMock();
    const fileName = exportSongSheetChordPro(twinkleLittleStarSongSheet, download);
    expect(fileName).toBe("Twinkle- Twinkle- Little Star.cho");
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][1]).toContain("{title:Twinkle, Twinkle, Little Star}");
  });
});

describe("readSheetImportFile", () => {
  function fakeFile(content: string): File {
    const bytes = new TextEncoder().encode(content);
    return new File([bytes], "import.json", { type: "application/json" });
  }

  it("reads the file text", async () => {
    const file = fakeFile("{title:hi}");
    await expect(readSheetImportFile(file)).resolves.toBe("{title:hi}");
  });

  it("rejects a null file", async () => {
    await expect(readSheetImportFile(null)).rejects.toThrowError(/choose a file/i);
  });

  it("rejects an oversized file", async () => {
    const file = new File(["a".repeat(1000)], "big.json");
    await expect(readSheetImportFile(file, 500)).rejects.toThrowError(/larger than/i);
  });

  it("rejects an empty file", async () => {
    const file = new File([], "empty.json");
    await expect(readSheetImportFile(file)).rejects.toThrowError(/empty/i);
  });
});

function dummyMetadata(): SongSheet["metadata"] {
  return twinkleLittleStarSongSheet.metadata;
}

function withMetadata(overrides: Partial<SongSheet["metadata"]>): SongSheet {
  return { ...twinkleLittleStarSongSheet, metadata: { ...twinkleLittleStarSongSheet.metadata, ...overrides } };
}

function withChords(chords: string[]): SongSheet {
  return { ...twinkleLittleStarSongSheet, chordsUsed: chords };
}

function withSegment(segment: { chord: string | null; text: string }): SongSheet {
  const sections = twinkleLittleStarSongSheet.sections.map((section) => ({
    ...section,
    lines: section.lines.map((line) => ({ ...line, segments: [segment] })),
  }));
  return { ...twinkleLittleStarSongSheet, sections };
}
