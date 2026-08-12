// Pure, framework-independent practice focus helpers.
// Turn raw lesson events into the note set used for a practice run based on
// the active hand and the chosen focus mode (full, melody, or rhythm).

import type { HandMode } from "@/types/lesson";
import type { ScoreNoteEvent } from "./scoring";

export type PracticeFocus = "full" | "melody" | "rhythm";

export const PRACTICE_FOCUS_ORDER: PracticeFocus[] = ["full", "melody", "rhythm"];

export const PRACTICE_FOCUS_META: Record<PracticeFocus, { label: string; description: string }> = {
  full: { label: "Full", description: "Play and score every note as written." },
  melody: { label: "Melody", description: "Focus on the melody line and leave the accompaniment out." },
  rhythm: { label: "Rhythm", description: "Keep every note but score rhythm only — any pitch counts." },
};

function matchesHand(event: ScoreNoteEvent, mode: HandMode) {
  return mode === "both" || event.hand === mode;
}

/**
 * Whether an event belongs to the melody line. When a single hand is selected
 * that hand is the melody; otherwise the melody is the right-hand part (the
 * demo and imported exercises follow the convention that the melody sits in
 * the right hand over a left-hand accompaniment).
 */
export function isMelodyEvent(event: ScoreNoteEvent, handMode: HandMode): boolean {
  if (handMode !== "both") return true;
  return event.hand === "right";
}

/** The events scored for a given hand + focus combination. */
export function getPracticeEvents(
  allEvents: ScoreNoteEvent[],
  handMode: HandMode,
  focus: PracticeFocus,
): ScoreNoteEvent[] {
  const byHand = allEvents.filter((event) => matchesHand(event, handMode));
  if (focus === "melody") return byHand.filter((event) => isMelodyEvent(event, handMode));
  return byHand;
}
