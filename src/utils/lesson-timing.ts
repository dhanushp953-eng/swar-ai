import type { NoteEvent } from "../types/lesson";

export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
export const COUNT_IN_BEATS = 4;

export function getBeatDuration(bpm: number, speed: number) {
  if (bpm <= 0 || speed <= 0) return 0;
  return 60 / (bpm * speed);
}

export function getCountInDuration(bpm: number, speed: number) {
  return getBeatDuration(bpm, speed) * COUNT_IN_BEATS;
}

export function scaleLessonTime(seconds: number, speed: number) {
  return seconds / speed;
}

export function unscalePlaybackTime(seconds: number, speed: number) {
  return seconds * speed;
}

export function clampLessonTime(time: number, duration: number) {
  return Math.min(Math.max(time, 0), duration);
}

export function getLessonTimeFromClock(clockSeconds: number, lessonStart: number, speed: number, countInSeconds = 0, duration = Number.POSITIVE_INFINITY) {
  return clampLessonTime(lessonStart + Math.max(0, clockSeconds - countInSeconds) * speed, duration);
}

export function getNoteState(event: NoteEvent, time: number): "upcoming" | "active" | "complete" {
  if (time < event.start) return "upcoming";
  if (time < event.start + event.duration) return "active";
  return "complete";
}

export function getVisibleEvents(events: NoteEvent[], time: number, lookAhead = 5, lookBehind = 0.5) {
  return events.filter((event) => event.start + event.duration >= time - lookBehind && event.start <= time + lookAhead);
}
