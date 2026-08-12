import { describe, expect, it } from "vitest";
import { midiToFrequency } from "@/lib/pitch/notes";
import { MIC_CHANNEL, type MicPitchFrame } from "./mic-types";
import { MicNoteTracker, type MicTrackerConfig } from "./mic-note-tracker";

const CONFIG: MicTrackerConfig = {
  confidenceThreshold: 0.9,
  minLevel: 0.03,
  stabilizationFrames: 4,
  releaseFrames: 6,
  pitchToleranceCents: 40,
  minMidi: 24,
  maxMidi: 96,
};

function frame(partial: Partial<MicPitchFrame> = {}): MicPitchFrame {
  return {
    time: 0,
    level: 0.5,
    peak: 0.7,
    frequency: null,
    confidence: 1,
    midi: null,
    cents: null,
    unvoiced: false,
    belowNoise: false,
    outOfRange: false,
    ...partial,
  };
}

function tone(midi: number, partial: Partial<MicPitchFrame> = {}): MicPitchFrame {
  const frequency = midiToFrequency(midi);
  return frame({ frequency, confidence: 0.99, midi, cents: 0, ...partial });
}

const empty: MicPitchFrame = frame();

describe("MicNoteTracker", () => {
  it("emits a note-on only after stabilizationFrames consecutive frames", () => {
    const tracker = new MicNoteTracker(CONFIG);
    const events = tracker.processFrame(tone(60));
    expect(events).toEqual([]);
    tracker.processFrame(tone(60));
    tracker.processFrame(tone(60));
    const fourth = tracker.processFrame(tone(60));
    expect(fourth).toHaveLength(1);
    expect(fourth[0]).toMatchObject({ type: "noteon", noteNumber: 60, noteName: "C4", channel: MIC_CHANNEL, reason: "key" });
  });

  it("never triggers while confidence is below the threshold", () => {
    const tracker = new MicNoteTracker(CONFIG);
    for (let i = 0; i < 10; i += 1) {
      expect(tracker.processFrame(tone(60, { confidence: 0.5 }))).toEqual([]);
    }
    expect(tracker.isHolding).toBe(false);
  });

  it("never triggers on weak input below the level gate", () => {
    const tracker = new MicNoteTracker(CONFIG);
    for (let i = 0; i < 10; i += 1) {
      expect(tracker.processFrame(tone(60, { level: 0.005, peak: 0.01 }))).toEqual([]);
    }
    expect(tracker.isHolding).toBe(false);
  });

  it("treats silence/noise frames as no note and releases after a grace period", () => {
    const tracker = new MicNoteTracker(CONFIG);
    for (let i = 0; i < 4; i += 1) tracker.processFrame(tone(60));
    expect(tracker.isHolding).toBe(true);

    for (let i = 0; i < 5; i += 1) {
      expect(tracker.processFrame(empty)).toEqual([]);
    }
    expect(tracker.isHolding).toBe(true);
    const release = tracker.processFrame(empty);
    expect(release).toHaveLength(1);
    expect(release[0]).toMatchObject({ type: "noteoff", noteNumber: 60, reason: "key" });
    expect(tracker.isHolding).toBe(false);
  });

  it("ignores out-of-range notes", () => {
    const tracker = new MicNoteTracker(CONFIG);
    for (let i = 0; i < 8; i += 1) {
      expect(tracker.processFrame(tone(8))).toEqual([]);
      expect(tracker.processFrame(tone(120))).toEqual([]);
    }
    expect(tracker.isHolding).toBe(false);
  });

  it("does not emit a duplicate note-on while the same note is held", () => {
    const tracker = new MicNoteTracker(CONFIG);
    const events: Array<{ type: string; noteNumber: number }> = [];
    tracker.subscribeEvents((event) => events.push(event));
    for (let i = 0; i < 20; i += 1) tracker.processFrame(tone(60));
    const noteOns = events.filter((event) => event.type === "noteon");
    expect(noteOns).toHaveLength(1);
    expect(noteOns[0].noteNumber).toBe(60);
  });

  it("keeps the held note while the pitch wavers inside the tolerance", () => {
    const tracker = new MicNoteTracker(CONFIG);
    for (let i = 0; i < 4; i += 1) tracker.processFrame(tone(60));
    expect(tracker.isHolding).toBe(true);

    const detuned = midiToFrequency(60) + 6;
    const frames = frame({ frequency: detuned, confidence: 0.99, midi: 60, cents: 6 });
    const events = tracker.processFrame(frames);
    expect(events).toEqual([]);
    expect(tracker.isHolding).toBe(true);
    expect(tracker.getHeldNotes().has(60)).toBe(true);
  });

  it("releases the old note and triggers the new one after a pitch change", () => {
    const tracker = new MicNoteTracker(CONFIG);
    const events: Array<{ type: string; noteNumber: number }> = [];
    tracker.subscribeEvents((event) => events.push(event));
    for (let i = 0; i < 4; i += 1) tracker.processFrame(tone(60));
    for (let i = 0; i < 4; i += 1) tracker.processFrame(tone(62));

    const sequence = events.map((event) => `${event.type}:${event.noteNumber}`);
    expect(sequence).toEqual(["noteon:60", "noteoff:60", "noteon:62"]);
  });

  it("force-releases a held note on releaseAll (stuck-note prevention)", () => {
    const tracker = new MicNoteTracker(CONFIG);
    for (let i = 0; i < 4; i += 1) tracker.processFrame(tone(64));
    expect(tracker.isHolding).toBe(true);
    const released = tracker.releaseAll();
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({ type: "noteoff", noteNumber: 64, reason: "release-all" });
    expect(tracker.isHolding).toBe(false);
    expect(tracker.getHeldNotes().size).toBe(0);
  });

  it("never leaves a note held after note-off (no stuck notes)", () => {
    const tracker = new MicNoteTracker(CONFIG);
    for (let i = 0; i < 4; i += 1) tracker.processFrame(tone(60));
    for (let i = 0; i < 6; i += 1) tracker.processFrame(empty);
    expect(tracker.isHolding).toBe(false);
    expect(tracker.getHeldNotes().size).toBe(0);
    // further frames stay clean
    for (let i = 0; i < 5; i += 1) expect(tracker.processFrame(empty)).toEqual([]);
  });

  it("resets the stabilization streak when the candidate changes mid-detection", () => {
    const tracker = new MicNoteTracker(CONFIG);
    tracker.processFrame(tone(60));
    tracker.processFrame(tone(60));
    tracker.processFrame(tone(62));
    tracker.processFrame(tone(62));
    tracker.processFrame(tone(62));
    expect(tracker.isHolding).toBe(false);
    const final = tracker.processFrame(tone(62));
    expect(final[0]).toMatchObject({ type: "noteon", noteNumber: 62 });
  });
});
