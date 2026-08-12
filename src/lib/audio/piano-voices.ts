// Pure note-voice lifecycle policy for a polyphonic piano engine. No DOM or
// Tone dependency so it can be exhaustively unit-tested against a fake synth.
//
// Guarantees:
// - every voice started by attack() has a matching release (heavy handed on
//   releaseAll()/disconnect so nothing can keep ringing),
// - duplicate note-ons for the same pitch are ignored while it is sounding,
// - a release that arrives before its deferred attack still cancels the attack
//   (the classic stuck-note race after an async Tone.start()),
// - sustain only delays release while enabled; disabling it releases every
//   sustained voice immediately,
// - releaseAll() force-releases on pause, stop, restart, seek, disconnect,
//   input-mode switch, window blur, visibility hidden, and component unmount.

export interface PianoVoiceSynthLike {
  triggerAttack(note: string): void;
  triggerRelease(note: string): void;
  releaseAll(): void;
}

export type PianoVoiceControllerOptions = {
  /** Sustain pedal starts in this state (defaults to off). */
  sustain?: boolean;
};

export class PianoVoiceController {
  private synth: PianoVoiceSynthLike;
  private active = new Set<string>();
  private sustained = new Set<string>();
  private attacked = new Set<string>();
  private sustainEnabled: boolean;
  private readonly listeners = new Set<() => void>();
  private snapshot: ReadonlySet<string> = new Set();

  constructor(synth: PianoVoiceSynthLike, options: PianoVoiceControllerOptions = {}) {
    this.synth = synth;
    this.sustainEnabled = options.sustain ?? false;
  }

  get isSustainEnabled(): boolean {
    return this.sustainEnabled;
  }

  /** Snapshot of notes currently sounding (held + sustained). */
  getActiveNotes(): ReadonlySet<string> {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Swap the underlying engine (e.g. on an instrument change) without losing
   *  the tracked voice state; forces everything out on the old engine first. */
  setSynth(synth: PianoVoiceSynthLike): void {
    this.releaseAll();
    this.synth = synth;
  }

  /**
   * Register a press synchronously — before any `await` on the audio context —
   * so a release that arrives during that wait still cancels the late attack.
   * Returns false when the pitch is already sounding/pressed so callers skip
   * the attack and never create a second voice for the same pitch.
   */
  press(note: string): boolean {
    if (this.active.has(note)) {
      // Re-pressing an already-sounding note keeps it physically held (drops
      // the sustain hold) but does not start a new voice.
      this.sustained.delete(note);
      return false;
    }
    this.active.add(note);
    this.sync();
    return true;
  }

  /** Start the voice. Safe to call once the context resumes; a no-op if the
   *  press was released or swept away by releaseAll() in the meantime. */
  attack(note: string): void {
    if (!this.active.has(note) || this.attacked.has(note)) return;
    this.synth.triggerAttack(note);
    this.attacked.add(note);
  }

  /** Key-up / note-off. Honors sustain: while the pedal is down the voice
   *  stays sounding (marked sustained) instead of being released. A release
   *  that arrives before its deferred attack simply cancels the pending note. */
  release(note: string): void {
    if (!this.active.has(note)) return;
    if (this.sustainEnabled) {
      this.sustained.add(note);
      this.sync();
      return;
    }
    if (this.attacked.has(note)) {
      this.synth.triggerRelease(note);
      this.attacked.delete(note);
    }
    this.active.delete(note);
    this.sustained.delete(note);
    this.sync();
  }

  /** Turning sustain OFF releases every sustained (key-released) voice now. */
  setSustain(enabled: boolean): void {
    if (enabled === this.sustainEnabled) return;
    this.sustainEnabled = enabled;
    if (!enabled) {
      for (const note of this.sustained) {
        this.synth.triggerRelease(note);
        this.attacked.delete(note);
        this.active.delete(note);
      }
      this.sustained.clear();
      this.sync();
    }
  }

  /** Force-release every voice (stuck-note prevention). */
  releaseAll(): void {
    for (const note of this.attacked) this.synth.triggerRelease(note);
    this.attacked.clear();
    this.active.clear();
    this.sustained.clear();
    this.sync();
  }

  private sync(): void {
    this.snapshot = new Set(this.active);
    this.listeners.forEach((listener) => listener());
  }
}
