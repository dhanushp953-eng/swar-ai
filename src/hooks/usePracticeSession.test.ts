import { describe, expect, it } from "vitest";
import { isFreshStart, isPracticeActive } from "./usePracticeSession";

describe("isPracticeActive", () => {
  it("only scores note-ons while the lesson is actively playing", () => {
    expect(isPracticeActive("playing")).toBe(true);
    expect(isPracticeActive("idle")).toBe(false);
    expect(isPracticeActive("count-in")).toBe(false);
    expect(isPracticeActive("paused")).toBe(false);
    expect(isPracticeActive("complete")).toBe(false);
  });
});

describe("isFreshStart", () => {
  it("starts a fresh attempt when the lesson returns to idle/count-in from a run", () => {
    expect(isFreshStart("playing", "idle")).toBe(true);
    expect(isFreshStart("paused", "idle")).toBe(true);
    expect(isFreshStart("complete", "idle")).toBe(true);
    expect(isFreshStart("playing", "count-in")).toBe(true);
    expect(isFreshStart("paused", "count-in")).toBe(true);
  });

  it("does not reset on first mount or mid-run transitions", () => {
    expect(isFreshStart("idle", "idle")).toBe(false);
    expect(isFreshStart("idle", "count-in")).toBe(false);
    expect(isFreshStart("count-in", "playing")).toBe(false);
    expect(isFreshStart("playing", "paused")).toBe(false);
    expect(isFreshStart("paused", "playing")).toBe(false);
    expect(isFreshStart("playing", "complete")).toBe(false);
  });
});
