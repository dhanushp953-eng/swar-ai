// A small, dependency-free polyphonic piano synth built directly on the Web
// Audio API. It deliberately avoids Tone.js: the Tone output chain
// (Tone.Destination -> hardware) was going silent after ~1 minute of mobile
// inactivity even though the underlying AudioContext stayed healthy. Routing
// native oscillator nodes straight into the raw AudioContext.destination is the
// path the native audio diagnostic proved reliable on both laptop and mobile.
//
// The voice *lifecycle* (polyphony, sustain, release-all, stuck-note races) is
// owned by the Tone-free PianoVoiceController, which drives this engine through
// the PianoVoiceSynthLike interface (triggerAttack / triggerRelease / releaseAll).
//
// Signal chain (per voice -> master):
//   oscillators -> partialGain -> envelope(env) -> master(volume) -> limiter
//     (DynamicsCompressor, brick-wall-ish) -> out(trim) -> destination
// The limiter is what keeps 16 simultaneous voices from summing into hard
// clipping (the "gurr"/crackle) on laptop and mobile speakers.

import type { PianoVoiceSynthLike } from "./piano-voices";

/** Note-name -> frequency in Hz. Supports sharps/flats, e.g. "C4", "F#3". */
export function noteToFrequency(note: string): number {
  const NOTE_INDEX: Record<string, number> = {
    C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
    "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
  };
  const match = /^([A-Ga-g][#b]?)(\d)$/.exec(note.trim());
  if (!match) return 440;
  const semitone = NOTE_INDEX[match[1]] ?? 0;
  const octave = Number.parseInt(match[2], 10);
  const midi = (octave + 1) * 12 + semitone; // C4 -> 60, A4 -> 69
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

interface PartialSpec {
  /** Harmonic ratio relative to the played note's fundamental. */
  ratio: number;
  type: OscillatorType;
  /** Relative level of this partial (0..1). */
  gain?: number;
  detune?: number;
}

interface Timbre {
  partials: PartialSpec[];
  attack: number;
  decay: number;
  /** Sustained level (0..1) after the decay stage. */
  sustain: number;
  release: number;
}

// Below this gain a voice is effectively silent; used as the floor for
// exponential ramps (which cannot target 0) and as the "fully stopped" gate.
const MIN_LEVEL = 0.0001;
// Per-voice envelope peak. Deliberately below 1.0 so that even a handful of
// simultaneous voices stay inside the limiter's headroom instead of slamming
// into clipping before the compressor can react.
const VOICE_PEAK = 0.9;
// Final trim applied after the limiter as a last line of defense against
// inter-sample peaks sneaking past 0 dBFS.
const OUT_TRIM = 0.9;

// Simple, pleasant timbres. Keys intentionally overlap both the usePianoAudio
// InstrumentName set ("piano" | "warm-pad" | "bell") and the usePiano
// InstrumentType set ("piano" | "warm" | "bright" | "bell").
const TIMBRES: Record<string, Timbre> = {
  piano: {
    partials: [
      { ratio: 1, type: "triangle", gain: 1 },
      { ratio: 2, type: "sine", gain: 0.4 },
    ],
    attack: 0.005,
    decay: 0.4,
    sustain: 0.25,
    release: 0.8,
  },
  "warm-pad": {
    partials: [
      { ratio: 1, type: "sine", gain: 1 },
      { ratio: 1.5, type: "sine", gain: 0.5 },
      { ratio: 2, type: "sine", gain: 0.25 },
    ],
    attack: 0.2,
    decay: 0.3,
    sustain: 0.8,
    release: 1.2,
  },
  warm: {
    partials: [
      { ratio: 1, type: "sine", gain: 1 },
      { ratio: 1.5, type: "sine", gain: 0.6 },
      { ratio: 2, type: "triangle", gain: 0.3 },
    ],
    attack: 0.01,
    decay: 0.5,
    sustain: 0.4,
    release: 1.0,
  },
  bright: {
    partials: [
      { ratio: 1, type: "sawtooth", gain: 0.8 },
      { ratio: 2, type: "square", gain: 0.3 },
      { ratio: 3, type: "sine", gain: 0.2 },
    ],
    attack: 0.005,
    decay: 0.25,
    sustain: 0.3,
    release: 0.7,
  },
  bell: {
    partials: [
      { ratio: 1, type: "sine", gain: 1 },
      { ratio: 3.0, type: "sine", gain: 0.5 },
      { ratio: 5.0, type: "sine", gain: 0.25 },
    ],
    attack: 0.002,
    decay: 1.2,
    sustain: 0.05,
    release: 1.4,
  },
};

function resolveTimbre(name: string): Timbre {
  return TIMBRES[name] ?? TIMBRES.piano;
}

interface Voice {
  env: GainNode;
  oscillators: OscillatorNode[];
  releaseTime: number;
}

export interface NativePianoSynthOptions {
  instrument?: string;
  volumeDb?: number;
  /** Final output trim after the limiter (0..1). Defaults to OUT_TRIM. */
  outputTrim?: number;
}

/**
 * Polyphonic Web Audio piano engine.
 *
 * One master bus (volume -> limiter -> trim) feeds the destination. Each note is
 * an independent voice: a per-note GainNode envelope (attack/decay/sustain/
 * release) driven by one or more OscillatorNodes. Voices are released on
 * note-off and fully torn down (oscillators stopped, nodes disconnected) so
 * nothing can leak or keep ringing.
 *
 * Envelopes start from a true zero and end at a true zero (a short linear tail
 * after the exponential fade) so note starts and stops are click-free. A fast
 * re-attack of a still-fading note cancels that tail instead of stacking a
 * second oscillator set on top of it.
 */
export class NativePianoSynth implements PianoVoiceSynthLike {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly out: GainNode;
  private readonly voices = new Map<string, Voice>();
  private readonly releasing = new Map<string, Voice>();
  private instrument: string;
  private volumeDb: number;
  private readonly outputTrim: number;

  constructor(
    ctx: AudioContext,
    destination: AudioNode,
    options: NativePianoSynthOptions = {},
  ) {
    this.ctx = ctx;
    this.instrument = options.instrument ?? "piano";
    this.volumeDb = options.volumeDb ?? -8;
    this.outputTrim = options.outputTrim ?? OUT_TRIM;

    this.master = ctx.createGain();
    this.master.gain.value = dbToGain(this.volumeDb);

    // Brick-wall-ish limiter: anything above the threshold is crushed so that
    // many simultaneous voices cannot hard-clip the output.
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -8;
    this.compressor.knee.value = 0;
    this.compressor.ratio.value = 20;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    this.out = ctx.createGain();
    this.out.gain.value = this.outputTrim;

    this.master.connect(this.compressor);
    this.compressor.connect(this.out);
    this.out.connect(destination);
  }

  /** Update the master volume (dB). Smoothly tracks to avoid clicks. */
  setVolume(db: number): void {
    this.volumeDb = db;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(dbToGain(db), now, 0.01);
  }

  /** Change the timbre; applies to subsequent note attacks. */
  setInstrument(name: string): void {
    this.instrument = name;
  }

  /** The AudioContext this engine is rendered into (for connectivity checks). */
  get context(): AudioContext {
    return this.ctx;
  }

  triggerAttack(note: string): void {
    // Cancel any in-progress release tail for this pitch so a fast re-attack
    // cannot stack a second oscillator set on top of the fading one (the
    // "gurr"/crackle after rapid repeats). This is the identity-safe path: the
    // tail is addressed by its note name, never by a stale node reference.
    const tail = this.releasing.get(note);
    if (tail) {
      this.killVoice(tail);
      this.releasing.delete(note);
    }
    if (this.voices.has(note)) return; // duplicate attack guard

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const timbre = resolveTimbre(this.instrument);
    const attack = Math.max(timbre.attack, 0.001);

    const env = ctx.createGain();
    env.gain.cancelScheduledValues(now);
    // Start from a true zero and ramp up linearly so the attack is click-free.
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(VOICE_PEAK, now + attack);
    env.gain.exponentialRampToValueAtTime(
      Math.max(timbre.sustain * VOICE_PEAK, MIN_LEVEL),
      now + attack + timbre.decay,
    );
    env.connect(this.master);

    const oscillators: OscillatorNode[] = [];
    for (const partial of timbre.partials) {
      const osc = ctx.createOscillator();
      osc.type = partial.type;
      osc.frequency.value = noteToFrequency(note) * partial.ratio;
      if (partial.detune) osc.detune.value = partial.detune;
      const partialGain = ctx.createGain();
      partialGain.gain.value = partial.gain ?? 1;
      osc.connect(partialGain).connect(env);
      osc.start(now);
      oscillators.push(osc);
    }

    this.voices.set(note, { env, oscillators, releaseTime: timbre.release });
  }

  triggerRelease(note: string): void {
    const voice = this.voices.get(note);
    if (!voice) return;
    this.voices.delete(note);
    this.fadeOut(note, voice, voice.releaseTime);
  }

  releaseAll(): void {
    for (const note of Array.from(this.voices.keys())) {
      this.triggerRelease(note);
    }
  }

  /** Stop every voice (sounding or still fading) and disconnect the master bus.
   *  Safe to call repeatedly. */
  dispose(): void {
    for (const voice of this.voices.values()) this.killVoice(voice);
    for (const voice of this.releasing.values()) this.killVoice(voice);
    this.voices.clear();
    this.releasing.clear();
    this.disconnectNode(this.master);
    this.disconnectNode(this.compressor);
    this.disconnectNode(this.out);
  }

  // --- internals -----------------------------------------------------------

  /** Smooth release: exponential fade to the inaudible floor, then a short
   *  linear ramp to a true zero so the oscillator can stop without a click. */
  private fadeOut(note: string, voice: Voice, release: number): void {
    const now = this.ctx.currentTime;
    const env = voice.env;
    const current = Math.max(env.gain.value, MIN_LEVEL);
    env.gain.cancelScheduledValues(now);
    env.gain.setValueAtTime(current, now);
    env.gain.exponentialRampToValueAtTime(MIN_LEVEL, now + release);
    env.gain.linearRampToValueAtTime(0, now + release + 0.02);

    const stopAt = now + release + 0.03;
    let remaining = voice.oscillators.length;
    for (const osc of voice.oscillators) {
      this.stopOscillator(osc, stopAt);
      osc.onended = () => {
        this.disconnectNode(osc);
        if (--remaining === 0) {
          this.disconnectNode(env);
          this.releasing.delete(note);
        }
      };
    }
    // Track the fading voice by note so a fast re-attack can cancel it.
    this.releasing.set(note, voice);
  }

  /** Fast cutoff used for re-trigger cancellation and disposal. */
  private killVoice(voice: Voice): void {
    const now = this.ctx.currentTime;
    const release = 0.02;
    const env = voice.env;
    const current = Math.max(env.gain.value, MIN_LEVEL);
    env.gain.cancelScheduledValues(now);
    env.gain.setValueAtTime(current, now);
    env.gain.exponentialRampToValueAtTime(MIN_LEVEL, now + release);
    env.gain.linearRampToValueAtTime(0, now + release + 0.01);
    const stopAt = now + release + 0.02;
    for (const osc of voice.oscillators) {
      this.stopOscillator(osc, stopAt);
      osc.onended = () => {
        this.disconnectNode(osc);
        this.disconnectNode(env);
      };
    }
  }

  private stopOscillator(osc: OscillatorNode, stopAt: number): void {
    try {
      osc.stop(stopAt);
    } catch {
      // Already stopped (e.g. double-stop during a re-trigger cancel).
    }
  }

  private disconnectNode(node: { disconnect: (() => void) | (() => void) }): void {
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  }
}
