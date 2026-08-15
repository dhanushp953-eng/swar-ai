// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// Track every NativePianoSynth instance the hook builds so we can assert the
// engine is created once and only recreated when the AudioContext changes.
const { getRawContextMock, rawCtx, rawCtx2, engineInstances } = vi.hoisted(() => {
  const rawCtx = {
    state: "running" as AudioContextState,
    destination: {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const rawCtx2 = {
    state: "running" as AudioContextState,
    destination: {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const engineInstances: Array<{
    triggerAttack: ReturnType<typeof vi.fn>;
    triggerRelease: ReturnType<typeof vi.fn>;
    releaseAll: ReturnType<typeof vi.fn>;
    setVolume: ReturnType<typeof vi.fn>;
    setInstrument: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    options: unknown;
  }> = [];
  const getRawContextMock = vi.fn(() => rawCtx);
  return { getRawContextMock, rawCtx, rawCtx2, engineInstances };
});

vi.mock("@/lib/audio/native-piano-synth", () => ({
  NativePianoSynth: class {
    triggerAttack = vi.fn();
    triggerRelease = vi.fn();
    releaseAll = vi.fn();
    setVolume = vi.fn();
    setInstrument = vi.fn();
    dispose = vi.fn();
    options: unknown;
    constructor(_ctx: unknown, _destination: unknown, options: unknown) {
      this.options = options;
      engineInstances.push(this);
    }
  },
  noteToFrequency: () => 440,
}));

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
  engineInstances.length = 0;
  vi.clearAllMocks();
  getRawContextMock.mockReturnValue(rawCtx);
});

describe("usePianoAudio native engine", () => {
  it("plays a note through the native engine", async () => {
    const { result } = renderHook(() => usePianoAudio());
    await act(async () => {
      result.current.playNote("C4");
    });
    await flush();

    expect(engineInstances.length).toBe(1);
    expect(engineInstances[0].triggerAttack).toHaveBeenCalledWith("C4");
  });

  it("supports multiple simultaneous notes (polyphony)", async () => {
    const { result } = renderHook(() => usePianoAudio());
    await act(async () => {
      result.current.playNote("C4");
    });
    await act(async () => {
      result.current.playNote("E4");
    });
    await flush();

    // One engine, two independent voices attacked.
    expect(engineInstances.length).toBe(1);
    expect(engineInstances[0].triggerAttack).toHaveBeenCalledWith("C4");
    expect(engineInstances[0].triggerAttack).toHaveBeenCalledWith("E4");

    // Releasing one note must not release the other.
    await act(async () => {
      result.current.stopNote("C4");
    });
    expect(engineInstances[0].triggerRelease).toHaveBeenCalledWith("C4");
    expect(engineInstances[0].triggerRelease).not.toHaveBeenCalledWith("E4");
  });

  it("does not create a duplicate engine across many presses", async () => {
    const { result } = renderHook(() => usePianoAudio());
    for (let i = 0; i < 20; i++) {
      const note = `C${4 + (i % 3)}`;
      await act(async () => {
        result.current.playNote(note);
      });
      await act(async () => {
        result.current.stopNote(note);
      });
    }
    await flush();
    expect(engineInstances.length).toBe(1);
  });

  it("releases every voice on Release All", async () => {
    const { result } = renderHook(() => usePianoAudio());
    await act(async () => {
      result.current.playNote("C4");
      result.current.playNote("E4");
      result.current.playNote("G4");
    });
    await flush();
    await act(async () => {
      result.current.releaseAllNotes();
    });
    expect(engineInstances[0].triggerRelease).toHaveBeenCalledWith("C4");
    expect(engineInstances[0].triggerRelease).toHaveBeenCalledWith("E4");
    expect(engineInstances[0].triggerRelease).toHaveBeenCalledWith("G4");
  });

  it("rebuilds the engine when the AudioContext changes underneath it", async () => {
    const { result } = renderHook(() => usePianoAudio());
    await act(async () => {
      result.current.playNote("C4");
    });
    await flush();
    expect(engineInstances.length).toBe(1);

    // OS swaps the audio context (an audio-route reset).
    getRawContextMock.mockReturnValue(rawCtx2);

    await act(async () => {
      result.current.playNote("E4");
    });
    await flush();

    // A second, distinct engine is created and the new note played on it.
    expect(engineInstances.length).toBe(2);
    expect(engineInstances[1].triggerAttack).toHaveBeenCalledWith("E4");
  });

  it("applies volume and instrument to the engine without rebuilding it", async () => {
    const { result } = renderHook(() => usePianoAudio());
    await act(async () => {
      result.current.playNote("C4");
    });
    await flush();
    expect(engineInstances.length).toBe(1);

    await act(async () => {
      result.current.setVolume(-3);
      result.current.setInstrument("bell");
    });

    expect(engineInstances.length).toBe(1);
    expect(engineInstances[0].setVolume).toHaveBeenCalledWith(-3);
    expect(engineInstances[0].setInstrument).toHaveBeenCalledWith("bell");
  });

  it("tears the engine down on unmount", async () => {
    const { result, unmount } = renderHook(() => usePianoAudio());
    await act(async () => {
      result.current.playNote("C4");
    });
    await flush();
    expect(engineInstances[0].dispose).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });
    expect(engineInstances[0].dispose).toHaveBeenCalled();
  });
});
