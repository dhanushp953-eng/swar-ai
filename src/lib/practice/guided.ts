// Pure, framework-independent guided-practice flow helpers.
// Compute where the lesson should pause in wait mode and where a retry should
// resume from. No DOM, no audio, no React.

import type { ScoreNoteEvent } from "./scoring";

export type WaitTargetOptions = {
  events: ScoreNoteEvent[];
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
};

/**
 * Lesson-time onsets at which wait mode should pause, as a sorted list of
 * unique times. Chords (several events sharing an onset) pause once. When a
 * loop range is active only onsets inside [loopStart, loopEnd) are kept.
 */
export function getWaitTargets(options: WaitTargetOptions): number[] {
  const { events, loopEnabled, loopStart, loopEnd } = options;
  const rangeStart = loopEnabled ? loopStart : Number.NEGATIVE_INFINITY;
  const rangeEnd = loopEnabled ? loopEnd : Number.POSITIVE_INFINITY;
  const onsets = new Set<number>();
  for (const event of events) {
    if (event.start < rangeStart || event.start >= rangeEnd) continue;
    onsets.add(event.start);
  }
  return [...onsets].sort((a, b) => a - b);
}

/**
 * Where a "retry" should resume from. With an active loop range, retry jumps
 * back to the loop start; otherwise it resumes just before the last played
 * note so the phrase can be attempted again. Falls back to a few seconds back
 * (never before zero) when nothing has been played yet.
 */
export function getRetryPoint(
  currentTime: number,
  loopEnabled: boolean,
  loopStart: number,
  lastPlayedOnset: number | null,
): number {
  if (loopEnabled) return loopStart;
  if (lastPlayedOnset !== null && lastPlayedOnset < currentTime) return lastPlayedOnset;
  return Math.max(0, currentTime - 4);
}
