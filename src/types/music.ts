export type InstrumentName = "piano" | "warm-pad" | "bell";
export type InstrumentType = "piano" | "warm" | "bright" | "bell";

export type PianoNote = {
  name: string;
  midi: number;
  octave: number;
  isBlack: boolean;
  keyboardKey?: string;
};

export type PianoKey = { note: string; midi: number; octave: number; isBlack: boolean; keyboard?: string };
