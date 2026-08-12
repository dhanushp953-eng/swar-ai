import { describe, expect, it } from "vitest";
import type { MicAnalysis, MicAnalyzerLike } from "./mic-analyzer";
import { MicInputController, type MicInputControllerDeps } from "./mic-input";
import type { MicNoteEvent } from "./mic-types";

const EMPTY: MicAnalysis = { level: 0, peak: 0, frequency: null, confidence: 0, midi: null, cents: null };

class ScriptedAnalyzer implements MicAnalyzerLike {
  attached = false;
  private analysis: MicAnalysis = { ...EMPTY };

  attach(): void {
    this.attached = true;
  }

  detach(): void {
    this.attached = false;
  }

  set(partial: Partial<MicAnalysis>): void {
    this.analysis = { ...EMPTY, ...partial };
  }

  analyse(): MicAnalysis {
    return { ...this.analysis };
  }
}

type FakeTrack = {
  stop: () => void;
  readyState: "live" | "ended";
  endListener: (() => void) | null;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

function makeDeps(overrides: Partial<MicInputControllerDeps> = {}) {
  const analyzer = new ScriptedAnalyzer();
  const track: FakeTrack = {
    stop: () => undefined,
    readyState: "live",
    endListener: null,
    addEventListener: (type, listener) => {
      if (type === "ended") track.endListener = listener;
    },
    removeEventListener: (type, listener) => {
      if (type === "ended" && track.endListener === listener) track.endListener = null;
    },
  };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream & { track: FakeTrack };
  (stream as { track: FakeTrack }).track = track;

  let gumCalls = 0;
  const blur: Array<() => void> = [];
  const visibility: Array<(hidden: boolean) => void> = [];
  const device: Array<() => void> = [];
  let raf: Array<(time: number) => void> = [];

  const deps: MicInputControllerDeps = {
    getUserMedia: async () => {
      gumCalls += 1;
      return stream;
    },
    requestAnimationFrame: (callback) => {
      raf.push(callback);
      return raf.length;
    },
    cancelAnimationFrame: () => undefined,
    now: () => 0,
    subscribeWindowBlur: (handler) => {
      blur.push(handler);
      return () => {
        const index = blur.indexOf(handler);
        if (index >= 0) blur.splice(index, 1);
      };
    },
    subscribeVisibilityChange: (handler) => {
      visibility.push(handler);
      return () => {
        const index = visibility.indexOf(handler);
        if (index >= 0) visibility.splice(index, 1);
      };
    },
    subscribeDeviceChange: (handler) => {
      device.push(handler);
      return () => {
        const index = device.indexOf(handler);
        if (index >= 0) device.splice(index, 1);
      };
    },
    analyzer,
    ...overrides,
  };

  return {
    deps,
    analyzer,
    stream,
    track,
    blur,
    visibility,
    device,
    getGumCalls: () => gumCalls,
    fireRaf: () => {
      const callbacks = raf;
      raf = [];
      callbacks.forEach((callback) => callback(0));
    },
  };
}

function listen(c: MicInputController): MicNoteEvent[] {
  const events: MicNoteEvent[] = [];
  c.subscribeEvents((event) => events.push(event));
  return events;
}

async function startController(deps: MicInputControllerDeps): Promise<MicInputController> {
  const controller = new MicInputController(deps);
  await controller.start();
  return controller;
}

describe("MicInputController", () => {
  it("requests permission via getUserMedia only on start() and reaches listening", async () => {
    const env = makeDeps();
    const controller = new MicInputController(env.deps);
    expect(controller.getState().status).toBe("idle");
    await controller.start();
    expect(env.getGumCalls()).toBe(1);
    expect(controller.getState().status).toBe("listening");
    expect(env.analyzer.attached).toBe(true);
  });

  it("does not start twice while already listening", async () => {
    const env = makeDeps();
    const controller = new MicInputController(env.deps);
    await controller.start();
    await controller.start();
    expect(env.getGumCalls()).toBe(1);
  });

  it("reports unsupported when getUserMedia is unavailable", async () => {
    const env = makeDeps({ getUserMedia: undefined });
    const controller = new MicInputController(env.deps);
    await controller.start();
    expect(controller.getState().status).toBe("unsupported");
  });

  it("reports permission-denied when the user denies access", async () => {
    const env = makeDeps({
      getUserMedia: async () => {
        throw { name: "NotAllowedError" };
      },
    });
    const controller = new MicInputController(env.deps);
    await controller.start();
    expect(controller.getState().status).toBe("permission-denied");
    expect(controller.getState().error).toContain("denied");
  });

  it("reports device-disconnected when no microphone exists", async () => {
    const env = makeDeps({
      getUserMedia: async () => {
        throw { name: "NotFoundError" };
      },
    });
    const controller = new MicInputController(env.deps);
    await controller.start();
    expect(controller.getState().status).toBe("device-disconnected");
  });

  it("turns confident detected frames into typed note events (mic -> scorer pipeline)", async () => {
    const env = makeDeps();
    const controller = await startController(env.deps);
    const events = listen(controller);
    env.analyzer.set({ level: 0.4, peak: 0.6, frequency: 261.63, confidence: 0.99, midi: 60, cents: 0 });

    for (let i = 0; i < 4; i += 1) controller.tick();
    expect(events.filter((e) => e.type === "noteon")).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "noteon", noteNumber: 60, noteName: "C4", channel: 1, reason: "key" });
    expect(controller.getHeldNotes().has(60)).toBe(true);

    env.analyzer.set(EMPTY);
    for (let i = 0; i < 6; i += 1) controller.tick();
    expect(events.filter((e) => e.type === "noteoff")).toHaveLength(1);
    expect(controller.getHeldNotes().size).toBe(0);
  });

  it("gates low-confidence and weak frames (no note events)", async () => {
    const env = makeDeps();
    const controller = await startController(env.deps);
    const events = listen(controller);
    env.analyzer.set({ level: 0.4, frequency: 261.63, confidence: 0.4, midi: 60, cents: 0 });
    for (let i = 0; i < 8; i += 1) controller.tick();
    env.analyzer.set({ level: 0.005, peak: 0.01, frequency: 261.63, confidence: 0.99, midi: 60, cents: 0 });
    for (let i = 0; i < 8; i += 1) controller.tick();
    expect(events).toEqual([]);
    expect(controller.getHeldNotes().size).toBe(0);
  });

  it("calibrates the noise threshold from ambient level samples", async () => {
    const env = makeDeps();
    const controller = await startController(env.deps);
    env.analyzer.set({ level: 0.1, peak: 0.2, frequency: null, confidence: 0, midi: null, cents: null });
    const promise = controller.calibrateNoise(0.05);
    for (let i = 0; i < 3; i += 1) controller.tick();
    const threshold = await promise;
    expect(threshold).toBeGreaterThan(0.1);
    expect(controller.getNoiseThreshold()).toBe(threshold);
    expect(controller.getState().calibrating).toBe(false);
  });

  it("releases held notes on window blur (stuck-note prevention)", async () => {
    const env = makeDeps();
    const controller = await startController(env.deps);
    const events = listen(controller);
    env.analyzer.set({ level: 0.4, frequency: 261.63, confidence: 0.99, midi: 60, cents: 0 });
    for (let i = 0; i < 4; i += 1) controller.tick();
    expect(controller.getHeldNotes().size).toBe(1);

    env.blur.forEach((handler) => handler());
    expect(events.filter((e) => e.type === "noteoff")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "noteoff", noteNumber: 60, reason: "release-all" });
    expect(controller.getHeldNotes().size).toBe(0);
  });

  it("reports device-disconnected when the microphone track ends", async () => {
    const env = makeDeps();
    const controller = await startController(env.deps);
    env.track.readyState = "ended";
    env.track.endListener?.();
    expect(controller.getState().status).toBe("device-disconnected");
  });

  it("reports device-disconnected on devicechange when the track is gone", async () => {
    const env = makeDeps();
    const controller = await startController(env.deps);
    env.track.readyState = "ended";
    env.device.forEach((handler) => handler());
    expect(controller.getState().status).toBe("device-disconnected");
  });

  it("stop() releases the stream, held notes, and returns to idle", async () => {
    const env = makeDeps();
    const controller = await startController(env.deps);
    const events = listen(controller);
    env.analyzer.set({ level: 0.4, frequency: 261.63, confidence: 0.99, midi: 60, cents: 0 });
    for (let i = 0; i < 4; i += 1) controller.tick();
    expect(controller.getHeldNotes().size).toBe(1);

    controller.stop();
    expect(controller.getState().status).toBe("idle");
    expect(env.analyzer.attached).toBe(false);
    expect(controller.getHeldNotes().size).toBe(0);
    expect(events.filter((e) => e.type === "noteoff")).toHaveLength(1);
  });

  it("ignores frames while not listening", () => {
    const env = makeDeps();
    const controller = new MicInputController(env.deps);
    const events = listen(controller);
    env.analyzer.set({ level: 0.4, frequency: 261.63, confidence: 0.99, midi: 60, cents: 0 });
    controller.tick();
    expect(events).toEqual([]);
  });

  it("destroy() cleans up listeners and stops audio", async () => {
    const env = makeDeps();
    const controller = await startController(env.deps);
    const stateListener = () => undefined;
    controller.subscribeState(stateListener);
    controller.destroy();
    expect(controller.getState().status).toBe("idle");
    expect(env.blur.length).toBe(0);
    expect(env.device.length).toBe(0);
  });
});
