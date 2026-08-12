// Pure, framework-independent practice session state machine.
// Turns a stream of MIDI note-on/note-off messages (already converted to
// lesson-time by the caller) into incrementally re-scored results. Holds open
// notes as "held so far" so live feedback reflects the current attempt without
// waiting for note-off, and resolves everything at finalize time.

import { computeScores, matchNotes, type PerformedNote, type PracticeConfig, type ScoreNoteEvent, type ScoreResult } from "./scoring";

export type SessionNoteInput = {
  midi: number;
  name: string;
  channel?: number;
  velocity?: number;
};

const noteKey = (channel: number, midi: number) => `${channel}:${midi}`;

export class PracticeSession {
  private readonly events: ScoreNoteEvent[];
  private readonly config: PracticeConfig;
  private readonly performed: PerformedNote[] = [];
  private readonly openByKey = new Map<string, number>();
  private nextId = 0;
  private result: ScoreResult | null = null;

  constructor(events: ScoreNoteEvent[], config: PracticeConfig) {
    this.events = events;
    this.config = config;
  }

  get currentResult(): ScoreResult | null {
    return this.result;
  }

  get performedCount(): number {
    return this.performed.length;
  }

  /** Snapshot of performed notes; open notes reflect their onset so far. */
  getPerformedSnapshot(): PerformedNote[] {
    return this.performed.map((note) => ({ ...note }));
  }

  /** Record a key press at lesson-time `now` and recompute live scores. */
  noteOn(input: SessionNoteInput, now: number): ScoreResult {
    const key = noteKey(input.channel ?? 0, input.midi);
    if (this.openByKey.has(key)) return this.recompute(now);
    const note: PerformedNote = {
      id: `perf-${this.nextId}`,
      midi: input.midi,
      name: input.name,
      onset: now,
      offset: now,
      velocity: input.velocity,
      channel: input.channel,
    };
    this.nextId += 1;
    this.performed.push(note);
    this.openByKey.set(key, this.performed.length - 1);
    return this.recompute(now);
  }

  /** Record a key release at lesson-time `now`; no-op if nothing is held. */
  noteOff(channel: number, midi: number, now: number): ScoreResult | null {
    const key = noteKey(channel, midi);
    const index = this.openByKey.get(key);
    if (index === undefined) return null;
    this.openByKey.delete(key);
    this.performed[index].offset = now;
    return this.recompute(now);
  }

  /**
   * Resolve the attempt at `endTime`: any notes still held are closed there and
   * every expected event becomes matched or missed (nothing stays pending).
   */
  finalize(endTime: number): ScoreResult {
    for (const index of this.openByKey.values()) {
      this.performed[index].offset = Math.max(this.performed[index].offset, endTime);
    }
    this.openByKey.clear();
    return this.recompute(endTime);
  }

  private recompute(now: number): ScoreResult {
    for (const index of this.openByKey.values()) {
      this.performed[index].offset = now;
    }
    const { performedNotes, expectedNotes } = matchNotes(
      this.events,
      this.performed.map((note) => ({ ...note })),
      this.config,
      { endTime: now },
    );
    this.result = computeScores(performedNotes, expectedNotes, this.config);
    return this.result;
  }
}
