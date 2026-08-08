import type { PianoKey, PianoNote } from "@/types/music";

const chromatic = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const blackNotes = new Set(["C#", "D#", "F#", "G#", "A#"]);
const keyboardMap = ["z", "s", "x", "d", "c", "v", "g", "b", "h", "n", "j", "m", ",", "l", ".", ";", "/"];

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
