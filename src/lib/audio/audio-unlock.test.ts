import { afterEach, describe, expect, it, vi } from "vitest";

const { resume, addEventListener, removeEventListener, getCtxState, setCtxState } = vi.hoisted(() => {
  const resume = vi.fn();
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  let ctxState: AudioContextState = "suspended";
  return {
    resume,
    addEventListener,
    removeEventListener,
    getCtxState: () => ctxState,
    setCtxState: (next: AudioContextState) => {
      ctxState = next;
    },
  };
});

vi.mock("tone", () => ({
  start: vi.fn(async () => undefined),
  getContext: vi.fn(() => ({
    rawContext: {
      get state() {
        return getCtxState();
      },
      resume,
      addEventListener,
      removeEventListener,
    },
  })),
}));

import * as Tone from "tone";
import { ToneAudioUnlock, verifyAudioOutput } from "./audio-unlock";

function makeUnlock() {
  const states: string[] = [];
  const unlocker = new ToneAudioUnlock((next) => states.push(next));
  return { unlocker, states };
}

describe("ToneAudioUnlock", () => {
  afterEach(() => {
    vi.clearAllMocks();
    resume.mockReset();
    setCtxState("suspended");
  });

  it("resumes a suspended context and reports running", async () => {
    resume.mockImplementation(async () => setCtxState("running"));
    const { unlocker, states } = makeUnlock();
    const result = await unlocker.unlock();
    expect(Tone.start).toHaveBeenCalled();
    expect(resume).toHaveBeenCalled();
    expect(result).toBe("running");
    expect(unlocker.getState()).toBe("running");
    expect(states).toContain("running");
  });

  it("reflects an interrupted context and recovers on the next unlock", async () => {
    resume.mockImplementation(async () => setCtxState("running"));
    const { unlocker, states } = makeUnlock();
    await unlocker.unlock();
    expect(unlocker.getState()).toBe("running");

    // Simulate the OS interrupting audio (silent switch, call, route change).
    setCtxState("interrupted");
    const listener = addEventListener.mock.calls[0][1] as () => void;
    listener();
    expect(unlocker.getState()).toBe("interrupted");

    await unlocker.unlock();
    expect(unlocker.getState()).toBe("running");
    expect(states).toContain("interrupted");
  });

  it("does not create a duplicate engine — it only touches the singleton context", async () => {
    resume.mockImplementation(async () => setCtxState("running"));
    const { unlocker } = makeUnlock();
    await unlocker.unlock();
    expect(Tone.start).toHaveBeenCalledTimes(1);
  });

  it("reports unsupported when no raw AudioContext is available", async () => {
    const { unlocker } = makeUnlock();
    vi.mocked(Tone.getContext).mockReturnValueOnce({ rawContext: null } as unknown as ReturnType<typeof Tone.getContext>);
    const result = await unlocker.unlock();
    expect(result).toBe("unsupported");
    expect(unlocker.getState()).toBe("unsupported");
  });

  it("reports locked when Tone.start() is rejected", async () => {
    const { unlocker } = makeUnlock();
    vi.mocked(Tone.start).mockRejectedValueOnce(new Error("blocked"));
    const result = await unlocker.unlock();
    expect(result).toBe("locked");
    expect(unlocker.getState()).toBe("locked");
  });

  it("returns the live context state when audio stays blocked after resume", async () => {
    // resume() mock does not flip the state to running
    const { unlocker } = makeUnlock();
    const result = await unlocker.unlock();
    expect(result).toBe("suspended");
    expect(unlocker.getState()).toBe("suspended");
  });

  it("exposes the underlying raw AudioContext used by the synth", () => {
    const { unlocker } = makeUnlock();
    const raw = unlocker.getRawContext();
    expect(raw).not.toBeNull();
    expect(typeof raw!.resume).toBe("function");
    expect(typeof raw!.state).toBe("string");
  });
});

describe("verifyAudioOutput", () => {
  it("reports an audible, connected, non-muted synth", () => {
    expect(verifyAudioOutput({ volume: { value: -8 } })).toEqual({ connected: true, muted: false, audible: true });
  });

  it("reports a muted synth as not audible", () => {
    expect(verifyAudioOutput({ volume: { value: -Infinity }, mute: true })).toEqual({ connected: true, muted: true, audible: false });
  });

  it("reports a missing synth as disconnected", () => {
    expect(verifyAudioOutput(null)).toEqual({ connected: false, muted: true, audible: false });
  });
});
