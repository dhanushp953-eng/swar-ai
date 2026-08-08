import type { PianoKey, PianoNote } from "@/types/music";

const chromatic = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const blackNotes = new Set(["C#", "D#", "F#", "G#", "A#"]);
const keyboardMap = ["z", "s", "x", "d", "c", "v", "g", "b", "h", "n", "j", "m", ",", "l", ".", ";", "/"];
export const PIANO_START_MIDI = 36;
export const PIANO_KEY_COUNT = 61;
export const PIANO_WHITE_KEY_COUNT = 36;

export function midiToNote(midi: number): PianoNote {
  const noteName = chromatic[midi % 12];
  return { name: `${noteName}${Math.floor(midi / 12) - 1}`, midi, octave: Math.floor(midi / 12) - 1, isBlack: blackNotes.has(noteName) };
}

export function createPianoNotes(startMidi = 36, count = 61): PianoNote[] {
  return Array.from({ length: count }, (_, index) => ({ ...midiToNote(startMidi + index), keyboardKey: keyboardMap[index] }));
}

export function createPianoKeys(startMidi = 36, count = 61): PianoKey[] {
  return Array.from({ length: count }, (_, index) => {
    const note = midiToNote(startMidi + index);
    return { note: note.name, midi: note.midi, octave: note.octave, isBlack: note.isBlack, keyboard: keyboardMap[index] };
  });
}

export function formatNote(note: string) { return note.replace("#", "♯"); }

export function getPianoRollPosition(midi: number) {
  const clampedMidi = Math.min(Math.max(midi, PIANO_START_MIDI), PIANO_START_MIDI + PIANO_KEY_COUNT - 1);
  const noteName = chromatic[clampedMidi % 12];
  const whiteIndex = Array.from({ length: clampedMidi - PIANO_START_MIDI + 1 }, (_, index) => chromatic[(PIANO_START_MIDI + index) % 12]).filter((name) => !blackNotes.has(name)).length - 1;
  const center = blackNotes.has(noteName) ? whiteIndex + 1 : whiteIndex + 0.5;
  return { left: (center / PIANO_WHITE_KEY_COUNT) * 100, isBlack: blackNotes.has(noteName), width: (blackNotes.has(noteName) ? 0.64 : 0.9) * (100 / PIANO_WHITE_KEY_COUNT) };
}
