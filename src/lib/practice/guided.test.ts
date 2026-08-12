import { describe, expect, it } from "vitest";
import { getRetryPoint, getWaitTargets } from "./guided";
import type { ScoreNoteEvent } from "./scoring";

const e = (id: string, start: number): ScoreNoteEvent => ({ id, midi: 60, name: "C4", start, duration: 0.5 });

describe("getWaitTargets", () => {
  it("returns unique onsets in ascending order, deduplicating chords", () => {
    const events = [e("a", 2), e("b", 0), e("c", 0), e("d", 1)];
    expect(getWaitTargets({ events, loopEnabled: false, loopStart: 0, loopEnd: 10 })).toEqual([0, 1, 2]);
  });

  it("clips to the loop range when looping is enabled", () => {
    const events = [e("a", 0), e("b", 1), e("c", 2), e("d", 3), e("e", 4)];
    expect(getWaitTargets({ events, loopEnabled: true, loopStart: 1, loopEnd: 3.5 })).toEqual([1, 2, 3]);
  });

  it("ignores the loop range entirely when looping is off", () => {
    const events = [e("a", 5), e("b", 1), e("c", 3)];
    expect(getWaitTargets({ events, loopEnabled: false, loopStart: 0, loopEnd: 2 })).toEqual([1, 3, 5]);
  });

  it("returns an empty list for no events", () => {
    expect(getWaitTargets({ events: [], loopEnabled: false, loopStart: 0, loopEnd: 10 })).toEqual([]);
  });
});

describe("getRetryPoint", () => {
  it("retries from the loop start when looping is active", () => {
    expect(getRetryPoint(4, true, 1.5, 3.2)).toBe(1.5);
  });

  it("retries from the last played note when it is behind the current time", () => {
    expect(getRetryPoint(4, false, 0, 3.2)).toBe(3.2);
  });

  it("falls back to a few seconds back when nothing has been played", () => {
    expect(getRetryPoint(6, false, 0, null)).toBe(2);
    expect(getRetryPoint(2, false, 0, null)).toBe(0);
  });
});
