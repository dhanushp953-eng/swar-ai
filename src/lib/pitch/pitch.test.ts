import { describe, expect, it } from "vitest";
import { detectPitch } from "./yin";
import { centsFromMidi, frequencyToMidi, frequencyToNote, midiToFrequency } from "./notes";

const SAMPLE_RATE = 44100;

/** Deterministic 32-bit PRNG (mulberry32) so noise tests never flake. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sine with a whole number of periods in the buffer for a clean YIN result. */
function makeTone(frequency: number, periods: number): Float32Array {
  const size = Math.round((periods * SAMPLE_RATE) / frequency);
  const buffer = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    buffer[i] = Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
  }
  return buffer;
}

function makeSilence(size: number): Float32Array {
  return new Float32Array(size);
}

function makeNoise(seed: number, size: number, amplitude = 1): Float32Array {
  const random = mulberry32(seed);
  const buffer = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    buffer[i] = (random() * 2 - 1) * amplitude;
  }
  return buffer;
}

const EXPECTED: Array<{ name: string; frequency: number; midi: number }> = [
  { name: "C4", frequency: 261.6256, midi: 60 },
  { name: "D4", frequency: 293.6648, midi: 62 },
  { name: "E4", frequency: 329.6276, midi: 64 },
  { name: "G4", frequency: 392.0, midi: 67 },
  { name: "A4", frequency: 440.0, midi: 69 },
];

describe("detectPitch (YIN)", () => {
  it.each(EXPECTED)("detects a synthetic $name tone within one semitone", ({ name, frequency }) => {
    const result = detectPitch(makeTone(frequency, 8), SAMPLE_RATE);
    expect(result).not.toBeNull();
    const detectedMidi = frequencyToMidi(result!.frequency);
    expect(detectedMidi).toBeGreaterThan(midiOf(name) - 1);
    expect(detectedMidi).toBeLessThan(midiOf(name) + 1);
    expect(Math.round(detectedMidi)).toBe(EXPECTED.find((e) => e.name === name)!.midi);
    expect(result!.confidence).toBeGreaterThan(0.9);
  });

  it("tracks a detuned A4 within a semitone and reports the tuning offset", () => {
    const result = detectPitch(makeTone(446, 8), SAMPLE_RATE)!;
    expect(result).not.toBeNull();
    expect(Math.round(frequencyToMidi(result.frequency))).toBe(69);
    expect(result.confidence).toBeGreaterThan(0.9);
    const cents = centsFromMidi(result.frequency, 69);
    expect(cents).toBeGreaterThan(15);
    expect(cents).toBeLessThan(30);
  });

  it("returns null for pure silence", () => {
    expect(detectPitch(makeSilence(2048), SAMPLE_RATE)).toBeNull();
  });

  it("returns null or very low confidence for broadband noise", () => {
    for (const seed of [1, 7, 42, 1337]) {
      const result = detectPitch(makeNoise(seed, 2048), SAMPLE_RATE);
      if (result !== null) {
        expect(result.confidence).toBeLessThan(0.9);
      }
    }
  });

  it("returns null for a buffer that is too short", () => {
    expect(detectPitch(new Float32Array(8), SAMPLE_RATE)).toBeNull();
  });

  it("returns null for a zero sample rate", () => {
    expect(detectPitch(makeTone(440, 8), 0)).toBeNull();
  });

  it("does not report a fundamental below the configured minimum frequency", () => {
    const result = detectPitch(makeTone(30, 8), SAMPLE_RATE, { minFrequency: 65 });
    if (result !== null) {
      expect(result.frequency).toBeLessThan(65);
      expect(result.confidence).toBeLessThan(0.9);
    }
  });
});

function midiOf(name: string): number {
  return EXPECTED.find((e) => e.name === name)!.midi;
}

describe("frequency <-> MIDI note conversion", () => {
  it.each(EXPECTED)("maps $name ($frequency Hz) to midi $midi", ({ name, frequency, midi }) => {
    expect(frequencyToMidi(frequency)).toBeCloseTo(midi, 1);
    expect(frequencyToNote(frequency)?.name).toBe(name);
    expect(frequencyToNote(frequency)?.midi).toBe(midi);
  });

  it("round-trips midi -> frequency -> midi", () => {
    for (let midi = 24; midi <= 96; midi += 3) {
      expect(frequencyToMidi(midiToFrequency(midi))).toBeCloseTo(midi, 3);
    }
  });

  it("reports near-zero cents for a perfectly tuned note", () => {
    expect(centsFromMidi(440, 69)).toBeCloseTo(0, 3);
  });

  it("rejects invalid frequencies", () => {
    expect(frequencyToNote(0)).toBeNull();
    expect(frequencyToNote(Number.NaN)).toBeNull();
    expect(frequencyToNote(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
