import type { GuitarChordDef, PianoChordDef, UkuleleChordDef } from "@/types/song-sheet";

export const GUITAR_CHORD_LIBRARY: Record<string, GuitarChordDef> = {
  C: {
    name: "C",
    baseFret: 1,
    frets: [-1, 3, 2, 0, 1, 0], // E A D G B E
    fingers: [null, 3, 2, null, 1, null],
  },
  F: {
    name: "F",
    baseFret: 1,
    frets: [1, 3, 3, 2, 1, 1],
    fingers: [1, 3, 4, 2, 1, 1],
    barres: [{ fret: 1, fromString: 6, toString: 1, finger: 1 }],
  },
  G: {
    name: "G",
    baseFret: 1,
    frets: [3, 2, 0, 0, 0, 3],
    fingers: [2, 1, null, null, null, 3],
  },
  D: {
    name: "D",
    baseFret: 1,
    frets: [-1, -1, 0, 2, 3, 2],
    fingers: [null, null, null, 1, 3, 2],
  },
  A: {
    name: "A",
    baseFret: 1,
    frets: [-1, 0, 2, 2, 2, 0],
    fingers: [null, null, 1, 2, 3, null],
  },
  E: {
    name: "E",
    baseFret: 1,
    frets: [0, 2, 2, 1, 0, 0],
    fingers: [null, 2, 3, 1, null, null],
  },
  Am: {
    name: "Am",
    baseFret: 1,
    frets: [-1, 0, 2, 2, 1, 0],
    fingers: [null, null, 2, 3, 1, null],
  },
  Dm: {
    name: "Dm",
    baseFret: 1,
    frets: [-1, -1, 0, 2, 3, 1],
    fingers: [null, null, null, 2, 3, 1],
  },
  Em: {
    name: "Em",
    baseFret: 1,
    frets: [0, 2, 2, 0, 0, 0],
    fingers: [null, 2, 3, null, null, null],
  },
  Bb: {
    name: "Bb",
    baseFret: 1,
    frets: [-1, 1, 3, 3, 3, 1],
    fingers: [null, 1, 2, 3, 4, 1],
    barres: [{ fret: 1, fromString: 5, toString: 1, finger: 1 }],
  },
  B: {
    name: "B",
    baseFret: 2,
    frets: [-1, 2, 4, 4, 4, 2],
    fingers: [null, 1, 2, 3, 4, 1],
    barres: [{ fret: 2, fromString: 5, toString: 1, finger: 1 }],
  },
  "C#": {
    name: "C#",
    baseFret: 4,
    frets: [-1, 4, 6, 6, 6, 4],
    fingers: [null, 1, 2, 3, 4, 1],
    barres: [{ fret: 4, fromString: 5, toString: 1, finger: 1 }],
  },
  Db: {
    name: "Db",
    baseFret: 4,
    frets: [-1, 4, 6, 6, 6, 4],
    fingers: [null, 1, 2, 3, 4, 1],
    barres: [{ fret: 4, fromString: 5, toString: 1, finger: 1 }],
  },
  "D#": {
    name: "D#",
    baseFret: 6,
    frets: [-1, 6, 8, 8, 8, 6],
    fingers: [null, 1, 2, 3, 4, 1],
    barres: [{ fret: 6, fromString: 5, toString: 1, finger: 1 }],
  },
  Eb: {
    name: "Eb",
    baseFret: 6,
    frets: [-1, 6, 8, 8, 8, 6],
    fingers: [null, 1, 2, 3, 4, 1],
    barres: [{ fret: 6, fromString: 5, toString: 1, finger: 1 }],
  },
  "F#": {
    name: "F#",
    baseFret: 2,
    frets: [2, 4, 4, 3, 2, 2],
    fingers: [1, 3, 4, 2, 1, 1],
    barres: [{ fret: 2, fromString: 6, toString: 1, finger: 1 }],
  },
  Gb: {
    name: "Gb",
    baseFret: 2,
    frets: [2, 4, 4, 3, 2, 2],
    fingers: [1, 3, 4, 2, 1, 1],
    barres: [{ fret: 2, fromString: 6, toString: 1, finger: 1 }],
  },
  "G#": {
    name: "G#",
    baseFret: 4,
    frets: [4, 6, 6, 5, 4, 4],
    fingers: [1, 3, 4, 2, 1, 1],
    barres: [{ fret: 4, fromString: 6, toString: 1, finger: 1 }],
  },
  Ab: {
    name: "Ab",
    baseFret: 4,
    frets: [4, 6, 6, 5, 4, 4],
    fingers: [1, 3, 4, 2, 1, 1],
    barres: [{ fret: 4, fromString: 6, toString: 1, finger: 1 }],
  },
};

export const UKULELE_CHORD_LIBRARY: Record<string, UkuleleChordDef> = {
  C: {
    name: "C",
    baseFret: 1,
    frets: [0, 0, 0, 3], // G C E A
    fingers: [null, null, null, 3],
  },
  F: {
    name: "F",
    baseFret: 1,
    frets: [2, 0, 1, 0],
    fingers: [2, null, 1, null],
  },
  G: {
    name: "G",
    baseFret: 1,
    frets: [0, 2, 3, 2],
    fingers: [null, 1, 3, 2],
  },
  D: {
    name: "D",
    baseFret: 1,
    frets: [2, 2, 2, 0],
    fingers: [1, 2, 3, null],
  },
  A: {
    name: "A",
    baseFret: 1,
    frets: [2, 1, 0, 0],
    fingers: [2, 1, null, null],
  },
  E: {
    name: "E",
    baseFret: 1,
    frets: [4, 4, 4, 2],
    fingers: [2, 3, 4, 1],
  },
  Am: {
    name: "Am",
    baseFret: 1,
    frets: [2, 0, 0, 0],
    fingers: [2, null, null, null],
  },
  Dm: {
    name: "Dm",
    baseFret: 1,
    frets: [2, 2, 1, 0],
    fingers: [2, 3, 1, null],
  },
  Em: {
    name: "Em",
    baseFret: 1,
    frets: [0, 4, 3, 2],
    fingers: [null, 3, 2, 1],
  },
  Bb: {
    name: "Bb",
    baseFret: 1,
    frets: [3, 2, 1, 1],
    fingers: [3, 2, 1, 1],
    barres: [{ fret: 1, fromString: 2, toString: 1, finger: 1 }],
  },
  B: {
    name: "B",
    baseFret: 2,
    frets: [4, 3, 2, 2],
    fingers: [3, 2, 1, 1],
    barres: [{ fret: 2, fromString: 2, toString: 1, finger: 1 }],
  },
  "C#": {
    name: "C#",
    baseFret: 1,
    frets: [1, 1, 1, 4],
    fingers: [1, 1, 1, 4],
    barres: [{ fret: 1, fromString: 4, toString: 2, finger: 1 }],
  },
  Db: {
    name: "Db",
    baseFret: 1,
    frets: [1, 1, 1, 4],
    fingers: [1, 1, 1, 4],
    barres: [{ fret: 1, fromString: 4, toString: 2, finger: 1 }],
  },
  "D#": {
    name: "D#",
    baseFret: 3,
    frets: [3, 3, 3, 6],
    fingers: [1, 1, 1, 4],
    barres: [{ fret: 3, fromString: 4, toString: 2, finger: 1 }],
  },
  Eb: {
    name: "Eb",
    baseFret: 1,
    frets: [3, 3, 3, 1],
    fingers: [2, 3, 4, 1],
  },
  "F#": {
    name: "F#",
    baseFret: 1,
    frets: [3, 1, 2, 1],
    fingers: [3, 1, 2, 1],
  },
  Gb: {
    name: "Gb",
    baseFret: 1,
    frets: [3, 1, 2, 1],
    fingers: [3, 1, 2, 1],
  },
  "G#": {
    name: "G#",
    baseFret: 1,
    frets: [5, 3, 4, 3],
    fingers: [4, 1, 2, 1],
  },
  Ab: {
    name: "Ab",
    baseFret: 1,
    frets: [5, 3, 4, 3],
    fingers: [4, 1, 2, 1],
  },
};

export const PIANO_NOTE_LIBRARY: Record<string, PianoChordDef> = {
  C: {
    name: "C",
    root: "C",
    notes: ["C", "E", "G"],
    badge: "C – E – G",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  F: {
    name: "F",
    root: "F",
    notes: ["F", "A", "C"],
    badge: "F – A – C",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  G: {
    name: "G",
    root: "G",
    notes: ["G", "B", "D"],
    badge: "G – B – D",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  D: {
    name: "D",
    root: "D",
    notes: ["D", "F#", "A"],
    badge: "D – F♯ – A",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  A: {
    name: "A",
    root: "A",
    notes: ["A", "C#", "E"],
    badge: "A – C♯ – E",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  E: {
    name: "E",
    root: "E",
    notes: ["E", "G#", "B"],
    badge: "E – G♯ – B",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  Am: {
    name: "Am",
    root: "A",
    notes: ["A", "C", "E"],
    badge: "A – C – E",
    intervals: ["Root", "Minor 3rd", "Perfect 5th"],
  },
  Dm: {
    name: "Dm",
    root: "D",
    notes: ["D", "F", "A"],
    badge: "D – F – A",
    intervals: ["Root", "Minor 3rd", "Perfect 5th"],
  },
  Em: {
    name: "Em",
    root: "E",
    notes: ["E", "G", "B"],
    badge: "E – G – B",
    intervals: ["Root", "Minor 3rd", "Perfect 5th"],
  },
  Bb: {
    name: "Bb",
    root: "Bb",
    notes: ["Bb", "D", "F"],
    badge: "B♭ – D – F",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  B: {
    name: "B",
    root: "B",
    notes: ["B", "D#", "F#"],
    badge: "B – D♯ – F♯",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  "C#": {
    name: "C#",
    root: "C#",
    notes: ["C#", "E#", "G#"],
    badge: "C♯ – F – G♯",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  Db: {
    name: "Db",
    root: "Db",
    notes: ["Db", "F", "Ab"],
    badge: "D♭ – F – A♭",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  "D#": {
    name: "D#",
    root: "D#",
    notes: ["D#", "G", "A#"],
    badge: "D♯ – G – A♯",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  Eb: {
    name: "Eb",
    root: "Eb",
    notes: ["Eb", "G", "Bb"],
    badge: "E♭ – G – B♭",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  "F#": {
    name: "F#",
    root: "F#",
    notes: ["F#", "A#", "C#"],
    badge: "F♯ – A♯ – C♯",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  Gb: {
    name: "Gb",
    root: "Gb",
    notes: ["Gb", "Bb", "Db"],
    badge: "G♭ – B♭ – D♭",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  "G#": {
    name: "G#",
    root: "G#",
    notes: ["G#", "C", "D#"],
    badge: "G♯ – C – D♯",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
  Ab: {
    name: "Ab",
    root: "Ab",
    notes: ["Ab", "C", "Eb"],
    badge: "A♭ – C – E♭",
    intervals: ["Root", "Major 3rd", "Perfect 5th"],
  },
};

export function getGuitarChord(name: string): GuitarChordDef {
  return (
    GUITAR_CHORD_LIBRARY[name] || {
      name,
      baseFret: 1,
      frets: [-1, -1, -1, -1, -1, -1],
      fingers: [null, null, null, null, null, null],
    }
  );
}

export function getUkuleleChord(name: string): UkuleleChordDef {
  return (
    UKULELE_CHORD_LIBRARY[name] || {
      name,
      baseFret: 1,
      frets: [0, 0, 0, 0],
      fingers: [null, null, null, null],
    }
  );
}

export function getPianoNotes(name: string): PianoChordDef {
  return (
    PIANO_NOTE_LIBRARY[name] || {
      name,
      root: name,
      notes: [name],
      badge: `${name} triad`,
      intervals: ["Root", "3rd", "5th"],
    }
  );
}
