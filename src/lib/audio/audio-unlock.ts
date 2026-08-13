import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";

export type AudioUnlockState = "running" | "suspended" | "interrupted" | "locked" | "unsupported";

export interface AudioOutputReport {
  connected: boolean;
  muted: boolean;
  audible: boolean;
}

/** Minimal shape of a Tone instrument needed to sanity-check the output path. */
export interface AudioOutputLike {
  volume: { value: number };
  mute?: boolean;
}

/**
 * Confirms a piano synth is actually capable of making sound:
 * - created/connected to the destination (caller wires `.toDestination()`),
 * - not muted,
 * - has a finite, audible volume.
 */
export function verifyAudioOutput(synth: AudioOutputLike | null): AudioOutputReport {
  if (!synth) return { connected: false, muted: true, audible: false };
  const value = synth.volume.value;
  const finite = Number.isFinite(value);
  const muted = Boolean(synth.mute) || !finite || value <= -Infinity;
  const audible = finite && value > -60;
  return { connected: true, muted, audible };
}

/**
 * Manager for the Tone.js AudioContext lifecycle.
 *
 * Mobile browsers (iOS Safari especially) start the AudioContext suspended and
 * only allow it to resume from inside a user gesture, and may move it to
 * "interrupted" when the OS audio route changes. This class resumes the EXACT
 * raw context that backs the piano synth and reports its real state so the UI
 * can prompt the user and tell them when audio stays blocked.
 *
 * It never creates a second AudioContext or a second engine — it only touches
 * the singleton Tone context.
 */
export class ToneAudioUnlock {
  private state: AudioUnlockState = "suspended";
  private ctx: AudioContext | null = null;
  private listener: (() => void) | null = null;
  private readonly onChange: (state: AudioUnlockState) => void;

  constructor(onChange: (state: AudioUnlockState) => void) {
    this.onChange = onChange;
  }

  getState(): AudioUnlockState {
    return this.state;
  }

  /** The exact Web Audio context backing the Tone.js synth(s). */
  getRawContext(): AudioContext | null {
    try {
      return (Tone.getContext().rawContext as AudioContext) ?? null;
    } catch {
      return null;
    }
  }

  private setState(next: AudioUnlockState): void {
    if (next === this.state) return;
    this.state = next;
    this.onChange(next);
  }

  private ensureListener(raw: AudioContext): void {
    this.ctx = raw;
    if (!this.listener) {
      this.listener = () => this.sync();
      raw.addEventListener("statechange", this.listener);
    }
  }

  sync(): void {
    const raw = this.ctx ?? this.getRawContext();
    if (!raw) {
      this.setState("unsupported");
      return;
    }
    this.ctx = raw;
    const current: AudioContextState = raw.state;
    this.setState(current === "running" ? "running" : current === "interrupted" ? "interrupted" : "suspended");
  }

  private toUnlockState(state: AudioContextState): AudioUnlockState {
    switch (state) {
      case "running":
        return "running";
      case "suspended":
      case "interrupted":
        return "suspended";
      case "closed":
        return "unsupported";
      default:
        return "locked";
    }
  }

  /** Resume the AudioContext directly from a user gesture. Returns the state
   *  after the attempt so callers can tell the user when audio stays blocked. */
  async unlock(): Promise<AudioUnlockState> {
    try {
      const raw = this.getRawContext();
      if (!raw) {
        this.setState("unsupported");
        return "unsupported";
      }
      this.ensureListener(raw);
      // Resume synchronously inside the current user gesture (before any await)
      // so the browser's user-activation requirement is satisfied. This is the
      // critical step for mobile browsers that otherwise keep the context suspended.
      if (raw.state !== "running") {
        try {
          raw.resume();
        } catch {
          // ignore — retried below and on the next gesture
        }
      }
      await Tone.start();
      if (raw.state !== "running") {
        try {
          await raw.resume();
        } catch {
          // ignore — next gesture retries
        }
      }
      this.sync();
      return this.toUnlockState(raw.state);
    } catch {
      this.setState("locked");
      return "locked";
    }
  }

  dispose(): void {
    if (this.listener && this.ctx) {
      this.ctx.removeEventListener("statechange", this.listener);
    }
    this.listener = null;
    this.ctx = null;
  }
}

/**
 * React hook that resumes the Tone.js AudioContext on the first user gesture
 * anywhere on the page and keeps the UI in sync with its real state.
 */
export function useToneAudioUnlock(): {
  state: AudioUnlockState;
  unlock: () => Promise<AudioUnlockState>;
  getRawContext: () => AudioContext | null;
} {
  const [state, setState] = useState<AudioUnlockState>("suspended");
  const ref = useRef<ToneAudioUnlock | null>(null);
  const getUnlocker = useCallback(() => {
    if (!ref.current) ref.current = new ToneAudioUnlock(setState);
    return ref.current;
  }, [setState]);

  useEffect(() => {
    const unlocker = getUnlocker();
    const onFirstGesture = () => {
      void unlocker.unlock();
    };
    const options = { capture: true } as AddEventListenerOptions;
    document.addEventListener("pointerdown", onFirstGesture, options);
    document.addEventListener("touchstart", onFirstGesture, options);
    document.addEventListener("click", onFirstGesture, options);
    return () => {
      document.removeEventListener("pointerdown", onFirstGesture, options);
      document.removeEventListener("touchstart", onFirstGesture, options);
      document.removeEventListener("click", onFirstGesture, options);
      unlocker.dispose();
    };
  }, [getUnlocker]);

  const unlock = useCallback(() => getUnlocker().unlock(), [getUnlocker]);
  const getRawContext = useCallback(() => getUnlocker().getRawContext(), [getUnlocker]);
  return { state, unlock, getRawContext };
}
