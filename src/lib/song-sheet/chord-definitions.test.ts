import { describe, expect, it } from "vitest";
import {
  getGuitarChord,
  getPianoNotes,
  getUkuleleChord,
} from "./chord-definitions";


describe("chord-definitions", () => {
  it("provides valid guitar chord definitions for C, F, G", () => {
    const cGuitar = getGuitarChord("C");
    expect(cGuitar.frets).toEqual([-1, 3, 2, 0, 1, 0]);

    const fGuitar = getGuitarChord("F");
    expect(fGuitar.frets).toEqual([1, 3, 3, 2, 1, 1]);
    expect(fGuitar.barres?.length).toBeGreaterThan(0);

    const gGuitar = getGuitarChord("G");
    expect(gGuitar.frets).toEqual([3, 2, 0, 0, 0, 3]);
  });

  it("provides valid ukulele chord definitions for C, F, G", () => {
    const cUke = getUkuleleChord("C");
    expect(cUke.frets).toEqual([0, 0, 0, 3]);

    const fUke = getUkuleleChord("F");
    expect(fUke.frets).toEqual([2, 0, 1, 0]);

    const gUke = getUkuleleChord("G");
    expect(gUke.frets).toEqual([0, 2, 3, 2]);
  });

  it("provides static piano note badges for C, F, G without keyboard shape", () => {
    const cPiano = getPianoNotes("C");
    expect(cPiano.badge).toBe("C – E – G");
    expect(cPiano.notes).toEqual(["C", "E", "G"]);
    expect(cPiano.intervals).toContain("Root");
    expect(cPiano.intervals).toContain("Major 3rd");
    expect(cPiano.intervals).toContain("Perfect 5th");

    const fPiano = getPianoNotes("F");
    expect(fPiano.badge).toBe("F – A – C");

    const gPiano = getPianoNotes("G");
    expect(gPiano.badge).toBe("G – B – D");
  });

  it("provides fallbacks for unknown chord names", () => {
    const fallbackGuitar = getGuitarChord("UnknownChord");
    expect(fallbackGuitar.name).toBe("UnknownChord");

    const fallbackUke = getUkuleleChord("UnknownChord");
    expect(fallbackUke.name).toBe("UnknownChord");

    const fallbackPiano = getPianoNotes("UnknownChord");
    expect(fallbackPiano.name).toBe("UnknownChord");
  });
});
