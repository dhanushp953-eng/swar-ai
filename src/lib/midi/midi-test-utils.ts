import type { MidiAccessLike, MidiControllerDeps, MidiInputLike } from "./web-midi";

export class MockMidiInput {
  id: string;
  name: string;
  manufacturer: string;
  state: "connected" | "disconnected";
  connection: "open" | "closed" | "pending";
  onmidimessage: MidiInputLike["onmidimessage"] = null;

  constructor(id: string, name: string, manufacturer = "", state: "connected" | "disconnected" = "connected") {
    this.id = id;
    this.name = name;
    this.manufacturer = manufacturer;
    this.state = state;
    this.connection = state === "connected" ? "open" : "pending";
  }

  sendMessage(data: number[], timeStamp = 1000): void {
    this.onmidimessage?.({ data: Uint8Array.from(data), timeStamp });
  }

  setConnected(state: "connected" | "disconnected"): void {
    this.state = state;
    this.connection = state === "connected" ? "open" : "closed";
  }
}

export class MockMidiAccess {
  inputs = new Map<string, MockMidiInput>();
  onstatechange: (() => void) | null = null;

  add(input: MockMidiInput): void {
    this.inputs.set(input.id, input);
  }

  remove(id: string): void {
    this.inputs.delete(id);
  }

  fireStateChange(): void {
    this.onstatechange?.();
  }
}

export type CapturedSubscriptions = {
  blur: Array<() => void>;
  visibility: Array<(hidden: boolean) => void>;
};

export type MidiTestHarness = {
  controllerDeps: MidiControllerDeps;
  access: MockMidiAccess;
  subscriptions: CapturedSubscriptions;
  fireBlur: () => void;
  fireVisibility: (hidden: boolean) => void;
};

export function makeMidiHarness(overrides: Partial<MidiControllerDeps> = {}): MidiTestHarness {
  const access = new MockMidiAccess();
  const subscriptions: CapturedSubscriptions = { blur: [], visibility: [] };
  const deps: MidiControllerDeps = {
    requestMidiAccess: async () => access as unknown as MidiAccessLike,
    now: () => 5000,
    subscribeWindowBlur: (handler) => {
      subscriptions.blur.push(handler);
      return () => {
        subscriptions.blur = subscriptions.blur.filter((item) => item !== handler);
      };
    },
    subscribeVisibilityChange: (handler) => {
      subscriptions.visibility.push(handler);
      return () => {
        subscriptions.visibility = subscriptions.visibility.filter((item) => item !== handler);
      };
    },
    ...overrides,
  };
  return {
    controllerDeps: deps,
    access,
    subscriptions,
    fireBlur: () => subscriptions.blur.forEach((handler) => handler()),
    fireVisibility: (hidden) => subscriptions.visibility.forEach((handler) => handler(hidden)),
  };
}
