import { MidiMessageParser, midiNumberToNoteName, normalizeVelocity } from "./midi-notes";
import type { MidiConnectionState, MidiConnectionStatus, MidiDeviceInfo, MidiEvent, MidiHeldNote } from "./midi-types";

export type MidiInputLike = {
  id: string;
  name: string;
  manufacturer: string;
  state: "connected" | "disconnected";
  connection: "open" | "closed" | "pending";
  onmidimessage: ((event: MidiMessageLike) => void) | null;
};

export type MidiAccessLike = {
  inputs: ReadonlyMap<string, MidiInputLike> | Map<string, MidiInputLike>;
  onstatechange: (() => void) | null;
};

export type MidiMessageLike = {
  data: Uint8Array;
  timeStamp?: number;
};

export type MidiControllerDeps = {
  requestMidiAccess?: (options?: { sysex?: boolean }) => Promise<MidiAccessLike>;
  now?: () => number;
  subscribeWindowBlur?: (handler: () => void) => () => void;
  subscribeVisibilityChange?: (handler: (hidden: boolean) => void) => () => void;
};

const noteKey = (channel: number, noteNumber: number) => `${channel}:${noteNumber}`;
const noteNumberFromKey = (key: string) => Number(key.split(":")[1]);

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export class WebMidiController {
  private readonly deps: MidiControllerDeps;
  private readonly parser = new MidiMessageParser();

  private access: MidiAccessLike | null = null;
  private inputsById = new Map<string, MidiInputLike>();
  private selectedInput: MidiInputLike | null = null;

  private status: MidiConnectionStatus = "permission-required";
  private error: string | null = null;
  private stateSnapshot: MidiConnectionState;
  private devices: MidiDeviceInfo[] = [];

  private heldNotes = new Map<string, MidiHeldNote>();
  private heldNoteNumbers = new Set<number>();
  private sustainActive = false;
  private activityCounter = 0;
  private lastActivityAt: number | null = null;

  private stateListeners = new Set<() => void>();
  private heldListeners = new Set<() => void>();
  private eventListeners = new Set<(event: MidiEvent) => void>();
  private cleanupFns: Array<() => void> = [];
  private destroyed = false;

  constructor(deps: MidiControllerDeps) {
    this.deps = deps;
    this.stateSnapshot = {
      status: this.status,
      devices: [],
      selectedDeviceId: null,
      heldNotes: [],
      sustainActive: false,
      activity: 0,
      lastActivityAt: null,
      error: null,
    };
  }

  getState = (): MidiConnectionState => this.stateSnapshot;

  getHeldNotes = (): ReadonlySet<number> => this.heldNoteNumbers;

  subscribeState = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  };

  subscribeHeldNotes = (listener: () => void): (() => void) => {
    this.heldListeners.add(listener);
    return () => {
      this.heldListeners.delete(listener);
    };
  };

  subscribeEvents = (listener: (event: MidiEvent) => void): (() => void) => {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  };

  checkSupport(): void {
    if (this.destroyed) return;
    if (!this.deps.requestMidiAccess) {
      this.setStatus("unsupported", "Web MIDI is not supported in this browser.");
    }
  }

  async connect(): Promise<void> {
    if (this.destroyed) return;
    const request = this.deps.requestMidiAccess;
    if (!request) {
      this.setStatus("unsupported", "Web MIDI is not supported in this browser.");
      return;
    }
    if (this.access || this.status === "connecting" || this.status === "connected") return;
    this.setStatus("connecting");
    try {
      const access = await request({ sysex: false });
      if (this.destroyed) return;
      this.access = access;
      access.onstatechange = () => this.handleStateChange();
      this.attachLifecycleListeners();
      this.refreshDevices();
      this.refreshStatus();
    } catch (requestError) {
      if (this.destroyed) return;
      if (isPermissionError(requestError)) {
        this.setStatus("permission-denied", "MIDI access was denied. Allow MIDI for this site in your browser and try again.");
      } else {
        this.setStatus("error", `Could not connect to MIDI: ${readErrorMessage(requestError)}`);
      }
    }
  }

  disconnect(): void {
    if (this.destroyed) return;
    this.detachLifecycleListeners();
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.closeInput();
    this.releaseAll();
    this.inputsById.clear();
    this.devices = [];
    this.parser.reset();
    this.setStatus("permission-required");
  }

  selectDevice(id: string | null): void {
    if (this.destroyed || !this.access || id === null) return;
    const input = this.inputsById.get(id);
    if (!input || input.state !== "connected") return;
    this.closeInput();
    this.openInput(input);
    this.refreshStatus();
  }

  refresh(): void {
    if (this.destroyed || !this.access) return;
    this.refreshDevices();
    this.refreshStatus();
  }

  releaseAll(): void {
    const notes = Array.from(this.heldNotes.values());
    this.heldNotes.clear();
    this.updateHeldSnapshot();
    const timestamp = this.now();
    if (this.sustainActive) {
      this.sustainActive = false;
      this.emitSustain(false, timestamp);
    }
    notes.forEach((note) => {
      this.emitNote({ type: "noteoff", channel: note.channel, noteNumber: note.noteNumber, noteName: note.noteName, velocity: note.velocity, timestamp, reason: "release-all" });
    });
    this.emitState();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.detachLifecycleListeners();
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.closeInput();
    this.releaseAll();
    this.inputsById.clear();
    this.devices = [];
    this.stateListeners.clear();
    this.heldListeners.clear();
    this.eventListeners.clear();
  }

  private handleStateChange(): void {
    if (this.destroyed || !this.access) return;
    this.refreshDevices();
    this.refreshStatus();
  }

  private refreshDevices(): void {
    const nextInputs = new Map<string, MidiInputLike>();
    this.access?.inputs.forEach((input) => nextInputs.set(input.id, input));
    this.inputsById = nextInputs;
    this.devices = Array.from(nextInputs.values())
      .filter((input) => input.state === "connected")
      .map(toDeviceInfo);

    const selectedId = this.selectedInput?.id ?? null;
    const selectedStillConnected = selectedId !== null && this.devices.some((device) => device.id === selectedId);
    if (selectedId !== null && !selectedStillConnected) {
      this.closeInput();
      this.releaseAll();
      return;
    }
    if (selectedId === null && this.devices.length > 0) {
      const first = nextInputs.get(this.devices[0].id);
      if (first && first.state === "connected") this.openInput(first);
    }
  }

  private refreshStatus(): void {
    if (this.selectedInput) {
      this.setStatus("connected");
      return;
    }
    if (this.access) {
      this.setStatus("device-disconnected", this.devices.length > 0 ? "No MIDI input device is selected." : "No MIDI keyboard found. Connect one and click Refresh.");
      return;
    }
    this.setStatus("permission-required");
  }

  private openInput(input: MidiInputLike): void {
    this.selectedInput = input;
    input.onmidimessage = (event) => this.handleMessage(event);
  }

  private closeInput(): void {
    if (this.selectedInput) this.selectedInput.onmidimessage = null;
    this.selectedInput = null;
  }

  private attachLifecycleListeners(): void {
    if (this.cleanupFns.length > 0) return;
    const unsubscribeBlur = this.deps.subscribeWindowBlur?.(() => this.releaseAll());
    const unsubscribeVisibility = this.deps.subscribeVisibilityChange?.((hidden) => {
      if (hidden) this.releaseAll();
    });
    if (unsubscribeBlur) this.cleanupFns.push(unsubscribeBlur);
    if (unsubscribeVisibility) this.cleanupFns.push(unsubscribeVisibility);
  }

  private detachLifecycleListeners(): void {
    this.cleanupFns.forEach((unsubscribe) => unsubscribe());
    this.cleanupFns = [];
  }

  private handleMessage(event: MidiMessageLike): void {
    const message = this.parser.parse(event.data);
    if (!message) return;
    const timestamp = typeof event.timeStamp === "number" && Number.isFinite(event.timeStamp) ? event.timeStamp : this.now();
    this.activityCounter += 1;
    this.lastActivityAt = timestamp;
    switch (message.kind) {
      case "noteon":
        if (message.velocity <= 0) this.handleNoteOff(message.channel, message.noteNumber, timestamp);
        else this.handleNoteOn(message.channel, message.noteNumber, message.velocity, timestamp);
        break;
      case "noteoff":
        this.handleNoteOff(message.channel, message.noteNumber, timestamp);
        break;
      case "cc":
        this.handleControlChange(message.controller, message.value, timestamp);
        break;
    }
    this.emitState();
  }

  private handleNoteOn(channel: number, noteNumber: number, rawVelocity: number, timestamp: number): void {
    if (noteNumber < 0 || noteNumber > 127) return;
    const velocity = normalizeVelocity(rawVelocity);
    const key = noteKey(channel, noteNumber);
    const existing = this.heldNotes.get(key);
    if (existing) {
      if (existing.sustained) {
        this.heldNotes.delete(key);
      } else {
        this.heldNotes.set(key, { ...existing, velocity, timestamp });
        this.updateHeldSnapshot();
        return;
      }
    }
    const noteName = midiNumberToNoteName(noteNumber);
    this.heldNotes.set(key, { channel, noteNumber, noteName, velocity, timestamp, sustained: false });
    this.updateHeldSnapshot();
    this.emitNote({ type: "noteon", channel, noteNumber, noteName, velocity, timestamp, reason: "key" });
  }

  private handleNoteOff(channel: number, noteNumber: number, timestamp: number): void {
    const key = noteKey(channel, noteNumber);
    const existing = this.heldNotes.get(key);
    if (!existing) return;
    if (this.sustainActive) {
      if (!existing.sustained) {
        this.heldNotes.set(key, { ...existing, sustained: true });
        this.updateHeldSnapshot();
      }
      return;
    }
    this.heldNotes.delete(key);
    this.updateHeldSnapshot();
    this.emitNote({ type: "noteoff", channel, noteNumber, noteName: existing.noteName, velocity: existing.velocity, timestamp, reason: "key" });
  }

  private handleControlChange(controller: number, value: number, timestamp: number): void {
    if (controller !== 64) return;
    const active = value >= 64;
    if (active === this.sustainActive) return;
    this.sustainActive = active;
    this.emitSustain(active, timestamp);
    if (!active) {
      const sustained = Array.from(this.heldNotes.values()).filter((note) => note.sustained);
      sustained.forEach((note) => {
        this.heldNotes.delete(noteKey(note.channel, note.noteNumber));
        this.emitNote({ type: "noteoff", channel: note.channel, noteNumber: note.noteNumber, noteName: note.noteName, velocity: note.velocity, timestamp, reason: "sustain" });
      });
      this.updateHeldSnapshot();
    }
  }

  private updateHeldSnapshot(): void {
    const next = new Set(Array.from(this.heldNotes.keys()).map(noteNumberFromKey));
    if (setsEqual(next, this.heldNoteNumbers)) return;
    this.heldNoteNumbers = next;
    this.heldListeners.forEach((listener) => listener());
  }

  private emitNote(event: MidiNoteEventFromService): void {
    this.eventListeners.forEach((listener) => listener(event));
  }

  private emitSustain(active: boolean, timestamp: number): void {
    this.eventListeners.forEach((listener) => listener({ type: "sustain", active, timestamp }));
  }

  private emitState(): void {
    this.stateSnapshot = {
      status: this.status,
      devices: [...this.devices],
      selectedDeviceId: this.selectedInput?.id ?? null,
      heldNotes: Array.from(this.heldNotes.values()),
      sustainActive: this.sustainActive,
      activity: this.activityCounter,
      lastActivityAt: this.lastActivityAt,
      error: this.error,
    };
    this.stateListeners.forEach((listener) => listener());
  }

  private setStatus(status: MidiConnectionStatus, error?: string | null): void {
    this.status = status;
    if (error !== undefined) this.error = error;
    this.emitState();
  }

  private now(): number {
    if (this.deps.now) return this.deps.now();
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  }
}

type MidiNoteEventFromService = Extract<MidiEvent, { type: "noteon" | "noteoff" }>;

function toDeviceInfo(input: MidiInputLike): MidiDeviceInfo {
  return { id: input.id, name: input.name || "Unnamed MIDI device", manufacturer: input.manufacturer || null };
}

function isPermissionError(error: unknown): boolean {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  return name === "NotAllowedError" || name === "SecurityError";
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown error";
}

type NavigatorWithMidi = {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<unknown>;
};

export function createMidiPlatform(): MidiControllerDeps {
  const nav = typeof navigator !== "undefined" ? (navigator as NavigatorWithMidi) : undefined;
  const midiRequest = nav && typeof nav.requestMIDIAccess === "function" ? nav.requestMIDIAccess.bind(nav) : undefined;
  const requestMidiAccess = midiRequest
    ? () => midiRequest({ sysex: false }).then((access) => access as unknown as MidiAccessLike)
    : undefined;
  return {
    requestMidiAccess,
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
  };
}

let singleton: WebMidiController | null = null;

export function getMidiController(): WebMidiController {
  if (!singleton) singleton = new WebMidiController(createMidiPlatform());
  return singleton;
}
