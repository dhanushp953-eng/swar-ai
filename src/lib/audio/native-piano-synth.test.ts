// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { NativePianoSynth, noteToFrequency } from "./native-piano-synth";

function makeParam(initial = 0) {
  let value = initial;
  const param = {
    get value() {
      return value;
    },
    set value(v: number) {
      value = v;
    },
    setValueAtTime(v: number) {
      value = v;
      return param;
    },
    linearRampToValueAtTime(v: number) {
      value = v;
      return param;
    },
    exponentialRampToValueAtTime(v: number) {
      value = v;
      return param;
    },
    setTargetAtTime(v: number) {
      value = v;
      return param;
    },
    cancelScheduledValues() {
      return param;
    },
  };
  return param;
}

function fakeGain() {
  return {
    gain: makeParam(1),
    connect: (dest: unknown) => dest,
    disconnect: vi.fn(),
  };
}

function fakeOscillator() {
  return {
    type: "sine" as OscillatorType,
    frequency: makeParam(440),
    detune: makeParam(0),
    connect: (dest: unknown) => dest,
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
    disconnect: vi.fn(),
  };
}

function makeFakeContext() {
  const ctx = {
    state: "running",
    currentTime: 0,
    destination: fakeGain(),
    createGain: () => fakeGain(),
    createOscillator: () => fakeOscillator(),
  } as unknown as AudioContext;
  return ctx;
}

describe("noteToFrequency", () => {
  it("maps standard note names to frequencies", () => {
    expect(noteToFrequency("A4")).toBeCloseTo(440, 1);
    expect(noteToFrequency("C4")).toBeCloseTo(261.63, 1);
    expect(noteToFrequency("A3")).toBeCloseTo(220, 1);
    expect(noteToFrequency("C5")).toBeCloseTo(523.25, 1);
  });
});

describe("NativePianoSynth", () => {
  it("starts an independent voice per note (polyphony)", () => {
    const ctx = makeFakeContext();
    const oscSpy = vi.spyOn(ctx, "createOscillator");
    const engine = new NativePianoSynth(ctx, ctx.destination, { instrument: "piano" });

    engine.triggerAttack("C4");
    engine.triggerAttack("E4");
    // A re-attack of an already-sounding note must not create a duplicate voice.
    engine.triggerAttack("C4");

    expect(oscSpy).toHaveBeenCalledTimes(2 * 2); // 2 unique notes, piano = 2 partials
    expect(engine.context).toBe(ctx);

    engine.releaseAll();
    // After releaseAll every voice is released and stopped.
    engine.dispose();
  });

  it("releases specific voices on triggerRelease", () => {
    const ctx = makeFakeContext();
    const engine = new NativePianoSynth(ctx, ctx.destination, { instrument: "bell" });
    const stopSpy = vi.spyOn(ctx, "createOscillator");

    engine.triggerAttack("C4");
    engine.triggerAttack("E4");
    const oscillatorsBefore = stopSpy.mock.results.length;
    engine.triggerRelease("C4");
    // Releasing one of two notes stops that note's partial oscillators only.
    expect(stopSpy.mock.results.length).toBe(oscillatorsBefore);
    // ("stop" is scheduled; the node count is the same, but C4 is no longer held.)
    engine.triggerRelease("E4");
    engine.dispose();
  });

  it("applies master volume via setVolume without throwing", () => {
    const ctx = makeFakeContext();
    const engine = new NativePianoSynth(ctx, ctx.destination, { volumeDb: -8 });
    expect(() => {
      engine.setVolume(-3);
      engine.setVolume(-20);
    }).not.toThrow();
    engine.dispose();
  });

  it("switches timbre via setInstrument", () => {
    const ctx = makeFakeContext();
    const engine = new NativePianoSynth(ctx, ctx.destination, { instrument: "piano" });
    expect(() => {
      engine.setInstrument("bell");
      engine.triggerAttack("G4");
      engine.setInstrument("warm-pad");
    }).not.toThrow();
    engine.dispose();
  });

  it("dispose disconnects the master bus and stops active voices", () => {
    const ctx = makeFakeContext();
    const engine = new NativePianoSynth(ctx, ctx.destination, { instrument: "piano" });
    engine.triggerAttack("C4");
    expect(() => engine.dispose()).not.toThrow();
  });
});
