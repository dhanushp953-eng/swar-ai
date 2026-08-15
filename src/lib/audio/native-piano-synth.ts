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

const MIN_LEVEL = 0.0001;

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
}

/**
 * Polyphonic Web Audio piano engine.
 *
 * One master GainNode (volume) feeds the provided destination node. Each note
 * is an independent voice: a per-note GainNode envelope (attack/decay/sustain/
 * release) driven by one or more OscillatorNodes. Voices are released on
 * note-off and fully torn down on stop() to avoid node leaks.
 */
export class NativePianoSynth implements PianoVoiceSynthLike {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly voices = new Map<string, Voice>();
  private instrument: string;
  private volumeDb: number;

  constructor(
    ctx: AudioContext,
    destination: AudioNode,
    options: NativePianoSynthOptions = {},
  ) {
    this.ctx = ctx;
    this.instrument = options.instrument ?? "piano";
    this.volumeDb = options.volumeDb ?? -8;
    this.master = ctx.createGain();
    this.master.gain.value = dbToGain(this.volumeDb);
    this.master.connect(destination);
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
    if (this.voices.has(note)) return; // already sounding — no duplicate voice
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const timbre = resolveTimbre(this.instrument);

    const env = ctx.createGain();
    env.gain.cancelScheduledValues(now);
    env.gain.setValueAtTime(MIN_LEVEL, now);
    env.gain.linearRampToValueAtTime(1, now + timbre.attack);
    env.gain.exponentialRampToValueAtTime(
      Math.max(timbre.sustain, MIN_LEVEL),
      now + timbre.attack + timbre.decay,
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

    const now = this.ctx.currentTime;
    const release = voice.releaseTime;
    const current = Math.max(voice.env.gain.value, MIN_LEVEL);
    voice.env.gain.cancelScheduledValues(now);
    voice.env.gain.setValueAtTime(current, now);
    voice.env.gain.exponentialRampToValueAtTime(MIN_LEVEL, now + release);

    for (const osc of voice.oscillators) {
      osc.stop(now + release + 0.03);
      osc.onended = () => {
        try {
          osc.disconnect();
        } catch {
          // already disconnected
        }
        try {
          voice.env.disconnect();
        } catch {
          // already disconnected
        }
      };
    }
  }

  releaseAll(): void {
    for (const note of Array.from(this.voices.keys())) {
      this.triggerRelease(note);
    }
  }

  /** Stop every voice and disconnect the master bus. Safe to call repeatedly. */
  dispose(): void {
    this.releaseAll();
    try {
      this.master.disconnect();
    } catch {
      // already disconnected
    }
  }
}
