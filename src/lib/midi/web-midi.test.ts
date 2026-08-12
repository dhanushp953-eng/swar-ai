import { describe, expect, it } from "vitest";
import { makeMidiHarness, MockMidiInput } from "./midi-test-utils";
import { WebMidiController } from "./web-midi";
import type { MidiEvent, MidiNoteEvent } from "./midi-types";

function noteOnEvents(events: MidiEvent[]): MidiNoteEvent[] {
  return events.filter((event): event is MidiNoteEvent => event.type === "noteon");
}

function noteOffEvents(events: MidiEvent[]): MidiNoteEvent[] {
  return events.filter((event): event is MidiNoteEvent => event.type === "noteoff");
}

function makeController(overrides: Partial<ReturnType<typeof makeMidiHarness>["controllerDeps"]> = {}): ReturnType<typeof makeMidiHarness> {
  return makeMidiHarness(overrides);
}

describe("WebMidiController support and permission", () => {
  it("starts in permission-required state", () => {
    const harness = makeController();
    const controller = new WebMidiController(harness.controllerDeps);
    expect(controller.getState().status).toBe("permission-required");
  });

  it("reports unsupported when Web MIDI is not available", async () => {
    const controller = new WebMidiController({});
    await controller.connect();
    expect(controller.getState().status).toBe("unsupported");
    expect(controller.getState().error).toContain("not supported");
  });

  it("reports unsupported from checkSupport when no API exists", () => {
    const controller = new WebMidiController({});
    controller.checkSupport();
    expect(controller.getState().status).toBe("unsupported");
  });

  it("connects and reaches connected state with a device present", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Test Keyboard", "Acme"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    expect(controller.getState().status).toBe("connected");
    expect(controller.getState().selectedDeviceId).toBe("kb1");
    expect(controller.getState().devices.map((device) => device.id)).toEqual(["kb1"]);
  });

  it("connects but reports device-disconnected when no inputs exist", async () => {
    const harness = makeController();
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    expect(controller.getState().status).toBe("device-disconnected");
    expect(controller.getState().error).toContain("No MIDI keyboard found");
  });

  it("requests MIDI access with sysex disabled", async () => {
    const harness = makeController();
    const requestedOptions: unknown[] = [];
    const controller = new WebMidiController({
      requestMidiAccess: async (options?: { sysex?: boolean }) => {
        requestedOptions.push(options);
        return harness.access as never;
      },
    });
    await controller.connect();
    expect(requestedOptions).toEqual([{ sysex: false }]);
  });

  it("reports permission-denied when access is not allowed", async () => {
    const harness = makeController({ requestMidiAccess: async () => { throw { name: "NotAllowedError" }; } });
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    expect(controller.getState().status).toBe("permission-denied");
    expect(controller.getState().error).toContain("denied");
  });

  it("reports permission-denied for a security error", async () => {
    const harness = makeController({ requestMidiAccess: async () => { throw { name: "SecurityError" }; } });
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    expect(controller.getState().status).toBe("permission-denied");
  });

  it("reports an error state for unexpected failures", async () => {
    const harness = makeController({ requestMidiAccess: async () => { throw new Error("boom"); } });
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    expect(controller.getState().status).toBe("error");
    expect(controller.getState().error).toContain("boom");
  });

  it("ignores a second connect while already connected", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Test Keyboard"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    await controller.connect();
    expect(controller.getState().status).toBe("connected");
  });
});

describe("WebMidiController device enumeration and selection", () => {
  it("enumerates connected input devices and auto-selects the first", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One", "Acme"));
    harness.access.add(new MockMidiInput("kb2", "Keyboard Two", "Beta"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const state = controller.getState();
    expect(state.devices.map((device) => device.id)).toEqual(["kb1", "kb2"]);
    expect(state.selectedDeviceId).toBe("kb1");
  });

  it("attaches the message handler to the selected input only", async () => {
    const harness = makeController();
    const first = new MockMidiInput("kb1", "Keyboard One");
    const second = new MockMidiInput("kb2", "Keyboard Two");
    harness.access.add(first);
    harness.access.add(second);
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    expect(first.onmidimessage).not.toBeNull();
    expect(second.onmidimessage).toBeNull();
    controller.selectDevice("kb2");
    expect(first.onmidimessage).toBeNull();
    expect(second.onmidimessage).not.toBeNull();
    expect(controller.getState().selectedDeviceId).toBe("kb2");
  });

  it("ignores selecting an unknown or disconnected device", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    controller.selectDevice("ghost");
    expect(controller.getState().selectedDeviceId).toBe("kb1");
  });

  it("lists devices in the device selector state", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One", "Acme"));
    harness.access.add(new MockMidiInput("kb2", "Keyboard Two"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    expect(controller.getState().devices).toEqual([
      { id: "kb1", name: "Keyboard One", manufacturer: "Acme" },
      { id: "kb2", name: "Keyboard Two", manufacturer: null },
    ]);
  });
});

describe("WebMidiController connect and disconnect", () => {
  it("disconnects cleanly: clears handler, releases notes, returns to permission-required", async () => {
    const harness = makeController();
    const input = new MockMidiInput("kb1", "Keyboard One");
    harness.access.add(input);
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    input.sendMessage([0x90, 60, 100]);
    expect(controller.getState().heldNotes).toHaveLength(1);
    controller.disconnect();
    const state = controller.getState();
    expect(state.status).toBe("permission-required");
    expect(state.heldNotes).toHaveLength(0);
    expect(input.onmidimessage).toBeNull();
  });
});

describe("WebMidiController hot-plugging", () => {
  it("adds a newly connected device to the list", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const hot = new MockMidiInput("kb2", "Keyboard Two");
    harness.access.add(hot);
    harness.access.fireStateChange();
    expect(controller.getState().devices.map((device) => device.id)).toEqual(["kb1", "kb2"]);
  });

  it("releases all notes and enters device-disconnected when the selected device leaves", async () => {
    const harness = makeController();
    const input = new MockMidiInput("kb1", "Keyboard One");
    harness.access.add(input);
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    input.sendMessage([0x90, 60, 100]);
    input.sendMessage([0x90, 64, 90]);
    harness.access.remove("kb1");
    harness.access.fireStateChange();
    const state = controller.getState();
    expect(state.status).toBe("device-disconnected");
    expect(state.heldNotes).toHaveLength(0);
    expect(state.selectedDeviceId).toBeNull();
  });

  it("does not silently reconnect to a different device after the selected one leaves", async () => {
    const harness = makeController();
    const input = new MockMidiInput("kb1", "Keyboard One");
    harness.access.add(input);
    const other = new MockMidiInput("kb2", "Keyboard Two");
    harness.access.add(other);
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    expect(controller.getState().selectedDeviceId).toBe("kb1");
    harness.access.remove("kb1");
    harness.access.fireStateChange();
    const state = controller.getState();
    expect(state.status).toBe("device-disconnected");
    expect(state.selectedDeviceId).toBeNull();
    expect(other.onmidimessage).toBeNull();
  });
});

describe("WebMidiController message handling", () => {
  it("tracks a single held note on note-on", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const events: MidiEvent[] = [];
    controller.subscribeEvents((event) => events.push(event));
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x90, 60, 100], 1234.5);
    const state = controller.getState();
    expect(state.heldNotes).toHaveLength(1);
    expect(state.heldNotes[0]).toMatchObject({ channel: 0, noteNumber: 60, noteName: "C4", sustained: false });
    expect(state.heldNotes[0].velocity).toBeCloseTo(100 / 127);
    expect(state.heldNotes[0].timestamp).toBe(1234.5);
    expect(controller.getHeldNotes().has(60)).toBe(true);
    expect(noteOnEvents(events)).toHaveLength(1);
    expect(noteOnEvents(events)[0]).toMatchObject({ type: "noteon", channel: 0, noteNumber: 60, noteName: "C4", reason: "key" });
    expect(state.activity).toBe(1);
    expect(state.lastActivityAt).toBe(1234.5);
  });

  it("removes a held note on note-off and emits a noteoff event", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const events: MidiEvent[] = [];
    controller.subscribeEvents((event) => events.push(event));
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x90, 60, 100], 1000);
    input.sendMessage([0x80, 60, 0], 1200);
    expect(controller.getState().heldNotes).toHaveLength(0);
    expect(controller.getHeldNotes().has(60)).toBe(false);
    const offs = noteOffEvents(events);
    expect(offs).toHaveLength(1);
    expect(offs[0]).toMatchObject({ type: "noteoff", channel: 0, noteNumber: 60, reason: "key", timestamp: 1200 });
  });

  it("treats a note-on with zero velocity as a note-off", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const events: MidiEvent[] = [];
    controller.subscribeEvents((event) => events.push(event));
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x90, 60, 100]);
    input.sendMessage([0x90, 60, 0]);
    expect(controller.getState().heldNotes).toHaveLength(0);
    expect(noteOnEvents(events)).toHaveLength(1);
    expect(noteOffEvents(events)).toHaveLength(1);
  });

  it("tracks multiple simultaneous notes", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x90, 60, 100]);
    input.sendMessage([0x90, 64, 90]);
    input.sendMessage([0x90, 67, 80]);
    expect(controller.getState().heldNotes.map((note) => note.noteName).sort()).toEqual(["C4", "E4", "G4"]);
    expect(controller.getHeldNotes().size).toBe(3);
  });

  it("handles repeated note-on messages safely without duplicate events", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const events: MidiEvent[] = [];
    controller.subscribeEvents((event) => events.push(event));
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x90, 60, 100], 1000);
    input.sendMessage([0x90, 60, 120], 1100);
    expect(controller.getState().heldNotes).toHaveLength(1);
    expect(noteOnEvents(events)).toHaveLength(1);
    expect(controller.getState().heldNotes[0].velocity).toBeCloseTo(120 / 127);
    expect(controller.getState().heldNotes[0].timestamp).toBe(1100);
  });

  it("parses the MIDI channel", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x91, 60, 100]);
    expect(controller.getState().heldNotes[0].channel).toBe(1);
  });

  it("keeps channels distinct when the same note arrives on two channels", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x90, 60, 100]);
    input.sendMessage([0x91, 60, 90]);
    expect(controller.getState().heldNotes).toHaveLength(2);
    expect(controller.getHeldNotes().has(60)).toBe(true);
    input.sendMessage([0x90, 60, 0]);
    expect(controller.getState().heldNotes).toHaveLength(1);
  });

  it("normalizes velocity to a 0..1 range", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x90, 60, 127]);
    input.sendMessage([0x90, 67, 64]);
    const velocities = controller.getState().heldNotes.map((note) => note.velocity);
    expect(velocities).toEqual([1, 64 / 127]);
  });

  it("ignores invalid and unsupported messages without crashing", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const events: MidiEvent[] = [];
    controller.subscribeEvents((event) => events.push(event));
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0xf8]);
    input.sendMessage([0x90, 128, 100]);
    input.sendMessage([0xe0, 0, 64]);
    input.sendMessage([0x90, 60, 100]);
    expect(controller.getState().heldNotes).toHaveLength(1);
    expect(events.filter((event) => event.type === "noteon")).toHaveLength(1);
  });

  it("ignores note-off for notes that are not held", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const events: MidiEvent[] = [];
    controller.subscribeEvents((event) => events.push(event));
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x80, 60, 0]);
    expect(controller.getState().heldNotes).toHaveLength(0);
    expect(noteOffEvents(events)).toHaveLength(0);
  });
});

describe("WebMidiController sustain pedal", () => {
  it("sustains notes when the pedal is down and releases them on pedal up", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const events: MidiEvent[] = [];
    controller.subscribeEvents((event) => events.push(event));
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0xb0, 64, 127]);
    expect(controller.getState().sustainActive).toBe(true);
    input.sendMessage([0x90, 60, 100], 1000);
    input.sendMessage([0x80, 60, 0], 1100);
    expect(controller.getState().heldNotes).toHaveLength(1);
    expect(controller.getState().heldNotes[0].sustained).toBe(true);
    expect(noteOffEvents(events)).toHaveLength(0);
    input.sendMessage([0xb0, 64, 0], 1200);
    expect(controller.getState().sustainActive).toBe(false);
    expect(controller.getState().heldNotes).toHaveLength(0);
    const offs = noteOffEvents(events);
    expect(offs).toHaveLength(1);
    expect(offs[0]).toMatchObject({ type: "noteoff", noteNumber: 60, reason: "sustain", timestamp: 1200 });
  });

  it("keeps notes physically held after pedal release", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0xb0, 64, 127]);
    input.sendMessage([0x90, 60, 100]);
    input.sendMessage([0xb0, 64, 0]);
    expect(controller.getState().heldNotes).toHaveLength(1);
    expect(controller.getState().heldNotes[0].sustained).toBe(false);
    input.sendMessage([0x80, 60, 0]);
    expect(controller.getState().heldNotes).toHaveLength(0);
  });

  it("ignores sustain values that do not cross the pedal threshold twice", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0xb0, 64, 64]);
    expect(controller.getState().sustainActive).toBe(true);
    input.sendMessage([0xb0, 64, 100]);
    input.sendMessage([0xb0, 64, 20]);
    expect(controller.getState().sustainActive).toBe(false);
  });

  it("re-attacks a sustained note when it is pressed again", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const events: MidiEvent[] = [];
    controller.subscribeEvents((event) => events.push(event));
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0xb0, 64, 127]);
    input.sendMessage([0x90, 60, 100]);
    input.sendMessage([0x80, 60, 0]);
    input.sendMessage([0x90, 60, 100]);
    expect(noteOnEvents(events)).toHaveLength(2);
    expect(controller.getState().heldNotes).toHaveLength(1);
    expect(controller.getState().heldNotes[0].sustained).toBe(false);
  });
});

describe("WebMidiController release-all and stuck-note prevention", () => {
  it("releases every held note with the release-all reason and resets the pedal", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const events: MidiEvent[] = [];
    controller.subscribeEvents((event) => events.push(event));
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0xb0, 64, 127]);
    input.sendMessage([0x90, 60, 100]);
    input.sendMessage([0x90, 64, 90]);
    input.sendMessage([0x80, 60, 0]);
    controller.releaseAll();
    const state = controller.getState();
    expect(state.heldNotes).toHaveLength(0);
    expect(state.sustainActive).toBe(false);
    const offs = noteOffEvents(events);
    expect(offs.map((event) => event.noteNumber).sort()).toEqual([60, 64]);
    expect(offs.every((event) => event.reason === "release-all")).toBe(true);
  });

  it("releases all notes on window blur", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x90, 60, 100]);
    harness.fireBlur();
    expect(controller.getState().heldNotes).toHaveLength(0);
  });

  it("releases all notes when the page becomes hidden", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x90, 60, 100]);
    harness.fireVisibility(true);
    expect(controller.getState().heldNotes).toHaveLength(0);
  });

  it("does not release notes when the page becomes visible", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x90, 60, 100]);
    harness.fireVisibility(false);
    expect(controller.getState().heldNotes).toHaveLength(1);
  });

  it("releases all notes on destroy and cleans up listeners", async () => {
    const harness = makeController();
    const input = new MockMidiInput("kb1", "Keyboard One");
    harness.access.add(input);
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const stateListener = () => undefined;
    const eventListener = () => undefined;
    const heldListener = () => undefined;
    controller.subscribeState(stateListener);
    controller.subscribeEvents(eventListener);
    controller.subscribeHeldNotes(heldListener);
    input.sendMessage([0x90, 60, 100]);
    controller.destroy();
    expect(controller.getState().heldNotes).toHaveLength(0);
    expect(input.onmidimessage).toBeNull();
    expect(harness.access.onstatechange).toBeNull();
    expect(harness.subscriptions.blur).toHaveLength(0);
    expect(harness.subscriptions.visibility).toHaveLength(0);
    expect(() => controller.destroy()).not.toThrow();
  });

  it("detaches blur and visibility listeners on disconnect", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    expect(harness.subscriptions.blur).toHaveLength(1);
    expect(harness.subscriptions.visibility).toHaveLength(1);
    controller.disconnect();
    expect(harness.subscriptions.blur).toHaveLength(0);
    expect(harness.subscriptions.visibility).toHaveLength(0);
    await controller.connect();
    expect(harness.subscriptions.blur).toHaveLength(1);
    expect(harness.subscriptions.visibility).toHaveLength(1);
  });
});

describe("WebMidiController event stream and local-only behavior", () => {
  it("does not retain historical MIDI events after processing", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x90, 60, 100]);
    input.sendMessage([0x80, 60, 0]);
    input.sendMessage([0x90, 64, 90]);
    const state = controller.getState();
    expect(state.heldNotes).toHaveLength(1);
    expect(state.heldNotes[0].noteName).toBe("E4");
    expect(controller.getState().heldNotes.length).toBe(1);
  });

  it("notifies held-note subscribers only when the held set changes", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    const held: number[] = [];
    controller.subscribeHeldNotes(() => held.push(controller.getHeldNotes().size));
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x90, 60, 100]);
    input.sendMessage([0x90, 60, 120]);
    input.sendMessage([0x90, 64, 90]);
    input.sendMessage([0x80, 60, 0]);
    expect(held).toEqual([1, 2, 1]);
  });

  it("unsubscribes state listeners correctly", async () => {
    const harness = makeController();
    harness.access.add(new MockMidiInput("kb1", "Keyboard One"));
    const controller = new WebMidiController(harness.controllerDeps);
    await controller.connect();
    let calls = 0;
    const unsubscribe = controller.subscribeState(() => { calls += 1; });
    const input = harness.access.inputs.get("kb1")!;
    input.sendMessage([0x90, 60, 100]);
    expect(calls).toBeGreaterThan(0);
    const afterFirst = calls;
    unsubscribe();
    input.sendMessage([0x80, 60, 0]);
    expect(calls).toBe(afterFirst);
  });
});
