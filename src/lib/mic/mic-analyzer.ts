// Web Audio analyser wrapper for the microphone input. Reads time-domain
// samples into a reusable buffer, computes the RMS level and YIN pitch, and
// returns plain numbers. The controller owns the stream; this class only
// touches the AudioContext graph.

import { detectPitch, type YinOptions } from "@/lib/pitch/yin";
import { frequencyToNote } from "@/lib/pitch/notes";

export type MicAnalysis = {
  /** 0..1 RMS level */
  level: number;
  /** 0..1 peak level */
  peak: number;
  frequency: number | null;
  confidence: number;
  midi: number | null;
  cents: number | null;
};

export type MicAnalyzerLike = {
  attach(stream: MediaStream): void;
  detach(): void;
  analyse(): MicAnalysis;
};

type AudioContextConstructor = typeof AudioContext;

type GlobalWithLegacyAudio = {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
};

export function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const g = globalThis as typeof globalThis & GlobalWithLegacyAudio;
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export class WebAudioMicAnalyzer implements MicAnalyzerLike {
  private readonly buffer: Float32Array<ArrayBuffer>;
  private readonly yinOptions: YinOptions;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  constructor(options: { bufferSize?: number; yin?: YinOptions } = {}) {
    this.buffer = new Float32Array(options.bufferSize ?? 2048);
    this.yinOptions = { minFrequency: 65, maxFrequency: 1000, ...options.yin };
  }

  attach(stream: MediaStream): void {
    this.detach();
    const AudioContextCtor = getAudioContextConstructor();
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    this.context = context;
    this.analyser = analyser;
    this.source = source;
  }

  detach(): void {
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.source = null;
    this.analyser = null;
    if (this.context) {
      const context = this.context;
      if (context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    }
    this.context = null;
  }

  analyse(): MicAnalysis {
    if (!this.analyser || !this.context) {
      return { level: 0, peak: 0, frequency: null, confidence: 0, midi: null, cents: null };
    }
    this.analyser.getFloatTimeDomainData(this.buffer);

    let sum = 0;
    let peak = 0;
    for (let i = 0; i < this.buffer.length; i += 1) {
      const sample = this.buffer[i];
      sum += sample * sample;
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }
    const level = Math.sqrt(sum / this.buffer.length);

    const detected = detectPitch(this.buffer, this.context.sampleRate, this.yinOptions);
    if (!detected) {
      return { level, peak, frequency: null, confidence: 0, midi: null, cents: null };
    }
    const note = frequencyToNote(detected.frequency);
    return {
      level,
      peak,
      frequency: detected.frequency,
      confidence: detected.confidence,
      midi: note?.midi ?? null,
      cents: note?.cents ?? null,
    };
  }
}
