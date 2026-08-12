// Converts a stream of analysed mic frames into discrete, typed note-on/off
// events. Pure logic (no DOM, no audio) so it can be exhaustively unit-tested:
// - stabilization: a candidate note must persist for N consecutive frames.
// - duplicate prevention: the same note is never re-triggered while held, and
//   pitch wavering inside a small tolerance keeps the original note held.
// - stuck-note prevention: silence/weak frames release after a grace period,
//   and releaseAll() force-releases on stop, blur, or device loss.

import { midiNumberToNoteName } from "@/lib/midi/midi-notes";
import { centsFromMidi } from "@/lib/pitch/notes";
import { MIC_CHANNEL, type MicNoteEvent, type MicPitchFrame } from "./mic-types";

export type MicTrackerConfig = {
  /** minimum YIN confidence (0..1) before a pitch counts as a note */
  confidenceThreshold: number;
  /** minimum RMS level (0..1) before a pitch counts as a note */
  minLevel: number;
  /** consecutive same-note frames required before a note-on is emitted */
  stabilizationFrames: number;
  /** consecutive silent/gated frames before a held note is released */
  releaseFrames: number;
  /** keep the held note while the pitch wavers within this many cents */
  pitchToleranceCents: number;
  /** supported note range (inclusive) */
  minMidi: number;
  maxMidi: number;
};

export const DEFAULT_MIC_TRACKER_CONFIG: MicTrackerConfig = {
  confidenceThreshold: 0.9,
  minLevel: 0.03,
  stabilizationFrames: 4,
  releaseFrames: 6,
  pitchToleranceCents: 40,
  minMidi: 24,
  maxMidi: 96,
};

export type MicTrackerListener = (event: MicNoteEvent) => void;

export class MicNoteTracker {
  private readonly listeners = new Set<MicTrackerListener>();
  private readonly config: MicTrackerConfig;
  private held: number | null = null;
  private candidate: { midi: number; count: number } | null = null;
  private silentFrames = 0;

  constructor(config: Partial<MicTrackerConfig> = {}) {
    this.config = { ...DEFAULT_MIC_TRACKER_CONFIG, ...config };
  }

  subscribeEvents(listener: MicTrackerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getHeldNotes(): ReadonlySet<number> {
    return new Set(this.held === null ? [] : [this.held]);
  }

  /** True when a note is currently held open (used for stuck-note checks). */
  get isHolding(): boolean {
    return this.held !== null;
  }

  /** Feed one analysed frame; returns the events emitted by this frame. */
  processFrame(frame: MicPitchFrame): MicNoteEvent[] {
    const emitted: MicNoteEvent[] = [];
    const desired = this.resolveDesired(frame);

    if (desired === null) {
      this.candidate = null;
      this.silentFrames += 1;
      if (this.held !== null && this.silentFrames >= this.config.releaseFrames) {
        this.emit(this.releaseNote(false), emitted);
      }
      return emitted;
    }

    this.silentFrames = 0;
    if (this.candidate !== null && this.candidate.midi === desired) {
      this.candidate.count += 1;
    } else {
      this.candidate = { midi: desired, count: 1 };
    }

    if (this.candidate.count >= this.config.stabilizationFrames && this.held !== desired) {
      if (this.held !== null) this.emit(this.releaseNote(false), emitted);
      this.held = desired;
      this.emit(
        {
          type: "noteon",
          channel: MIC_CHANNEL,
          noteNumber: desired,
          noteName: midiNumberToNoteName(desired),
          velocity: 1,
          timestamp: frame.time,
          reason: "key",
        },
        emitted,
      );
    }
    return emitted;
  }

  /** Force-release any held note (stop, blur, visibility hidden, device lost). */
  releaseAll(): MicNoteEvent[] {
    const emitted: MicNoteEvent[] = [];
    if (this.held !== null) this.emit(this.releaseNote(true), emitted);
    this.candidate = null;
    this.silentFrames = 0;
    return emitted;
  }

  private emit(event: MicNoteEvent, into: MicNoteEvent[]): void {
    into.push(event);
    this.listeners.forEach((listener) => listener(event));
  }

  private resolveDesired(frame: MicPitchFrame): number | null {
    const { confidenceThreshold, minLevel, minMidi, maxMidi } = this.config;
    if (frame.unvoiced || frame.belowNoise || frame.outOfRange) return null;
    if (frame.midi === null || frame.frequency === null) return null;
    if (frame.confidence < confidenceThreshold || frame.level < minLevel) return null;
    if (frame.midi < minMidi || frame.midi > maxMidi) return null;

    // Pitch wavering: keep the held note while the pitch stays near it, so a
    // slightly flat/sharp rendition does not flicker the detected note.
    if (this.held !== null && Math.abs(centsFromMidi(frame.frequency, this.held)) <= this.config.pitchToleranceCents) {
      return this.held;
    }
    return frame.midi;
  }

  private releaseNote(releaseAll: boolean): MicNoteEvent {
    const noteNumber = this.held as number;
    this.held = null;
    return {
      type: "noteoff",
      channel: MIC_CHANNEL,
      noteNumber,
      noteName: midiNumberToNoteName(noteNumber),
      velocity: 0,
      timestamp: 0,
      reason: releaseAll ? "release-all" : "key",
    };
  }
}
