import { describe, expect, it } from "vitest";
import { PianoVoiceController, type PianoVoiceSynthLike } from "./piano-voices";

class FakeSynth implements PianoVoiceSynthLike {
  readonly calls: Array<{ op: "attack" | "release"; note: string }> = [];
  triggerAttack(note: string): void {
    this.calls.push({ op: "attack", note });
  }
  triggerRelease(note: string): void {
    this.calls.push({ op: "release", note });
  }
  releaseAll(): void {
    this.calls.push({ op: "release", note: "ALL" });
  }

  /** Whether every attack for a pitch still has an unbalanced release. */
  openVoices(): string[] {
    const open = new Map<string, number>();
    for (const call of this.calls) {
      if (call.op === "release" && call.note === "ALL") {
        open.clear();
        continue;
      }
      const delta = call.op === "attack" ? 1 : -1;
      open.set(call.note, (open.get(call.note) ?? 0) + delta);
    }
    return Array.from(open.entries())
      .filter(([, balance]) => balance !== 0)
      .map(([note, balance]) => `${note}:${balance}`);
  }
}

class CountingSynth implements PianoVoiceSynthLike {
  open = 0;
  maxOpen = 0;
  triggerAttack(): void {
    this.open += 1;
    if (this.open > this.maxOpen) this.maxOpen = this.open;
  }
  triggerRelease(): void {
    this.open -= 1;
  }
  releaseAll(): void {
    this.open = 0;
  }
}

describe("PianoVoiceController", () => {
  it("attacks on press and releases on release (balanced voices)", () => {
    const synth = new FakeSynth();
    const voices = new PianoVoiceController(synth);
    expect(voices.press("C4")).toBe(true);
    voices.attack("C4");
    expect(voices.getActiveNotes().has("C4")).toBe(true);
    voices.release("C4");
    expect(voices.getActiveNotes().has("C4")).toBe(false);
    expect(synth.calls).toEqual([
      { op: "attack", note: "C4" },
      { op: "release", note: "C4" },
    ]);
    expect(synth.openVoices()).toEqual([]);
  });

  it("ignores duplicate presses while the same note is sounding (no double voice)", () => {
    const synth = new FakeSynth();
    const voices = new PianoVoiceController(synth);
    expect(voices.press("C4")).toBe(true);
    expect(voices.press("C4")).toBe(false);
    voices.attack("C4");
    voices.attack("C4");
    expect(synth.calls.filter((call) => call.op === "attack")).toHaveLength(1);
    voices.release("C4");
    expect(synth.openVoices()).toEqual([]);
  });

  it("a release before the deferred attack cancels the late attack (async race)", () => {
    const synth = new FakeSynth();
    const voices = new PianoVoiceController(synth);
    voices.press("E4");
    // user releases while Tone.start() is still resolving
    voices.release("E4");
    expect(voices.getActiveNotes().has("E4")).toBe(false);
    voices.attack("E4"); // resolves later
    expect(synth.calls).toEqual([]);
    expect(voices.getActiveNotes().size).toBe(0);
    expect(synth.openVoices()).toEqual([]);
  });

  it("releaseAll after a late attack releases the voice (stuck-note prevention)", () => {
    const synth = new FakeSynth();
    const voices = new PianoVoiceController(synth);
    voices.press("G4");
    voices.attack("G4");
    voices.releaseAll();
    expect(synth.calls).toEqual([
      { op: "attack", note: "G4" },
      { op: "release", note: "G4" },
    ]);
    expect(voices.getActiveNotes().size).toBe(0);
    expect(synth.openVoices()).toEqual([]);
  });

  it("sustain delays release while enabled and releases sustained notes when disabled", () => {
    const synth = new FakeSynth();
    const voices = new PianoVoiceController(synth, { sustain: true });
    voices.press("A4");
    voices.attack("A4");
    voices.release("A4"); // key up, pedal on
    expect(synth.calls).toEqual([{ op: "attack", note: "A4" }]);
    expect(voices.getActiveNotes().has("A4")).toBe(true);

    voices.setSustain(false);
    expect(synth.calls).toEqual([
      { op: "attack", note: "A4" },
      { op: "release", note: "A4" },
    ]);
    expect(voices.getActiveNotes().size).toBe(0);
    expect(synth.openVoices()).toEqual([]);
  });

  it("leaves a physically held note ringing when sustain is disabled", () => {
    const synth = new FakeSynth();
    const voices = new PianoVoiceController(synth, { sustain: true });
    voices.press("C5");
    voices.attack("C5");
    // note is still held (not released), pedal lifted -> stays sounding
    voices.setSustain(false);
    expect(synth.calls).toEqual([{ op: "attack", note: "C5" }]);
    voices.release("C5");
    expect(synth.openVoices()).toEqual([]);
  });

  it("re-pressing a sustained note never stacks a second voice", () => {
    const synth = new FakeSynth();
    const voices = new PianoVoiceController(synth, { sustain: true });
    voices.press("D4");
    voices.attack("D4");
    voices.release("D4"); // sustained
    expect(voices.press("D4")).toBe(false); // re-press while still sounding
    voices.attack("D4");
    voices.release("D4"); // still ringing (sustain), key lifted again
    voices.setSustain(false);
    expect(synth.openVoices()).toEqual([]);
  });

  it("releaseAll clears the active snapshot and notifies subscribers", () => {
    const synth = new FakeSynth();
    const voices = new PianoVoiceController(synth);
    let snapshot: ReadonlySet<string> = voices.getActiveNotes();
    voices.subscribe(() => {
      snapshot = voices.getActiveNotes();
    });
    voices.press("F4");
    voices.attack("F4");
    expect(voices.getActiveNotes().has("F4")).toBe(true);
    voices.releaseAll();
    expect(voices.getActiveNotes().size).toBe(0);
    expect(snapshot.size).toBe(0);
    expect(synth.openVoices()).toEqual([]);
  });

  it("never leaves a voice open after pause-style cleanup of multiple notes", () => {
    const synth = new FakeSynth();
    const voices = new PianoVoiceController(synth);
    for (const note of ["C4", "E4", "G4"]) {
      voices.press(note);
      voices.attack(note);
      // one is released, one stays held, one gets swept by releaseAll
    }
    voices.release("E4");
    voices.releaseAll();
    const attacks = synth.calls.filter((call) => call.op === "attack").map((call) => call.note);
    const releases = synth.calls.filter((call) => call.op === "release").map((call) => call.note);
    expect(attacks.length).toBe(3);
    expect(releases).toEqual(expect.arrayContaining(["C4", "E4", "G4"]));
    expect(synth.openVoices()).toEqual([]);
  });

  it("setSynth releases every voice on the old engine before swapping", () => {
    const oldSynth = new FakeSynth();
    const nextSynth = new FakeSynth();
    const voices = new PianoVoiceController(oldSynth);
    voices.press("B4");
    voices.attack("B4");
    voices.setSynth(nextSynth);
    expect(oldSynth.openVoices()).toEqual([]);
    expect(voices.getActiveNotes().size).toBe(0);
    voices.press("B4");
    voices.attack("B4");
    voices.release("B4");
    expect(nextSynth.openVoices()).toEqual([]);
  });

  it("bounds polyphony to 16 voices under 1,000 rapid note presses", () => {
    const synth = new CountingSynth();
    const voices = new PianoVoiceController(synth, { maxPolyphony: 16 });
    const notes = [
      "C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5", "E5",
      "F5", "G5", "A5", "B5", "C6", "D6", "E6", "F6", "G6", "A6",
    ];
    for (let i = 0; i < 1000; i++) {
      const note = notes[i % notes.length];
      voices.press(note);
      voices.attack(note);
    }
    // The controller steals the oldest voice whenever the limit is reached, so
    // the synth never accumulates more than 16 simultaneous oscillators.
    expect(synth.maxOpen).toBe(16);
    voices.releaseAll();
    expect(synth.open).toBe(0);
  });

  it("bounds polyphony to 16 even with sustain holding every note", () => {
    const synth = new CountingSynth();
    const voices = new PianoVoiceController(synth, { sustain: true, maxPolyphony: 16 });
    const notes = [
      "C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5", "E5",
      "F5", "G5", "A5", "B5", "C6", "D6", "E6", "F6", "G6", "A6",
    ];
    for (let i = 0; i < 1000; i++) {
      const note = notes[i % notes.length];
      voices.press(note);
      voices.attack(note);
      voices.release(note); // key up, but pedal is down -> voice stays held
    }
    expect(synth.maxOpen).toBeLessThanOrEqual(16);
    voices.setSustain(false); // pedal lifts -> every sustained voice releases
    expect(synth.open).toBe(0);
  });
});
