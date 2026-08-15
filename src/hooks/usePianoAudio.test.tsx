// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// Shared, mutable state for the fakes so the tone mock and the test can observe
// how many synth graphs are actually built.
const { getRawContextMock, rawCtx, synthInstances } = vi.hoisted(() => {
  const rawCtx = {
    state: "running" as AudioContextState,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const getRawContextMock = vi.fn(() => rawCtx);
  const synthInstances: Array<{
    disposed: boolean;
    volume: { value: number };
    context: { rawContext: unknown };
    set: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    toDestination: ReturnType<typeof vi.fn>;
    triggerAttack: ReturnType<typeof vi.fn>;
    triggerRelease: ReturnType<typeof vi.fn>;
    triggerAttackRelease: ReturnType<typeof vi.fn>;
    releaseAll: ReturnType<typeof vi.fn>;
  }> = [];
  return { getRawContextMock, rawCtx, synthInstances };
});

vi.mock("tone", () => {
  class FakeSynth {
    disposed = false;
    volume = { value: 0 };
    context = { rawContext: rawCtx };
    set = vi.fn();
    disconnect = vi.fn();
    dispose = vi.fn(() => {
      this.disposed = true;
    });
    toDestination = vi.fn(() => this);
    triggerAttack = vi.fn();
    triggerRelease = vi.fn();
    triggerAttackRelease = vi.fn();
    releaseAll = vi.fn();
    constructor() {
      synthInstances.push(this);
    }
  }
  return {
    PolySynth: FakeSynth,
    Synth: class {},
    getContext: vi.fn(() => ({ rawContext: rawCtx })),
    getDestination: vi.fn(() => ({})),
  };
});

vi.mock("@/lib/audio/audio-unlock", () => ({
  useToneAudioUnlock: vi.fn(() => ({
    state: "running",
    unlock: vi.fn(async () => "running"),
    getRawContext: getRawContextMock,
  })),
}));

import { usePianoAudio } from "./usePianoAudio";

const flush = () => act(async () => {
  await Promise.resolve();
});

afterEach(() => {
  synthInstances.length = 0;
  vi.clearAllMocks();
  getRawContextMock.mockReturnValue(rawCtx);
});

describe("usePianoAudio silent-after-inactivity recovery", () => {
  it("does not rebuild a healthy synth on repeated presses", async () => {
    const { result } = renderHook(() => usePianoAudio());
    await act(async () => {
      result.current.playNote("C4");
    });
    await flush();
    await act(async () => {
      result.current.playNote("E4");
    });
    await flush();

    expect(synthInstances.length).toBe(1);
    expect(synthInstances[0].triggerAttack).toHaveBeenCalledWith("E4");
    expect(synthInstances[0].dispose).not.toHaveBeenCalled();
  });

  it("recreates the synth on the next press after a disconnect (raw context still running)", async () => {
    const { result } = renderHook(() => usePianoAudio());
    await act(async () => {
      result.current.playNote("C4");
    });
    await flush();
    expect(synthInstances.length).toBe(1);

    // Simulate the OS tearing down the audio route (focus/visibility/pageshow)
    // while the AudioContext itself is still running.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await act(async () => {
      result.current.playNote("E4");
    });
    await flush();

    expect(synthInstances.length).toBe(2);
    expect(synthInstances[0].dispose).toHaveBeenCalled();
    expect(synthInstances[1].triggerAttack).toHaveBeenCalledWith("E4");
  });

  it("rebuilds when the synth's context no longer matches the live context", async () => {
    const { result } = renderHook(() => usePianoAudio());
    await act(async () => {
      result.current.playNote("C4");
    });
    await flush();
    expect(synthInstances.length).toBe(1);

    // Live context object changes (an OS audio reset) but stays running.
    getRawContextMock.mockReturnValue({
      state: "running",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    await act(async () => {
      result.current.playNote("E4");
    });
    await flush();

    expect(synthInstances.length).toBe(2);
    expect(synthInstances[1].triggerAttack).toHaveBeenCalledWith("E4");
  });
});
