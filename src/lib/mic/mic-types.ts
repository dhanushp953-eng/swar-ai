// Shared types for the private, local-only microphone input pipeline.
// Audio never leaves the browser: the input stream is consumed by a Web Audio
// analyser, reduced to level + pitch numbers, and those numbers drive a note
// tracker that feeds the practice scorer. No recording, storage, upload, or
// transmission at any point.

export type MicStatus =
  | "idle"
  | "requesting"
  | "listening"
  | "permission-denied"
  | "unsupported"
  | "device-disconnected"
  | "error";

export type MicConnectionState = {
  status: MicStatus;
  /** 0..1 smoothed RMS level of the live input */
  level: number;
  /** 0..1 peak level of the live input */
  peak: number;
  /** detected fundamental frequency in Hz, or null when unvoiced/silent */
  frequency: number | null;
  /** detected MIDI note (rounded), or null */
  midi: number | null;
  noteName: string | null;
  /** 0..1 detection confidence (1 = perfectly periodic) */
  confidence: number;
  /** cents offset of the detected frequency from the rounded note (sharp+) */
  cents: number | null;
  /** amplitude gate: frames quieter than this are treated as silence */
  noiseThreshold: number;
  /** whether a noise calibration sample is currently being collected */
  calibrating: boolean;
  /** whether the current frame is being gated out (silence/noise/weak) */
  muted: boolean;
  error: string | null;
};

/** One analysis frame handed to the note tracker for gating and smoothing. */
export type MicPitchFrame = {
  /** analysis clock time in ms (used only for event timestamps) */
  time: number;
  level: number;
  peak: number;
  frequency: number | null;
  confidence: number;
  midi: number | null;
  cents: number | null;
  /** confidence below the gate: unvoiced / noise / breath */
  unvoiced: boolean;
  /** level below the noise threshold: effectively silence */
  belowNoise: boolean;
  /** frequency outside the supported note range */
  outOfRange: boolean;
};

/** The mic's output channel, reserved and distinct from real MIDI channels. */
export const MIC_CHANNEL = 1;

export type MicNoteEvent = {
  type: "noteon" | "noteoff";
  channel: number;
  noteNumber: number;
  noteName: string;
  velocity: number;
  timestamp: number;
  reason: "key" | "release-all";
};
