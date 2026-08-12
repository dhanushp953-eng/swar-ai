"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PRACTICE_PRESETS, type PracticePresetId, type ScoreNoteEvent, type ScoreResult } from "@/lib/practice/scoring";
import { PracticeSession } from "@/lib/practice/session";
import { getMidiController, type WebMidiController } from "@/lib/midi/web-midi";
import type { LessonStatus } from "@/types/lesson";

export type UsePracticeSessionOptions = {
  /** Expected note events to score against (already filtered by hand mode). */
  events: ScoreNoteEvent[];
  /** MIDI controller feeding note-on/note-off messages. Defaults to the shared controller. */
  controller?: WebMidiController;
  /** Returns the current lesson-clock time (seconds). */
  getLessonTime: () => number;
  status: LessonStatus;
  /** Exercise duration in seconds; used as the finalize horizon on completion. */
  duration: number;
  preset: PracticePresetId;
  enabled: boolean;
  /** Subtract this many milliseconds from captured onset/offset times. */
  latencyMs?: number;
};

/** Only note-ons arriving while the lesson is actively playing are scored. */
export const isPracticeActive = (status: LessonStatus): boolean => status === "playing";

type Holder = { epoch: number; session: PracticeSession };

const makeHolder = (events: ScoreNoteEvent[], preset: PracticePresetId, epoch: number): Holder => ({
  epoch,
  session: new PracticeSession(events, PRACTICE_PRESETS[preset]),
});

/** A fresh attempt begins when the lesson leaves idle/count-in and returns to them. */
export const isFreshStart = (previous: LessonStatus, next: LessonStatus): boolean =>
  (previous === "playing" || previous === "paused" || previous === "complete") &&
  (next === "idle" || next === "count-in");

export function usePracticeSession(options: UsePracticeSessionOptions): {
  result: ScoreResult | null;
  finalize: () => void;
} {
  const { events, controller, getLessonTime, status, duration, preset, enabled, latencyMs = 0 } = options;

  const [holder, setHolder] = useState<Holder>(() => makeHolder(events, preset, 1));
  const [snapshot, setSnapshot] = useState<{ epoch: number; result: ScoreResult | null }>({
    epoch: holder.epoch,
    result: null,
  });

  // Start a fresh attempt whenever the expected notes or strictness change, or
  // whenever the lesson begins a new run. Resetting here (adjusting state during
  // render, keyed on a prev-tracker) keeps the result aligned with the new
  // session in the same render instead of writing state from an effect. The
  // session is deliberately NOT reset by lesson-clock updates.
  const [prev, setPrev] = useState({ events, preset, status });
  if (prev.events !== events || prev.preset !== preset || isFreshStart(prev.status, status)) {
    setPrev({ events, preset, status });
    setHolder((current) => makeHolder(events, preset, current.epoch + 1));
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
