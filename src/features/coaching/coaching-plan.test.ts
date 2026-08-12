import { describe, expect, it } from "vitest";
import { demoExercises } from "@/data/demo-exercises";
import type { StoredPracticeResult } from "@/features/practice/results-store";
import { buildCoachingPlan, preserveGoalCompletion, selectRecentCoachingResults, summarizeCoachingResults } from "./coaching-plan";

function result(overrides: Partial<StoredPracticeResult> = {}): StoredPracticeResult {
  return {
    version: 1,
    id: "result-1",
    lessonId: demoExercises[0].id,
    lessonTitle: demoExercises[0].title,
    input: "midi",
    focus: "full",
    preset: "standard",
    handMode: "both",
    createdAt: 1_000,
    overall: 70,
    pitch: 72,
    timing: 60,
    duration: 76,
    correctNotes: 70,
    counts: { expected: 3, performed: 3, correct: 2, early: 1, late: 1, wrong: 0, extra: 0, matched: 3, missed: 0, pending: 0 },
    problems: [{ name: "E4", at: 1.4, kind: "early" }],
    ...overrides,
  };
}

describe("personalized coaching planner", () => {
  it("uses only capped lesson-local summaries to identify trends and priorities", () => {
    const results = Array.from({ length: 10 }, (_, index) => result({ id: `result-${index}`, createdAt: 1_000 + index, overall: 60 + index, pitch: 70, timing: 50 + index, problems: [{ name: "E4", at: 1.4, kind: "early" }, { name: "G4", at: 2, kind: "late" }] }));
    const selected = selectRecentCoachingResults([...results, result({ id: "other", lessonId: "other-lesson", createdAt: 9_999 })], demoExercises[0].id);
    const summary = summarizeCoachingResults(selected);
    const plan = buildCoachingPlan(demoExercises[0], selected, 10_000);

    expect(selected).toHaveLength(8);
    expect(summary?.focusNotes).toEqual(["E4", "G4"]);
    expect(summary?.trends.find((trend) => trend.metric === "timing")?.direction).toBe("improving");
    expect(plan?.practiceMode).toBe("rhythm");
    expect(plan?.recommendedTempo).toBeLessThan(demoExercises[0].bpm);
    expect(plan?.focusSection.start).toBe(1.4);
    expect(plan?.goals.every((goal) => goal.why.length > 0)).toBe(true);
    expect(plan?.exercises.every((exercise) => exercise.why.length > 0)).toBe(true);
  });

  it("returns no recommendation without history and keeps goal completion on regeneration", () => {
    expect(buildCoachingPlan(demoExercises[0], [])).toBeNull();
    const plan = buildCoachingPlan(demoExercises[0], [result()], 2_000);
    expect(plan).not.toBeNull();
    const completed = { ...plan!, goals: plan!.goals.map((goal, index) => ({ ...goal, completed: index === 0 })) };
    const regenerated = preserveGoalCompletion({ ...plan!, generatedAt: 3_000 }, completed);
    expect(regenerated.goals[0].completed).toBe(true);
    expect(regenerated.goals[1].completed).toBe(false);
    expect(preserveGoalCompletion({ ...plan!, lessonId: "other" }, completed).goals[0].completed).toBe(false);
  });
});
