import { describe, expect, it } from "vitest";
import { getActiveEvents, getActiveMidi, getCurrentMusicalDisplay } from "./lesson-notes";
import type { NoteEvent } from "../types/lesson";

const events: NoteEvent[] = [
  { id: "left", midi: 48, name: "C3", start: 0, duration: 1, velocity: 80, hand: "left" },
  { id: "right-a", midi: 60, name: "C4", start: 0, duration: 1, velocity: 90, hand: "right" },
  { id: "right-b", midi: 64, name: "E4", start: 0, duration: 1, velocity: 90, hand: "right" },
  { id: "next", midi: 67, name: "G4", start: 2, duration: 1, velocity: 90, hand: "right" },
];

describe("lesson note state", () => {
  it("filters active notes by hand without changing the source events", () => {
    expect(getActiveEvents(events, 0.5, "left").map((item) => item.id)).toEqual(["left"]);
    expect(getActiveEvents(events, 0.5, "right").map((item) => item.id)).toEqual(["right-a", "right-b"]);
    expect(getActiveMidi(events, 0.5, "both")).toEqual(new Set([48, 60, 64]));
    expect(events).toHaveLength(4);
  });

  it("reports a chord while multiple notes share the play line", () => {
    expect(getCurrentMusicalDisplay(events, 0.5).value).toBe("C3 + C4 + E4");
    expect(getCurrentMusicalDisplay(events, 1.5).value).toBe("G4");
  });
});
