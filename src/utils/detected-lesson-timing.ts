import type { NoteEvent } from "@/types/lesson";

export function getSyncedLessonTime(audioCurrentTime: number, offsetMs: number, duration: number): number {
  return Math.min(Math.max(audioCurrentTime - offsetMs / 1000, 0), duration);
}

export function getAudioSeekTime(lessonTime: number, offsetMs: number, duration: number): number {
  return Math.min(Math.max(lessonTime + offsetMs / 1000, 0), duration);
}

export function getScheduledNoteKey(generation: number, eventId: string): string {
  return `${generation}:${eventId}`;
}

export function getScheduledNoteWindow(event: NoteEvent, currentTime: number, rangeStart: number, rangeEnd: number) {
  const start = Math.max(event.start, currentTime, rangeStart);
  const end = Math.min(event.start + event.duration, rangeEnd);
  return { start, duration: Math.max(0, end - start) };
}
