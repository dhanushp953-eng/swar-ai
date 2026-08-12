// Frequency <-> MIDI note conversions and tuning-offset helpers. Pure math,
// shared by the microphone analysis loop and its tests.

import { midiNumberToNoteName } from "@/lib/midi/midi-notes";

export const A4_FREQUENCY = 440;

/** Continuous MIDI value for a frequency (e.g. C4 = 60, A4 = 69). */
export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / A4_FREQUENCY);
}

/** Exact frequency in Hz for a MIDI note number. */
export function midiToFrequency(midi: number): number {
  return A4_FREQUENCY * Math.pow(2, (midi - 69) / 12);
}

/** Cents offset of `frequency` relative to the nearest/any given MIDI note. */
export function centsFromMidi(frequency: number, midi: number): number {
  return 1200 * Math.log2(frequency / midiToFrequency(midi));
}

export type PitchNote = {
  midi: number;
  name: string;
  /** cents offset of the detected frequency from the rounded note (sharp+) */
  cents: number;
};

/** Round a frequency to the nearest MIDI note with its name and tuning offset. */
export function frequencyToNote(frequency: number): PitchNote | null {
  if (!Number.isFinite(frequency) || frequency <= 0) return null;
  const midi = Math.round(frequencyToMidi(frequency));
  if (midi < 0 || midi > 127) return null;
  return {
    midi,
    name: midiNumberToNoteName(midi),
    cents: centsFromMidi(frequency, midi),
  };
}
