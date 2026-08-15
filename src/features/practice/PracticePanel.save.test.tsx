// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { PracticePanel } from "./PracticePanel";
import { WebMidiController } from "@/lib/midi/web-midi";
import type { PracticeNoteSource } from "@/hooks/usePracticeSession";
import type { MidiNoteEvent } from "@/lib/midi/midi-types";
import type { ScoreNoteEvent } from "@/lib/practice/scoring";
import type { LessonStatus } from "@/types/lesson";
import { STORAGE_KEY } from "./results-store";

const EVENTS: ScoreNoteEvent[] = [{ id: "e1", midi: 60, name: "C4", start: 0, duration: 0.5 }];

function makeFakeSource() {
  let listener: ((event: MidiNoteEvent) => void) | undefined;
  const source: PracticeNoteSource = {
    subscribeEvents: (listenerArg) => {
      listener = listenerArg;
      return () => {
        listener = undefined;
      };
    },
  };
  return {
    source,
    emit: (event: MidiNoteEvent) => listener?.(event),
  };
}

function readStored(): Array<Record<string, unknown>> {
  const raw = globalThis.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
}

const noteOn = (midi: number, name: string): MidiNoteEvent => ({
  type: "noteon",
  channel: 0,
  noteNumber: midi,
  noteName: name,
  velocity: 100,
  timestamp: 0,
  reason: "key",
});

const noteOff = (midi: number, name: string): MidiNoteEvent => ({
  type: "noteoff",
  channel: 0,
  noteNumber: midi,
  noteName: name,
  velocity: 0,
  timestamp: 0,
  reason: "key",
});

type PanelProps = Parameters<typeof PracticePanel>[0];

function baseProps(source: PracticeNoteSource, status: LessonStatus): PanelProps {
  return {
    events: EVENTS,
    controller: source as unknown as WebMidiController,
    getLessonTime: () => 0,
    status,
    duration: 1,
    onRestart: () => undefined,
    defaultEnabled: true,
    lessonId: "lesson-1",
    lessonTitle: "Test Lesson",
  };
}

describe("PracticePanel completed-attempt saving", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("saves a microphone/MIDI attempt with overall 0 and performed notes exactly once", () => {
    const fake = makeFakeSource();
    const { rerender } = render(<PracticePanel {...baseProps(fake.source, "playing")} />);

    // A wrong-pitch note (D4 against an expected C4) scores 0 correct -> overall 0.
    act(() => {
      fake.emit(noteOn(62, "D4"));
      fake.emit(noteOff(62, "D4"));
    });

    act(() => {
      rerender(<PracticePanel {...baseProps(fake.source, "complete")} />);
    });

    const stored = readStored();
    expect(stored).toHaveLength(1);
    expect(stored[0].overall).toBe(0);
    const counts = stored[0].counts as { performed: number };
    expect(counts.performed).toBeGreaterThan(0);
  });

  it("does not save an attempt with zero performed notes", () => {
    const fake = makeFakeSource();
    const { rerender } = render(<PracticePanel {...baseProps(fake.source, "playing")} />);

    // Never emit a note, then complete the run.
    act(() => {
      rerender(<PracticePanel {...baseProps(fake.source, "complete")} />);
    });

    expect(readStored()).toHaveLength(0);
  });

  it("does not duplicate the save within the same run", () => {
    const fake = makeFakeSource();
    const { rerender } = render(<PracticePanel {...baseProps(fake.source, "playing")} />);

    act(() => {
      fake.emit(noteOn(62, "D4"));
      fake.emit(noteOff(62, "D4"));
    });
    act(() => {
      rerender(<PracticePanel {...baseProps(fake.source, "complete")} />);
    });
    // Reaching "complete" again without a fresh start must not add a second entry.
    act(() => {
      rerender(<PracticePanel {...baseProps(fake.source, "complete")} />);
    });

    expect(readStored()).toHaveLength(1);
  });

  it("surfaces the saved attempt to the AI Tutor via the practice snapshot", () => {
    const fake = makeFakeSource();
    const snapshots: Array<Record<string, unknown> | null> = [];
    const { rerender } = render(
      <PracticePanel {...baseProps(fake.source, "playing")} onPracticeSnapshot={(snapshot) => snapshots.push(snapshot)} />,
    );

    act(() => {
      fake.emit(noteOn(62, "D4"));
      fake.emit(noteOff(62, "D4"));
    });
    act(() => {
      rerender(
        <PracticePanel {...baseProps(fake.source, "complete")} onPracticeSnapshot={(snapshot) => snapshots.push(snapshot)} />,
      );
    });

    expect(snapshots.some((snapshot) => snapshot !== null)).toBe(true);
    expect(
      snapshots.some(
        (snapshot) => snapshot !== null && (snapshot as { scores: { overall: number } }).scores.overall === 0,
      ),
    ).toBe(true);
  });
});
