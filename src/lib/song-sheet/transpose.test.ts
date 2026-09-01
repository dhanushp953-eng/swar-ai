import { describe, expect, it } from "vitest";
import {
  formatChordWithSymbols,
  getSoundingKey,
  transposeChord,
  transposePitch,
} from "./transpose";

describe("song-sheet/transpose", () => {
  describe("transposePitch", () => {
    it("shifts pitches correctly by positive and negative semitones", () => {
      expect(transposePitch("C", 0)).toBe("C");
      expect(transposePitch("C", 2)).toBe("D");
      expect(transposePitch("C", 7)).toBe("G");
      expect(transposePitch("C", -1)).toBe("B");
      expect(transposePitch("C", -2)).toBe("A#");
      expect(transposePitch("C", -2, true)).toBe("Bb");
      expect(transposePitch("F", 2)).toBe("G");
      expect(transposePitch("G", -2)).toBe("F");
    });
  });

  describe("transposeChord", () => {
    it("transposes major, minor, and 7th chords", () => {
      expect(transposeChord("C", 2)).toBe("D");
      expect(transposeChord("F", 2)).toBe("G");
      expect(transposeChord("G", 2)).toBe("A");
      expect(transposeChord("Am", 2)).toBe("Bm");
      expect(transposeChord("G7", -2)).toBe("F7");
      expect(transposeChord("Cmaj7", 1)).toBe("C#maj7");
    });

    it("handles slash chords correctly", () => {
      expect(transposeChord("C/E", 2)).toBe("D/F#");
      expect(transposeChord("G/B", -2)).toBe("F/A");
    });

    it("handles 0 semitones and invalid chords gracefully", () => {
      expect(transposeChord("C", 0)).toBe("C");
      expect(transposeChord("", 2)).toBe("");
    });
  });

  describe("getSoundingKey", () => {
    it("calculates sounding key when capo is applied", () => {
      expect(getSoundingKey("C major", 0)).toBe("C major");
      expect(getSoundingKey("C major", 2)).toBe("D major");
      expect(getSoundingKey("C major", 4)).toBe("E major");
      expect(getSoundingKey("G major", 2)).toBe("A major");
    });
  });

  describe("formatChordWithSymbols", () => {
    it("formats sharps and flats and 7ths with typographic symbols", () => {
      expect(formatChordWithSymbols("C#m7")).toBe("C♯m⁷");
      expect(formatChordWithSymbols("Bbmaj7")).toBe("B♭maj⁷");
      expect(formatChordWithSymbols("F#")).toBe("F♯");
    });
  });
});
