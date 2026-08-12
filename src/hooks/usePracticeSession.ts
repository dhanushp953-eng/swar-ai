"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PRACTICE_PRESETS,
  type PracticeConfig,
  type PracticePresetId,
  type ScoreNoteEvent,
  type ScoreResult,
} from "@/lib/practice/scoring";
import { PracticeSession } from "@/lib/practice/session";
import { getMidiController } from "@/lib/midi/web-midi";
import type { MidiEvent } from "@/lib/midi/midi-types";
import type { LessonStatus } from "@/types/lesson";

/** Any source of typed note events the scorer can consume (MIDI or mic). */
export type PracticeNoteSource = {
  subscribeEvents(listener: (event: MidiEvent) => void): () => void;
};

export type UsePracticeSessionOptions = {
  /** Expected note events to score against (already filtered by hand mode). */
  events: ScoreNoteEvent[];
  /** Note event source feeding the session. Defaults to the MIDI controller. */
  controller?: PracticeNoteSource;
  /** Returns the current lesson-clock time (seconds). */
  getLessonTime: () => number;
  status: LessonStatus;
  /** Exercise duration in seconds; used as the finalize horizon on completion. */
  duration: number;
  preset: PracticePresetId;
  enabled: boolean;
  /** Overrides merged on top of the selected preset (e.g. rhythm-only scoring). */
  configOverrides?: Partial<PracticeConfig>;
  /** Subtract this many milliseconds from captured onset/offset times. */
  latencyMs?: number;
};

/** Only note-ons arriving while the lesson is actively playing (or paused on a
 *  wait target in wait mode) are scored. */
export const isPracticeActive = (status: LessonStatus): boolean =>
  status === "playing" || status === "waiting";

type Holder = { epoch: number; session: PracticeSession };

const makeHolder = (
  events: ScoreNoteEvent[],
  preset: PracticePresetId,
  epoch: number,
  overrides?: Partial<PracticeConfig>,
): Holder => ({
  epoch,
  session: new PracticeSession(events, { ...PRACTICE_PRESETS[preset], ...overrides }),
});

/** A fresh attempt begins when the lesson leaves an active state and returns to them. */
export const isFreshStart = (previous: LessonStatus, next: LessonStatus): boolean =>
  (previous === "playing" || previous === "waiting" || previous === "paused" || previous === "complete") &&
  (next === "idle" || next === "count-in");

export function usePracticeSession(options: UsePracticeSessionOptions): {
  result: ScoreResult | null;
  finalize: () => void;
} {
  const { events, controller, getLessonTime, status, duration, preset, enabled, configOverrides, latencyMs = 0 } = options;

  const [holder, setHolder] = useState<Holder>(() => makeHolder(events, preset, 1, configOverrides));
  const [snapshot, setSnapshot] = useState<{ epoch: number; result: ScoreResult | null }>({
    epoch: holder.epoch,
    result: null,
  });

  // Start a fresh attempt whenever the expected notes, strictness, or practice
  // focus change, or whenever the lesson begins a new run. Resetting here
  // (adjusting state during render, keyed on a prev-tracker) keeps the result
  // aligned with the new session in the same render instead of writing state
  // from an effect. The session is deliberately NOT reset by lesson-clock
  // updates.
  const [prev, setPrev] = useState({ events, preset, configOverrides, status });
  if (prev.events !== events || prev.preset !== preset || prev.configOverrides !== configOverrides || isFreshStart(prev.status, status)) {
    setPrev({ events, preset, configOverrides, status });
    setHolder((current) => makeHolder(events, preset, current.epoch + 1, configOverrides));
  }

  // Keep the latest clock + status in refs so the MIDI subscription is stable
  // across lesson-clock updates (getLessonTime identity changes on every tick)
  // and across status changes. The callback always reads the current values.
  const clockRef = useRef(getLessonTime);
  const statusRef = useRef(status);
  useEffect(() => {
    clockRef.current = getLessonTime;
    statusRef.current = status;
  }, [getLessonTime, status]);

  useEffect(() => {
    if (!enabled) return;
    const midi = controller ?? getMidiController();
    return midi.subscribeEvents((event) => {
      const session = holder.session;
      const shift = latencyMs / 1000;
      if (event.type === "noteon" && event.reason === "key") {
        if (!isPracticeActive(statusRef.current)) return;
        const onset = clockRef.current() - shift;
        session.noteOn(
          { midi: event.noteNumber, name: event.noteName, channel: event.channel, velocity: event.velocity },
          onset,
        );
        setSnapshot({ epoch: holder.epoch, result: session.currentResult });
      } else if (event.type === "noteoff") {
        // Close the held note for any release reason (key, sustain, or
        // release-all on device disconnect) so nothing gets stuck open.
        const offset = clockRef.current() - shift;
        const updated = session.noteOff(event.channel, event.noteNumber, offset);
        if (updated) setSnapshot({ epoch: holder.epoch, result: updated });
      }
    });
  }, [controller, enabled, holder, latencyMs]);

  const finalize = useCallback(() => {
    setSnapshot({ epoch: holder.epoch, result: holder.session.finalize(clockRef.current()) });
  }, [holder]);

  // Once the lesson completes, resolve the attempt so nothing stays pending.
  const result = useMemo(() => {
    if (!enabled) return null;
    if (status === "complete") return holder.session.finalize(duration);
    return snapshot.epoch === holder.epoch ? snapshot.result : null;
  }, [duration, enabled, holder, snapshot, status]);

  return { result, finalize };
}
