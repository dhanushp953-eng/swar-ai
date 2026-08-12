const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiNumberToNoteName(midi: number): string {
  const safe = Math.min(127, Math.max(0, Math.round(midi)));
  const octave = Math.floor(safe / 12) - 1;
  return `${NOTE_NAMES[safe % 12]}${octave}`;
}

export function normalizeVelocity(velocity: number): number {
  if (Number.isNaN(velocity)) return 0;
  return Math.min(1, Math.max(0, velocity / 127));
}

export type ParsedNoteOn = { kind: "noteon"; channel: number; noteNumber: number; velocity: number };
export type ParsedNoteOff = { kind: "noteoff"; channel: number; noteNumber: number };
export type ParsedControlChange = { kind: "cc"; channel: number; controller: number; value: number };
export type ParsedMidiMessage = ParsedNoteOn | ParsedNoteOff | ParsedControlChange;

const STATUS_MASK = 0xf0;
const CHANNEL_MASK = 0x0f;

export class MidiMessageParser {
  private runningStatus = 0;

  reset(): void {
    this.runningStatus = 0;
  }

  parse(data: Uint8Array): ParsedMidiMessage | null {
    if (!data || data.length === 0) return null;

    const isContinuation = data[0] < 0x80;
    let status: number;
    if (isContinuation) {
      if (this.runningStatus === 0) return null;
      status = this.runningStatus;
    } else {
      status = data[0];
    }

    const statusType = status & STATUS_MASK;
    if (statusType < 0x80 || statusType > 0xe0) return null;

    const dataOffset = isContinuation ? 0 : 1;
    if (data.length < dataOffset + 2) return null;
    this.runningStatus = status;

    const channel = status & CHANNEL_MASK;
    const data1 = data[dataOffset];
    const data2 = data[dataOffset + 1];

    switch (statusType) {
      case 0x90: {
        if (data1 > 127) return null;
        return { kind: "noteon", channel, noteNumber: data1, velocity: data2 };
      }
      case 0x80: {
        if (data1 > 127) return null;
        return { kind: "noteoff", channel, noteNumber: data1 };
      }
      case 0xb0:
        return { kind: "cc", channel, controller: data1, value: data2 };
      default:
        return null;
    }
  }
}
