import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { MidiKeyboardPanel } from "./MidiKeyboardPanel";
import { WebMidiController } from "@/lib/midi/web-midi";
import { makeMidiHarness, MockMidiInput } from "@/lib/midi/midi-test-utils";
import type { MidiControllerDeps } from "@/lib/midi/web-midi";

function renderPanel(controller: WebMidiController): string {
  return renderToString(<MidiKeyboardPanel controller={controller} />).replace(/<!--[\s\S]*?-->/g, "");
}

function makeController(overrides: Partial<MidiControllerDeps> = {}) {
  const harness = makeMidiHarness(overrides);
  return { controller: new WebMidiController(harness.controllerDeps), harness };
}

describe("MidiKeyboardPanel", () => {
  it("shows the permission-required state before connecting", () => {
    const { controller } = makeController();
    const html = renderPanel(controller);
    expect(html).toContain("MIDI keyboard");
    expect(html).toContain("Permission required");
    expect(html).toContain("Connect MIDI keyboard");
    expect(html).toContain("stays in your browser");
  });

  it("explains unsupported browsers without offering to connect", async () => {
    const { controller } = makeController({ requestMidiAccess: undefined });
    await controller.connect();
    const html = renderPanel(controller);
    expect(html).toContain("Unsupported");
    expect(html).toContain("Web MIDI is not supported");
    expect(html).not.toContain("Connect MIDI keyboard");
  });

  it("surfaces permission-denied with recovery guidance", async () => {
    const { controller } = makeController({ requestMidiAccess: async () => { throw { name: "NotAllowedError" }; } });
    await controller.connect();
    const html = renderPanel(controller);
    expect(html).toContain("Permission denied");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Allow MIDI for this site");
  });

  it("shows connecting while the permission request is pending", () => {
    const { controller } = makeController({ requestMidiAccess: () => new Promise<never>(() => {}) });
    void controller.connect();
    const html = renderPanel(controller);
    expect(html).toContain("Connecting");
  });

  it("prompts for a device when MIDI is available but empty", async () => {
    const { controller } = makeController();
    await controller.connect();
    const html = renderPanel(controller);
    expect(html).toContain("No device");
    expect(html).toContain("No MIDI keyboard found");
    expect(html).toContain("Connect MIDI keyboard");
  });

  it("renders connected state with devices, controls, and held notes", async () => {
    const { controller, harness } = makeController();
    harness.access.add(new MockMidiInput("kb1", "KB-2000", "Alesis"));
    await controller.connect();
    harness.access.inputs.get("kb1")!.sendMessage([0x90, 60, 79]);
    const html = renderPanel(controller);
    expect(html).toContain("Connected");
    expect(html).toContain("Alesis");
    expect(html).toContain("KB-2000");
    expect(html).toContain("C4");
    expect(html).toContain("vel 79");
    expect(html).toContain("Held notes");
    expect(html).toContain("Release all notes");
    expect(html).toContain("Disconnect");
    expect(html).toContain("Sustain pedal off");
  });

  it("indicates when the sustain pedal is held", async () => {
    const { controller, harness } = makeController();
    harness.access.add(new MockMidiInput("kb1", "KB-2000"));
    await controller.connect();
    harness.access.inputs.get("kb1")!.sendMessage([0xb0, 64, 127]);
    const html = renderPanel(controller);
    expect(html).toContain("Sustain pedal on");
  });

  it("exposes accessible landmarks and labeled controls", async () => {
    const { controller, harness } = makeController();
    harness.access.add(new MockMidiInput("kb1", "KB-2000"));
    await controller.connect();
    const html = renderPanel(controller);
    expect(html).toContain('aria-labelledby="midi-title"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="MIDI input device"');
  });
});
