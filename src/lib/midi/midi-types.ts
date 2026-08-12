export type MidiConnectionStatus =
  | "unsupported"
  | "permission-required"
  | "connecting"
  | "connected"
  | "permission-denied"
  | "device-disconnected"
  | "error";

export type MidiDeviceInfo = {
  id: string;
  name: string;
  manufacturer: string | null;
};

export type MidiHeldNote = {
  channel: number;
  noteNumber: number;
  noteName: string;
  velocity: number;
  timestamp: number;
  sustained: boolean;
};

export type MidiNoteEvent = {
  type: "noteon" | "noteoff";
  channel: number;
  noteNumber: number;
  noteName: string;
  velocity: number;
  timestamp: number;
  reason: "key" | "sustain" | "release-all";
};

export type MidiSustainEvent = {
  type: "sustain";
  active: boolean;
  timestamp: number;
};

export type MidiEvent = MidiNoteEvent | MidiSustainEvent;

export type MidiConnectionState = {
  status: MidiConnectionStatus;
  devices: MidiDeviceInfo[];
  selectedDeviceId: string | null;
  heldNotes: MidiHeldNote[];
  sustainActive: boolean;
  activity: number;
  lastActivityAt: number | null;
  error: string | null;
};
