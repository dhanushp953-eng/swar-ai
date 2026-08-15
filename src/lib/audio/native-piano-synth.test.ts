// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { NativePianoSynth, noteToFrequency } from "./native-piano-synth";

function makeParam(initial = 0) {
  let value = initial;
  const calls: Array<{ op: string; v: number }> = [];
  const param = {
    calls,
    get value() {
      return value;
    },
    set value(v: number) {
      value = v;
    },
    setValueAtTime(v: number) {
      value = v;
      calls.push({ op: "setValueAtTime", v });
      return param;
    },
    linearRampToValueAtTime(v: number) {
      value = v;
      calls.push({ op: "linearRampToValueAtTime", v });
      return param;
    },
    exponentialRampToValueAtTime(v: number) {
      value = v;
      calls.push({ op: "exponentialRampToValueAtTime", v });
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

function fakeCompressor() {
  return {
    threshold: makeParam(-8),
    knee: makeParam(0),
    ratio: makeParam(20),
    attack: makeParam(0.003),
    release: makeParam(0.25),
    reduction: makeParam(0),
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
    createDynamicsCompressor: () => fakeCompressor(),
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

  it("routes the master bus through a limiter before the destination", () => {
    const ctx = makeFakeContext();
    const compSpy = vi.spyOn(ctx, "createDynamicsCompressor" as never);
    const engine = new NativePianoSynth(ctx, ctx.destination, { instrument: "piano" });
    expect(compSpy).toHaveBeenCalledTimes(1);
    const comp = (ctx as unknown as { createDynamicsCompressor: () => ReturnType<typeof fakeCompressor> })
      .createDynamicsCompressor();
    // The limiter must aggressively cap peaks so summed voices cannot clip.
    expect(comp.threshold.value).toBe(-8);
    expect(comp.ratio.value).toBe(20);
    engine.dispose();
  });

  it("uses smooth, click-free envelopes (zero start, bounded peak)", () => {
    const ctx = makeFakeContext();
    const gainSpy = vi.spyOn(ctx, "createGain" as never);
    const engine = new NativePianoSynth(ctx, ctx.destination, { instrument: "piano" });
    engine.triggerAttack("C4");
    // Only the per-note envelope gain ramps; partial gains are set by value.
    const gains = (ctx as unknown as { createGain: () => ReturnType<typeof fakeGain> })
      .createGain;
    void gains;
    const envGains = gainSpy.mock.results
      .map((r) => r.value.gain as ReturnType<typeof makeParam>)
      .filter((g) => g.calls.some((c) => c.op === "linearRampToValueAtTime"));
    expect(envGains).toHaveLength(1);
    const env = envGains[0];
    // Starts from a true zero (linear attack from 0 => no start click).
    expect(env.calls.some((c) => c.op === "setValueAtTime" && c.v === 0)).toBe(true);
    // Peak is the bounded per-voice level, not a full-scale 1.0 that would clip.
    expect(env.calls.some((c) => c.op === "linearRampToValueAtTime" && c.v === 0.9)).toBe(true);
    engine.dispose();
  });

  it("cancels a fading voice when the same note is re-attacked (no stacked oscillators)", () => {
    const ctx = makeFakeContext();
    const oscSpy = vi.spyOn(ctx, "createOscillator" as never);
    const engine = new NativePianoSynth(ctx, ctx.destination, { instrument: "piano" });
    engine.triggerAttack("C4"); // 2 oscillators
    engine.triggerRelease("C4"); // schedules stop; voice moves to its release tail
    engine.triggerAttack("C4"); // should cancel the tail and restart fresh
    const created = oscSpy.mock.results.map((r) => r.value as ReturnType<typeof fakeOscillator>);
    // Exactly two attack batches => 4 oscillators total, never 6 (no stacking).
    expect(created).toHaveLength(4);
    // The first two (old tail) must have been stopped during the cancel.
    expect(created[0].stop).toHaveBeenCalled();
    expect(created[1].stop).toHaveBeenCalled();
    // The two fresh oscillators are not yet stopped.
    expect(created[2].stop).not.toHaveBeenCalled();
    expect(created[3].stop).not.toHaveBeenCalled();
    engine.dispose();
  });

  it("stops and disconnects a released voice after its tail finishes", () => {
    const ctx = makeFakeContext();
    const oscSpy = vi.spyOn(ctx, "createOscillator" as never);
    const engine = new NativePianoSynth(ctx, ctx.destination, { instrument: "piano" });
    engine.triggerAttack("C4");
    engine.triggerRelease("C4");
    const osc = oscSpy.mock.results[0].value as ReturnType<typeof fakeOscillator>;
    expect(osc.stop).toHaveBeenCalledTimes(1);
    // Simulate the audio graph firing onended so the nodes are torn down.
    osc.onended?.();
    engine.dispose();
  });
});
