import { describe, expect, it } from "vitest";
import { demoExercises } from "@/data/demo-exercises";
import type { StorageLike } from "@/features/practice/results-store";
import { buildCoachingPlan } from "./coaching-plan";
import { COACHING_STORAGE_KEY, readCoachingPlans, saveCoachingPlan, updateCoachingGoal } from "./coaching-store";

function makeStorage(): StorageLike & { value: string } {
  let value = "";
  return { getItem: () => value, setItem: (_key, next) => { value = next; }, removeItem: () => undefined, get value() { return value; } };
}

describe("coaching plan storage", () => {
  it("stores only validated plans and persists goal completion", () => {
    const storage = makeStorage();
    const plan = buildCoachingPlan(demoExercises[0], [{
      version: 1, id: "r", lessonId: demoExercises[0].id, lessonTitle: demoExercises[0].title, input: "midi", focus: "full", preset: "standard", handMode: "both", createdAt: 1, overall: 80, pitch: 80, timing: 80, duration: 80, correctNotes: 80, counts: { expected: 1, performed: 1, correct: 1, early: 0, late: 0, wrong: 0, extra: 0, matched: 1, missed: 0, pending: 0 }, problems: [],
    }], 2_000)!;
    saveCoachingPlan(storage, plan);
    const updated = updateCoachingGoal(storage, plan.lessonId, plan.goals[0].id, true);
    expect(updated?.goals[0].completed).toBe(true);
    expect(readCoachingPlans(storage)[0].goals[0].completed).toBe(true);
    expect(JSON.parse(storage.value)).toMatchObject({ version: 1, plans: [{ lessonId: demoExercises[0].id }] });
    expect(COACHING_STORAGE_KEY).toBe("piano.practice.coaching.v1");
    expect(storage.value).not.toContain("performedNotes");
    expect(storage.value).not.toContain("raw_midi");
  });

  it("rejects a tampered plan containing personal or media text", () => {
    const storage = makeStorage();
    storage.setItem(COACHING_STORAGE_KEY, JSON.stringify({ version: 1, plans: [{ version: 1, planId: "p", lessonId: "lesson", lessonTitle: "My email is learner@example.test", generatedAt: 1, sourceAttemptCount: 1, sourceLatestCreatedAt: 1, overview: "bad", trends: [], goals: [], exercises: [], recommendedTempo: 60, tempoReason: "bad", practiceMode: "full", practiceModeReason: "bad", focusNotes: [], focusSection: { label: "x", start: 0, end: 1, reason: "x" }, sessionDurationMinutes: 15, wordingProvider: "local", wordingFallback: false }] }));
    expect(readCoachingPlans(storage)).toEqual([]);
  });
});
