import { describe, expect, it } from "vitest";
import { getBeatDuration, getCountInDuration, getLessonTimeFromClock, getNoteState, scaleLessonTime, unscalePlaybackTime } from "./lesson-timing";
import type { NoteEvent } from "../types/lesson";

const event: NoteEvent = { id: "test", midi: 60, name: "C4", start: 2, duration: 1, velocity: 90, hand: "right", finger: 1 };

describe("lesson timing", () => {
  it("converts BPM and playback speed into accurate beat durations", () => {
    expect(getBeatDuration(120, 1)).toBe(0.5);
    expect(getBeatDuration(120, 0.5)).toBe(1);
    expect(getCountInDuration(120, 1)).toBe(2);
  });

  it("round trips lesson seconds through playback scaling", () => {
    expect(scaleLessonTime(4, 0.5)).toBe(8);
    expect(unscalePlaybackTime(8, 0.5)).toBe(4);
  });

  it("holds the lesson at zero during count-in and advances afterward", () => {
    expect(getLessonTimeFromClock(1.9, 0, 1, 2, 10)).toBe(0);
    expect(getLessonTimeFromClock(3, 0, 0.5, 2, 10)).toBe(0.5);
    expect(getLessonTimeFromClock(30, 0, 1, 0, 10)).toBe(10);
  });

  it("uses an exclusive end boundary for active notes", () => {
    expect(getNoteState(event, 1.99)).toBe("upcoming");
    expect(getNoteState(event, 2)).toBe("active");
    expect(getNoteState(event, 2.99)).toBe("active");
    expect(getNoteState(event, 3)).toBe("complete");
  });
});
