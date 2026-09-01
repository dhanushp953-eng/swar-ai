const CHROMATIC_SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const CHROMATIC_FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

export function transposePitch(root: string, semitones: number, preferFlats = false): string {
  const normalizedRoot = root.trim();
  const currentSemitone = NOTE_TO_SEMITONE[normalizedRoot];
  if (currentSemitone === undefined) return root;

  const targetSemitone = ((currentSemitone + semitones) % 12 + 12) % 12;
  const scale = preferFlats ? CHROMATIC_FLATS : CHROMATIC_SHARPS;
  return scale[targetSemitone];
}

export function transposeChord(chord: string, semitones: number, preferFlats = false): string {
  if (!chord || semitones === 0) return chord;

  // Handle slash chords like C/E or G/B
  if (chord.includes("/")) {
    const [mainChord, bassNote] = chord.split("/");
    const transposedMain = transposeChord(mainChord, semitones, preferFlats);
    const transposedBass = transposePitch(bassNote, semitones, preferFlats);
    return `${transposedMain}/${transposedBass}`;
  }

  // Regex to extract root note (e.g. C, C#, Db, F#) and quality suffix (e.g. m, 7, maj7, sus4)
  const match = chord.match(/^([A-Ga-g][#b]?)(.*)$/);
  if (!match) return chord;

  const [, root, suffix] = match;
  const capitalizedRoot = root.charAt(0).toUpperCase() + root.slice(1);
  const transposedRoot = transposePitch(capitalizedRoot, semitones, preferFlats);

  return `${transposedRoot}${suffix}`;
}

export function getSoundingKey(baseKey: string, capoFret: number): string {
  if (capoFret === 0) return baseKey;

  const match = baseKey.match(/^([A-Ga-g][#b]?)(.*)$/);
  if (!match) return baseKey;

  const [, root, suffix] = match;
  const capitalizedRoot = root.charAt(0).toUpperCase() + root.slice(1);
  const soundingRoot = transposePitch(capitalizedRoot, capoFret);

  return `${soundingRoot}${suffix}`;
}

export function formatChordWithSymbols(chord: string): string {
  return chord
    .replace("#", "♯")
    .replace("b", "♭")
    .replace("maj7", "maj⁷")
    .replace("min7", "m⁷")
    .replace("m7", "m⁷")
    .replace("7", "⁷");
}
