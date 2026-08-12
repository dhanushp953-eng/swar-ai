import { describe, expect, it } from "vitest";
import { MidiMessageParser, midiNumberToNoteName, normalizeVelocity } from "./midi-notes";

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe("midiNumberToNoteName", () => {
  it("converts MIDI numbers to scientific note names", () => {
    expect(midiNumberToNoteName(0)).toBe("C-1");
    expect(midiNumberToNoteName(12)).toBe("C0");
    expect(midiNumberToNoteName(60)).toBe("C4");
    expect(midiNumberToNoteName(61)).toBe("C#4");
    expect(midiNumberToNoteName(69)).toBe("A4");
    expect(midiNumberToNoteName(127)).toBe("G9");
  });

  it("clamps out-of-range numbers", () => {
    expect(midiNumberToNoteName(-12)).toBe("C-1");
    expect(midiNumberToNoteName(200)).toBe("G9");
  });
});

describe("normalizeVelocity", () => {
  it("maps 0-127 to 0-1", () => {
    expect(normalizeVelocity(0)).toBe(0);
    expect(normalizeVelocity(64)).toBeCloseTo(64 / 127);
    expect(normalizeVelocity(127)).toBe(1);
  });

  it("clamps out-of-range and non-finite values", () => {
    expect(normalizeVelocity(-10)).toBe(0);
    expect(normalizeVelocity(300)).toBe(1);
    expect(normalizeVelocity(Number.NaN)).toBe(0);
    expect(normalizeVelocity(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("MidiMessageParser", () => {
  it("parses a note-on message with channel and velocity", () => {
    const parser = new MidiMessageParser();
    expect(parser.parse(bytes(0x90, 60, 100))).toEqual({ kind: "noteon", channel: 0, noteNumber: 60, velocity: 100 });
  });

  it("parses channel number from the low nibble", () => {
    const parser = new MidiMessageParser();
    expect(parser.parse(bytes(0x91, 60, 100))).toEqual({ kind: "noteon", channel: 1, noteNumber: 60, velocity: 100 });
    expect(parser.parse(bytes(0x9f, 60, 100))).toEqual({ kind: "noteon", channel: 15, noteNumber: 60, velocity: 100 });
  });

  it("parses a note-off message", () => {
    const parser = new MidiMessageParser();
    expect(parser.parse(bytes(0x80, 60, 0))).toEqual({ kind: "noteoff", channel: 0, noteNumber: 60 });
  });

  it("keeps note-on velocity zero as a note-on (caller treats it as note-off)", () => {
    const parser = new MidiMessageParser();
    expect(parser.parse(bytes(0x90, 60, 0))).toEqual({ kind: "noteon", channel: 0, noteNumber: 60, velocity: 0 });
  });

  it("parses a control change (CC64 sustain)", () => {
    const parser = new MidiMessageParser();
    expect(parser.parse(bytes(0xb0, 64, 127))).toEqual({ kind: "cc", channel: 0, controller: 64, value: 127 });
    expect(parser.parse(bytes(0xb0, 64, 0))).toEqual({ kind: "cc", channel: 0, controller: 64, value: 0 });
  });

  it("ignores system and realtime messages without touching running status", () => {
    const parser = new MidiMessageParser();
    expect(parser.parse(bytes(0xf0, 0, 0))).toBeNull();
    expect(parser.parse(bytes(0xf8))).toBeNull();
    expect(parser.parse(bytes(0xff, 0, 0))).toBeNull();
  });

  it("ignores malformed messages: empty and truncated", () => {
    const parser = new MidiMessageParser();
    expect(parser.parse(bytes())).toBeNull();
    expect(parser.parse(bytes(0x90))).toBeNull();
    expect(parser.parse(bytes(0x80))).toBeNull();
  });

  it("ignores note numbers outside the valid range", () => {
    const parser = new MidiMessageParser();
    expect(parser.parse(bytes(0x90, 128, 100))).toBeNull();
    expect(parser.parse(bytes(0x80, 200, 0))).toBeNull();
  });

  it("ignores an unsupported channel message type (pitch bend)", () => {
    const parser = new MidiMessageParser();
    expect(parser.parse(bytes(0xe0, 0, 64))).toBeNull();
  });

  it("resolves running-status continuations", () => {
    const parser = new MidiMessageParser();
    expect(parser.parse(bytes(0x90, 60, 100))).toEqual({ kind: "noteon", channel: 0, noteNumber: 60, velocity: 100 });
    expect(parser.parse(bytes(62, 90))).toEqual({ kind: "noteon", channel: 0, noteNumber: 62, velocity: 90 });
  });

  it("rejects running-status data without a prior status byte", () => {
    const parser = new MidiMessageParser();
    expect(parser.parse(bytes(62, 90))).toBeNull();
  });

  it("resets running status", () => {
    const parser = new MidiMessageParser();
    parser.parse(bytes(0x90, 60, 100));
    parser.reset();
    expect(parser.parse(bytes(62, 90))).toBeNull();
  });
});
