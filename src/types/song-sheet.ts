export type InstrumentTab = "guitar" | "ukulele" | "piano-notes";

export type FretMarker = {
  stringIndex: number; // 1-indexed from lowest pitch string to highest
  fret: number; // 0 for open, >0 for fretted, -1 for muted
  finger?: number | null; // 1=index, 2=middle, 3=ring, 4=pinky
};

export type BarreChord = {
  fret: number;
  fromString: number;
  toString: number;
  finger: number;
};

export type GuitarChordDef = {
  name: string;
  baseFret: number; // 1 = standard nut position
  frets: number[]; // 6 numbers for strings 6 down to 1 (E A D G B E): -1 = X (muted), 0 = O (open), >0 = fret
  fingers: (number | null)[];
  barres?: BarreChord[];
};

export type UkuleleChordDef = {
  name: string;
  baseFret: number;
  frets: number[]; // 4 numbers for strings 4 down to 1 (G C E A): -1 = X, 0 = O, >0 = fret
  fingers: (number | null)[];
  barres?: BarreChord[];
};

export type PianoChordDef = {
  name: string;
  root: string;
  notes: string[];
  badge: string; // e.g. "C – E – G"
  intervals: string[]; // e.g. ["Root", "Major 3rd", "Perfect 5th"]
};

export type SongLyricSegment = {
  chord?: string | null;
  text: string;
};

export type SongLine = {
  id?: string;
  segments: SongLyricSegment[];
};

export type SongSection = {
  id: string;
  title: string;
  type: "intro" | "verse" | "chorus" | "bridge" | "outro";
  lines: SongLine[];
};

export type SongMetadata = {
  title: string;
  composer: string;
  periodOrOrigin: string;
  attribution: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  key: string;
  originalKey: string;
  timeSignature: string;
  tuning: string;
  defaultCapo: number;
  description: string;
  isPublicDomain: boolean;
};

export type SongSheet = {
  id: string;
  metadata: SongMetadata;
  chordsUsed: string[];
  sections: SongSection[];
};
