// Microphone input controller: browser plumbing around the pure note tracker.
// Permission is requested lazily (only from a user gesture via start()), audio
// is consumed locally by a Web Audio analyser and reduced to numbers, and no
// recording/upload/transmission ever happens. Handles permission denial,
// unsupported browsers, missing devices, device changes, window blur, and
// cleanup. Dependency-injected (like WebMidiController) so tests and the
// browser-verification page can substitute a fake mic + scripted analyser.

import { MicNoteTracker } from "./mic-note-tracker";
import { WebAudioMicAnalyzer, type MicAnalyzerLike } from "./mic-analyzer";
import type { MicConnectionState, MicNoteEvent, MicPitchFrame, MicStatus } from "./mic-types";
import { midiNumberToNoteName } from "@/lib/midi/midi-notes";

export type MicInputControllerDeps = {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  requestAnimationFrame?: (callback: (time: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
  now?: () => number;
  subscribeWindowBlur?: (handler: () => void) => () => void;
  subscribeVisibilityChange?: (handler: (hidden: boolean) => void) => () => void;
  subscribeDeviceChange?: (handler: () => void) => () => void;
  /** override the analyser (fake mic in tests/verification) */
  analyzer?: MicAnalyzerLike;
  /** override the tracker (tests) */
  tracker?: MicNoteTracker;
  confidenceThreshold?: number;
  minLevel?: number;
  minMidi?: number;
  maxMidi?: number;
};

type Calibration = {
  remaining: number;
  levels: number[];
  resolve: (threshold: number) => void;
};

const DEFAULT_NOISE_THRESHOLD = 0.02;
const NOISE_THRESHOLD_MIN = 0.004;
const NOISE_THRESHOLD_MAX = 0.3;

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // already stopped
    }
  });
}

export class MicInputController {
  private readonly deps: MicInputControllerDeps;
  private readonly analyzer: MicAnalyzerLike;
  private readonly tracker: MicNoteTracker;
  private readonly confidenceThreshold: number;
  private readonly minLevel: number;
  private readonly minMidi: number;
  private readonly maxMidi: number;

  private status: MicStatus = "idle";
  private error: string | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private loopRunning = false;
  private destroyed = false;

  private level = 0;
  private peak = 0;
  private frequency: number | null = null;
  private confidence = 0;
  private midi: number | null = null;
  private cents: number | null = null;
  private muted = false;
  private noiseThreshold = DEFAULT_NOISE_THRESHOLD;
  private calibrating = false;
  private calibration: Calibration | null = null;

  private readonly stateListeners = new Set<() => void>();
  private readonly cleanupFns: Array<() => void> = [];
  private readonly onTrackEnded = (): void => this.handleTrackEnded();
  private readonly onDeviceChange = (): void => this.handleDeviceChange();

  constructor(deps: MicInputControllerDeps = {}) {
    this.deps = deps;
    this.analyzer = deps.analyzer ?? new WebAudioMicAnalyzer();
    this.tracker =
      deps.tracker ??
      new MicNoteTracker({
        confidenceThreshold: deps.confidenceThreshold,
        minLevel: deps.minLevel,
        minMidi: deps.minMidi,
        maxMidi: deps.maxMidi,
      });
    this.confidenceThreshold = deps.confidenceThreshold ?? 0.9;
    this.minLevel = deps.minLevel ?? 0.03;
    this.minMidi = deps.minMidi ?? 24;
    this.maxMidi = deps.maxMidi ?? 96;
  }

  getState(): MicConnectionState {
    return {
      status: this.status,
      level: this.level,
      peak: this.peak,
      frequency: this.frequency,
      midi: this.midi,
      noteName: this.midi === null ? null : midiNumberToNoteName(this.midi),
      confidence: this.confidence,
      cents: this.cents,
      noiseThreshold: this.noiseThreshold,
      calibrating: this.calibrating,
      muted: this.muted,
      error: this.error,
    };
  }

  subscribeState(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  subscribeEvents(listener: (event: MicNoteEvent) => void): () => void {
    return this.tracker.subscribeEvents(listener);
  }

  getHeldNotes(): ReadonlySet<number> {
    return this.tracker.getHeldNotes();
  }

  getNoiseThreshold(): number {
    return this.noiseThreshold;
  }

  setNoiseThreshold(value: number): void {
    this.noiseThreshold = Math.min(NOISE_THRESHOLD_MAX, Math.max(NOISE_THRESHOLD_MIN, value));
    this.emitState();
  }

  /**
   * Request microphone permission and begin listening. Only call from a user
   * gesture ("Enable microphone"); nothing else ever touches the microphone.
   */
  async start(): Promise<void> {
    if (this.destroyed) return;
    const getUserMedia = this.deps.getUserMedia;
    if (!getUserMedia) {
      this.setStatus("unsupported", "Microphone input is not supported in this browser.");
      return;
    }
    if (this.status === "requesting" || this.status === "listening") return;
    this.setStatus("requesting");
    try {
      const stream = await getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      if (this.destroyed) {
        stopStream(stream);
        return;
      }
      this.stream = stream;
      this.analyzer.attach(stream);
      const track = stream.getAudioTracks()[0];
      if (track) track.addEventListener("ended", this.onTrackEnded);
      this.attachLifecycleListeners();
      this.setStatus("listening");
      this.startLoop();
    } catch (requestError) {
      if (this.destroyed) return;
      if (isPermissionError(requestError)) {
        this.setStatus("permission-denied", "Microphone access was denied. Allow the microphone for this site in your browser and try again.");
      } else if (isNotFoundError(requestError)) {
        this.setStatus("device-disconnected", "No microphone was found. Connect one and try again.");
      } else {
        this.setStatus("error", `Could not start the microphone: ${readErrorMessage(requestError)}`);
      }
    }
  }

  /** Stop listening and release the microphone entirely (also releases notes). */
  stop(): void {
    this.stopLoop();
    if (this.stream) {
      const track = this.stream.getAudioTracks()[0];
      if (track) track.removeEventListener("ended", this.onTrackEnded);
      stopStream(this.stream);
    }
    this.stream = null;
    this.analyzer.detach();
    this.tracker.releaseAll();
    this.detachLifecycleListeners();
    this.level = 0;
    this.peak = 0;
    this.frequency = null;
    this.confidence = 0;
    this.midi = null;
    this.cents = null;
    this.muted = false;
    this.calibrating = false;
    this.calibration = null;
    if (
      this.status !== "permission-denied" &&
      this.status !== "unsupported" &&
      this.status !== "device-disconnected" &&
      this.status !== "error"
    ) {
      this.setStatus("idle");
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    this.stateListeners.clear();
  }

  /**
   * Sample the current ambient level for `seconds` and raise the noise gate
   * just above it. Local-only; no data leaves the page.
   */
  calibrateNoise(seconds = 1): Promise<number> {
    if (this.status !== "listening" || this.destroyed) return Promise.resolve(this.noiseThreshold);
    return new Promise((resolve) => {
      const frames = Math.max(3, Math.round(seconds * 60));
      this.calibration = { remaining: frames, levels: [], resolve };
      this.calibrating = true;
      this.emitState();
    });
  }

  /** Process a single analysis frame now (drives the loop; also testable). */
  tick(): void {
    if (this.destroyed) return;
    this.analyseFrame();
  }

  private startLoop(): void {
    if (this.loopRunning || this.destroyed) return;
    this.loopRunning = true;
    const frame = (): void => {
      if (!this.loopRunning || this.destroyed) return;
      this.analyseFrame();
      this.rafId = this.deps.requestAnimationFrame?.(frame) ?? null;
    };
    this.rafId = this.deps.requestAnimationFrame?.(frame) ?? null;
  }

  private stopLoop(): void {
    this.loopRunning = false;
    if (this.rafId !== null) {
      this.deps.cancelAnimationFrame?.(this.rafId);
      this.rafId = null;
    }
  }

  private analyseFrame(): void {
    if (this.status !== "listening") return;
    const analysis = this.analyzer.analyse();
    this.level = analysis.level;
    this.peak = analysis.peak;
    this.frequency = analysis.frequency;
    this.confidence = analysis.confidence;
    this.midi = analysis.midi;
    this.cents = analysis.cents;

    if (this.calibration) {
      this.calibration.levels.push(analysis.level);
      this.calibration.remaining -= 1;
      if (this.calibration.remaining <= 0) {
        const { levels, resolve } = this.calibration;
        this.calibration = null;
        this.calibrating = false;
        const floor = percentile(levels, 0.9);
        this.noiseThreshold = Math.min(NOISE_THRESHOLD_MAX, Math.max(NOISE_THRESHOLD_MIN, floor * 1.5));
        resolve(this.noiseThreshold);
      }
    }

    const unvoiced = analysis.frequency === null || analysis.confidence < this.confidenceThreshold;
    const belowNoise = analysis.level < this.noiseThreshold;
    const outOfRange = analysis.midi !== null && (analysis.midi < this.minMidi || analysis.midi > this.maxMidi);
    this.muted = unvoiced || belowNoise || outOfRange;

    const frame: MicPitchFrame = {
      time: this.now(),
      level: analysis.level,
      peak: analysis.peak,
      frequency: analysis.frequency,
      confidence: analysis.confidence,
      midi: analysis.midi,
      cents: analysis.cents,
      unvoiced,
      belowNoise,
      outOfRange,
    };
    this.tracker.processFrame(frame);
    this.emitState();
  }

  private handleTrackEnded(): void {
    if (this.destroyed || this.status !== "listening") return;
    this.stopLoop();
    this.stream = null;
    this.analyzer.detach();
    this.tracker.releaseAll();
    this.detachLifecycleListeners();
    this.setStatus("device-disconnected", "The microphone was disconnected.");
  }

  private handleDeviceChange(): void {
    if (this.destroyed || this.status !== "listening") return;
    const track = this.stream?.getAudioTracks()[0];
    if (track && track.readyState !== "live") {
      this.handleTrackEnded();
      return;
    }
    // A new device arrived or the current one is still live: keep listening.
    this.emitState();
  }

  private attachLifecycleListeners(): void {
    if (this.cleanupFns.length > 0) return;
    const unsubscribeBlur = this.deps.subscribeWindowBlur?.(() => this.tracker.releaseAll());
    const unsubscribeVisibility = this.deps.subscribeVisibilityChange?.((hidden) => {
      if (hidden) this.tracker.releaseAll();
    });
    const unsubscribeDevice = this.deps.subscribeDeviceChange?.(this.onDeviceChange);
    if (unsubscribeBlur) this.cleanupFns.push(unsubscribeBlur);
    if (unsubscribeVisibility) this.cleanupFns.push(unsubscribeVisibility);
    if (unsubscribeDevice) this.cleanupFns.push(unsubscribeDevice);
  }

  private detachLifecycleListeners(): void {
    this.cleanupFns.forEach((unsubscribe) => unsubscribe());
    this.cleanupFns.length = 0;
  }

  private emitState(): void {
    this.stateListeners.forEach((listener) => listener());
  }

  private setStatus(status: MicStatus, error?: string | null): void {
    this.status = status;
    if (error !== undefined) this.error = error;
    this.emitState();
  }

  private now(): number {
    if (this.deps.now) return this.deps.now();
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  }
}

function percentile(sortedLike: number[], ratio: number): number {
  if (sortedLike.length === 0) return 0;
  const sorted = [...sortedLike].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(ratio * sorted.length));
  return sorted[index];
}

function isPermissionError(error: unknown): boolean {
  const name = errorName(error);
  return name === "NotAllowedError" || name === "SecurityError";
}

function isNotFoundError(error: unknown): boolean {
  const name = errorName(error);
  return name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError";
}

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    return String((error as { name: unknown }).name);
  }
  return "";
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown error";
}

type NavigatorWithMediaDevices = {
  mediaDevices?: {
    getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  };
};

export function createMicPlatform(): MicInputControllerDeps {
  const nav = typeof navigator !== "undefined" ? (navigator as NavigatorWithMediaDevices) : undefined;
  const media = nav?.mediaDevices;
  const getUserMedia = media?.getUserMedia ? media.getUserMedia.bind(media) : undefined;
  return {
    getUserMedia,
    requestAnimationFrame:
      typeof window !== "undefined"
        ? (callback) => window.requestAnimationFrame(callback)
        : undefined,
    cancelAnimationFrame:
      typeof window !== "undefined"
        ? (id) => window.cancelAnimationFrame(id)
        : undefined,
    subscribeWindowBlur:
      typeof window !== "undefined"
        ? (handler) => {
            window.addEventListener("blur", handler);
            return () => window.removeEventListener("blur", handler);
          }
        : () => () => undefined,
    subscribeVisibilityChange:
      typeof document !== "undefined"
        ? (handler) => {
            const listener = () => handler(document.hidden);
            document.addEventListener("visibilitychange", listener);
            return () => document.removeEventListener("visibilitychange", listener);
          }
        : () => () => undefined,
    subscribeDeviceChange: media?.addEventListener
      ? (handler) => {
          const deviceMedia = media!;
          deviceMedia.addEventListener?.("devicechange", handler);
          return () => deviceMedia.removeEventListener?.("devicechange", handler);
        }
      : () => () => undefined,
  };
}

let singleton: MicInputController | null = null;

export function getMicInput(): MicInputController {
  if (!singleton) singleton = new MicInputController(createMicPlatform());
  return singleton;
}
