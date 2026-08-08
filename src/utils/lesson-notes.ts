import type { HandMode, LessonHand, NoteEvent } from "../types/lesson";
import { getNoteState } from "./lesson-timing";

export function matchesHand(event: NoteEvent, mode: HandMode) {
  return mode === "both" || event.hand === mode;
}

export function filterEventsByHand(events: NoteEvent[], mode: HandMode) {
  return events.filter((event) => matchesHand(event, mode));
}

export function getActiveEvents(events: NoteEvent[], time: number, mode: HandMode = "both") {
  return filterEventsByHand(events, mode).filter((event) => getNoteState(event, time) === "active");
}

export function getUpcomingEvent(events: NoteEvent[], time: number, mode: HandMode = "both") {
  return filterEventsByHand(events, mode).find((event) => event.start >= time - 0.02 && event.start + event.duration > time);
}

export function getCurrentMusicalDisplay(events: NoteEvent[], time: number, mode: HandMode = "both") {
  const active = getActiveEvents(events, time, mode);
  if (active.length === 0) {
    const upcoming = getUpcomingEvent(events, time, mode);
    return upcoming ? { label: "Next", value: upcoming.name, midi: upcoming.midi, notes: [] as NoteEvent[] } : { label: "Ready", value: "Play when ready", midi: undefined, notes: [] as NoteEvent[] };
  }
  const names = active.map((event) => event.name).sort((a, b) => a.localeCompare(b));
  return { label: active.length > 1 ? "Chord" : "Note", value: active.length > 1 ? names.join(" + ") : names[0], midi: active[0].midi, notes: active };
}

export function getActiveMidi(events: NoteEvent[], time: number, mode: HandMode = "both") {
  return new Set(getActiveEvents(events, time, mode).map((event) => event.midi));
}

export function getHandLabel(hand: LessonHand) { return hand === "left" ? "Left hand" : "Right hand"; }
