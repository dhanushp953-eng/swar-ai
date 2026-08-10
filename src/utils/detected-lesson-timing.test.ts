import { describe, expect, it } from "vitest";
import type { NoteEvent } from "@/types/lesson";
import { getAudioSeekTime, getScheduledNoteKey, getScheduledNoteWindow, getSyncedLessonTime } from "./detected-lesson-timing";

const event: NoteEvent = { id: "note-1", midi: 60, name: "C4", start: 1, duration: 0.5, velocity: 100, hand: null, finger: null };

describe("detected lesson clock", () => {
  it("applies offsets consistently in both directions", () => {
    expect(getSyncedLessonTime(2, 100, 10)).toBeCloseTo(1.9);
    expect(getAudioSeekTime(1.9, 100, 10)).toBeCloseTo(2);
  });

  it("clamps clock values to the lesson duration", () => {
    expect(getSyncedLessonTime(-1, 0, 2)).toBe(0);
    expect(getSyncedLessonTime(10, 0, 2)).toBe(2);
  });

  it("keys scheduled notes by generation and event and clips their window", () => {
    expect(getScheduledNoteKey(3, event.id)).toBe("3:note-1");
    expect(getScheduledNoteWindow(event, 1.25, 0, 2)).toEqual({ start: 1.25, duration: 0.25 });
  });
});
