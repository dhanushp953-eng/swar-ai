// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { PracticePanel } from "@/features/practice/PracticePanel";
import type { WebMidiController } from "@/lib/midi/web-midi";
import type { PracticeNoteSource } from "@/hooks/usePracticeSession";
import type { MidiNoteEvent } from "@/lib/midi/midi-types";
import { STORAGE_KEY } from "@/features/practice/results-store";

// A controllable fake of the Tone transport. Crucially, `scheduleOnce` never
// invokes its callback — this lets the test prove the lesson still reaches
// "complete" via the RAF duration fallback even when the scheduled end
// callback never fires.
const hoisted = vi.hoisted(() => {
  const transport = {
    seconds: 0,
    position: 0,
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    cancel: vi.fn(),
    scheduleOnce: vi.fn(() => 0),
    clear: vi.fn(),
  };
  const audioContext = {
    setTimeout: vi.fn(() => 0),
    clearTimeout: vi.fn(),
    rawContext: {
      state: "running" as AudioContextState,
      destination: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    lookAhead: 0,
  };
  const synthInstances: Array<{ releaseAll: ReturnType<typeof vi.fn>; triggerAttackRelease: ReturnType<typeof vi.fn> }> = [];
  class PolySynthMock {
    triggerAttackRelease = vi.fn();
    triggerRelease = vi.fn();
    releaseAll = vi.fn();
    dispose = vi.fn();
    volume = { value: 0 };
    constructor() {
      synthInstances.push(this);
    }
    toDestination() {
      return this;
    }
  }
  class MembraneSynthMock {
    triggerAttackRelease = vi.fn();
    triggerRelease = vi.fn();
    dispose = vi.fn();
    volume = { value: 0 };
    toDestination() {
      return this;
    }
  }
  class SynthMock {}
  return { transport, audioContext, synthInstances, PolySynthMock, MembraneSynthMock, SynthMock };
});

vi.mock("tone", () => ({
  start: vi.fn(async () => undefined),
  getTransport: () => hoisted.transport,
  getContext: () => hoisted.audioContext,
  now: () => hoisted.transport.seconds,
  PolySynth: hoisted.PolySynthMock,
  MembraneSynth: hoisted.MembraneSynthMock,
  Synth: hoisted.SynthMock,
}));

import { useLessonEngine } from "./useLessonEngine";

let rafCb: ((timestamp: number) => void) | null = null;

function makeExercise(duration: number) {
  return {
    id: "ex1",
    title: "Test Lesson",
    description: "",
    bpm: 120,
    beatsPerMeasure: 4,
    duration,
    events: [],
  } as unknown as import("@/types/lesson").LessonExercise;
}

async function runTick(timestamp: number) {
  const cb = rafCb;
  rafCb = null;
  if (cb) {
    await act(async () => {
      cb(timestamp);
    });
  }
}

beforeEach(() => {
  rafCb = null;
  hoisted.transport.seconds = 0;
  hoisted.transport.start.mockClear();
  hoisted.transport.stop.mockClear();
  hoisted.transport.scheduleOnce.mockClear();
  hoisted.synthInstances.length = 0;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCb = cb as (timestamp: number) => void;
    return 1;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {
    rafCb = null;
  }) as typeof cancelAnimationFrame;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useLessonEngine completion fallback", () => {
  it("reaches complete via the RAF tick when the Tone end callback never fires (generated playback)", async () => {
    const exercise = makeExercise(10);
    const { result } = renderHook(() => useLessonEngine(exercise));

    await act(async () => {
      result.current.play();
    });

    // The end event WAS scheduled, but our fake transport never fires it.
    expect(hoisted.transport.scheduleOnce).toHaveBeenCalled();
    expect(result.current.status).toBe("count-in");

    // Advance past the count-in so the lesson is actually playing.
    hoisted.transport.seconds = 3;
    await runTick(100);
    expect(result.current.status).toBe("playing");

    // Drive the playback clock past the duration. Because the Tone scheduled
    // end callback does not fire, the RAF tick must finish the lesson.
    hoisted.transport.seconds = 10.05;
    await runTick(200);

    expect(result.current.status).toBe("complete");
    expect(result.current.currentTime).toBeCloseTo(10, 5);
    expect(hoisted.transport.stop).toHaveBeenCalled();
    expect(hoisted.synthInstances.some((s) => s.releaseAll.mock.calls.length > 0)).toBe(true);
  });

  it("reaches complete via the duration fallback when audio.ended is unreliable (audio master)", async () => {
    const audioEl = {
      src: "",
      preload: "",
      playbackRate: 1,
      volume: 1,
      currentTime: 0,
      ended: false,
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      load: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      removeAttribute: vi.fn(),
      setAttribute: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as HTMLAudioElement;
    const audioRef = { current: audioEl } as React.RefObject<HTMLAudioElement | null>;
    const exercise = makeExercise(10);

    const { result } = renderHook(() =>
      useLessonEngine(exercise, { audioRef, audioFile: {} as unknown as File, objectUrl: "blob:fake" }),
    );

    await act(async () => {
      result.current.play();
    });

    expect(result.current.status).toBe("playing");

    // Simulate the audio clock reaching the end without firing `ended`.
    audioEl.currentTime = 10.05;
    await runTick(100);

    expect(result.current.status).toBe("complete");
    expect(result.current.currentTime).toBeCloseTo(10, 5);
    expect(hoisted.transport.stop).toHaveBeenCalled();
    expect(hoisted.synthInstances.some((s) => s.releaseAll.mock.calls.length > 0)).toBe(true);
  });

  it("completing via the fallback displays the Final Summary and saves the attempt", async () => {
    const exercise = makeExercise(10);
    const engineRef: { current: ReturnType<typeof useLessonEngine> | null } = { current: null };
    const listenerRef: { current?: (event: MidiNoteEvent) => void } = {};
    const fakeSource: PracticeNoteSource = {
      subscribeEvents: (listener) => {
        listenerRef.current = listener;
        return () => {
          listenerRef.current = undefined;
        };
      },
    };
    const snapshots: unknown[] = [];
    const events = [{ id: "e1", midi: 60, name: "C4", start: 0, duration: 0.5 }] as unknown as Parameters<typeof PracticePanel>[0]["events"];

    function Harness() {
      const engine = useLessonEngine(exercise);
      engineRef.current = engine;
      return (
        <PracticePanel
          events={events}
          controller={fakeSource as unknown as WebMidiController}
          getLessonTime={() => engine.currentTime}
          status={engine.status}
          duration={exercise.duration}
          onRestart={() => undefined}
          lessonId="l1"
          lessonTitle="Test"
          engine={engine}
          onPracticeSnapshot={(snapshot) => snapshots.push(snapshot)}
          defaultEnabled
        />
      );
    }

    globalThis.localStorage.clear();
    const { container } = render(<Harness />);
    const engine = engineRef.current!;

    await act(async () => {
      engine.play();
    });

    // Pass the count-in so the lesson is playing.
    hoisted.transport.seconds = 3;
    await runTick(100);
    expect(engineRef.current!.status).toBe("playing");

    // Play a note that matches the lesson event so the attempt is scored.
    act(() => {
      listenerRef.current?.({
        type: "noteon",
        channel: 0,
        noteNumber: 60,
        noteName: "C4",
        velocity: 100,
        timestamp: 0,
        reason: "key",
      });
    });
    act(() => {
      listenerRef.current?.({
        type: "noteoff",
        channel: 0,
        noteNumber: 60,
        noteName: "C4",
        velocity: 0,
        timestamp: 0,
        reason: "key",
      });
    });

    // Drive past the duration; the Tone end callback does not fire, so the
    // RAF fallback completes the lesson.
    hoisted.transport.seconds = 10.05;
    await runTick(200);

    expect(engineRef.current!.status).toBe("complete");

    // Final Summary is displayed.
    expect(container.querySelector(".practice-summary")).not.toBeNull();

    // The attempt is saved both to the callback and to storage.
    expect(snapshots.length).toBeGreaterThan(0);
    const stored = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown[];
    expect(stored.length).toBe(1);
  });
});
