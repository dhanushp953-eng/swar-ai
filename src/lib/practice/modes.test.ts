import { describe, expect, it } from "vitest";
import { getPracticeEvents, isMelodyEvent } from "./modes";
import type { ScoreNoteEvent } from "./scoring";

const e = (id: string, midi: number, name: string, start: number, hand?: "left" | "right"): ScoreNoteEvent => ({
  id,
  midi,
  name,
  start,
  duration: 0.5,
  ...(hand ? { hand } : {}),
});

const FULL: ScoreNoteEvent[] = [
  e("l1", 36, "C2", 0, "left"),
  e("l2", 43, "G2", 2.86, "left"),
  e("r1", 60, "C4", 0, "right"),
  e("r2", 62, "D4", 0.71, "right"),
  e("r3", 64, "E4", 1.43, "right"),
];

describe("isMelodyEvent", () => {
  it("treats right-hand events as the melody when both hands are active", () => {
    expect(isMelodyEvent(FULL[2], "both")).toBe(true);
    expect(isMelodyEvent(FULL[0], "both")).toBe(false);
  });

  it("treats every event as melody when a single hand is selected", () => {
    expect(isMelodyEvent(FULL[0], "left")).toBe(true);
    expect(isMelodyEvent(FULL[2], "right")).toBe(true);
  });
});

describe("getPracticeEvents", () => {
  it("returns every hand-matching event for full focus", () => {
    expect(getPracticeEvents(FULL, "both", "full").map((event) => event.id)).toEqual(["l1", "l2", "r1", "r2", "r3"]);
    expect(getPracticeEvents(FULL, "right", "full").map((event) => event.id)).toEqual(["r1", "r2", "r3"]);
    expect(getPracticeEvents(FULL, "left", "full").map((event) => event.id)).toEqual(["l1", "l2"]);
  });

  it("keeps only the melody line for melody focus", () => {
    expect(getPracticeEvents(FULL, "both", "melody").map((event) => event.id)).toEqual(["r1", "r2", "r3"]);
    expect(getPracticeEvents(FULL, "left", "melody").map((event) => event.id)).toEqual(["l1", "l2"]);
  });

  it("keeps the full hand-filtered set for rhythm focus (pitch handled by scoring)", () => {
    expect(getPracticeEvents(FULL, "both", "rhythm").map((event) => event.id)).toEqual(["l1", "l2", "r1", "r2", "r3"]);
  });

  it("filters out events that do not match the active hand", () => {
    expect(getPracticeEvents(FULL, "right", "full").some((event) => event.id === "l1")).toBe(false);
  });
});
