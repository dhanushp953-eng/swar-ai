import { afterEach, describe, expect, it, vi } from "vitest";
import { demoExercises } from "@/data/demo-exercises";
import type { StoredPracticeResult } from "@/features/practice/results-store";
import { buildCoachingPlan, preserveGoalCompletion } from "./coaching-plan";
import { requestCoachingWording } from "./coaching-api";

const latest: StoredPracticeResult = {
  version: 1, id: "latest", lessonId: demoExercises[0].id, lessonTitle: demoExercises[0].title, input: "midi", focus: "full", preset: "standard", handMode: "both", createdAt: 10, overall: 80, pitch: 86, timing: 64, duration: 75, correctNotes: 80,
  counts: { expected: 3, performed: 3, correct: 2, early: 1, late: 1, wrong: 0, extra: 0, matched: 3, missed: 0, pending: 0 }, problems: [{ name: "E4", at: 1, kind: "early" }],
};

afterEach(() => vi.unstubAllGlobals());

const MOCK_ADVICE = {
  advice: {
    summary: "Keep the pulse calm and focused.",
    strengths: ["Your latest score gives a clear starting point."],
    improvement_priorities: ["Repeat the short section evenly."],
    pitch_feedback: "Pitch score: 86/100.",
    timing_feedback: "Timing score: 64/100. Slow the section down.",
    rhythm_feedback: "Rhythm feedback is unavailable.",
    exercises: [
      { title: "One", instructions: "Play the focus section slowly." },
      { title: "Two", instructions: "Repeat the phrase evenly." },
      { title: "Three", instructions: "Join the phrase." },
    ],
  },
  provider: "mock",
  used_fallback: true,
  fallback_reason: "not_configured",
};

describe("coaching wording assist", () => {
  it("sends only the latest sanitized snapshot and keeps deterministic facts local", async () => {
    const plan = buildCoachingPlan(demoExercises[0], [latest], 20)!;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).not.toHaveProperty("recent_results");
      expect(body).not.toHaveProperty("performedNotes");
      expect(body).not.toHaveProperty("raw_midi");
      expect(body).not.toHaveProperty("audio");
      expect(String(body.user_question)).toContain(`${plan.recommendedTempo} BPM`);
      return new Response(JSON.stringify(MOCK_ADVICE), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const worded = await requestCoachingWording(demoExercises[0], latest, plan);
    expect(worded.wordingProvider).toBe("mock");
    expect(worded.recommendedTempo).toBe(plan.recommendedTempo);
    expect(worded.practiceMode).toBe(plan.practiceMode);
    expect(worded.overview).toContain(`${plan.recommendedTempo} BPM`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves goal completion across regeneration from the stored plan, not the rebuilt plan", async () => {
    const build = () => ({
      version: 1 as const, id: "g-1", lessonId: demoExercises[0].id, lessonTitle: "Morning Steps", input: "midi", focus: "full", preset: "standard", handMode: "both",
      createdAt: 10, overall: 80, pitch: 86, timing: 64, duration: 75, correctNotes: 80,
      counts: { expected: 3, performed: 3, correct: 2, early: 1, late: 1, wrong: 0, extra: 0, matched: 3, missed: 0, pending: 0 }, problems: [],
    } as StoredPracticeResult);
    const stored = preserveGoalCompletion(buildCoachingPlan(demoExercises[0], [build()], 20)!, buildCoachingPlan(demoExercises[0], [build()], 20)!);
    const storedWithCompletedGoal = { ...stored, goals: stored.goals.map((goal, index) => ({ ...goal, completed: index === 0 })) };

    const fetchMock = vi.fn(async () => new Response(JSON.stringify(MOCK_ADVICE), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const worded = await requestCoachingWording(demoExercises[0], build(), storedWithCompletedGoal);

    expect(worded.goals).toHaveLength(storedWithCompletedGoal.goals.length);
    expect(worded.goals[0].completed).toBe(true);
    expect(worded.goals[1].completed).toBe(false);
    const preserved = preserveGoalCompletion(worded, storedWithCompletedGoal);
    expect(preserved.goals[0].completed).toBe(true);
    expect(preserved.goals[1].completed).toBe(false);
    expect(preserved.recommendedTempo).toBe(storedWithCompletedGoal.recommendedTempo);
  });
});

describe("coaching wording safety and resilience", () => {
  const plan = buildCoachingPlan(demoExercises[0], [latest], 20)!;

  it("marks the plan as local fallback when the tutor is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(MOCK_ADVICE), { status: 200 })));
    const worded = await requestCoachingWording(demoExercises[0], latest, plan);
    expect(worded.wordingFallback).toBe(true);
    expect(worded.wordingProvider).toBe("mock");
    expect(worded.recommendedTempo).toBe(plan.recommendedTempo);
  });

  it("surfaces a rate-limit response as a safe error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "ai_rate_limited", message: "Too many requests." } }), { status: 429 })));
    await expect(requestCoachingWording(demoExercises[0], latest, plan)).rejects.toMatchObject({ kind: "server", code: "ai_rate_limited" });
  });

  it("honors an abort signal and reports cancellation", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }));
    await expect(requestCoachingWording(demoExercises[0], latest, plan, controller.signal)).rejects.toMatchObject({ kind: "cancelled", code: "cancelled" });
  });

  it("never sends provider keys, media, or raw MIDI in the wording request", async () => {
    let captured: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = String(init?.body);
      return new Response(JSON.stringify(MOCK_ADVICE), { status: 200 });
    }));
    await requestCoachingWording(demoExercises[0], latest, plan);
    const lower = captured!.toLowerCase();
    expect(lower).not.toContain("api_key");
    expect(lower).not.toContain("secret");
    expect(lower).not.toContain("midi");
    expect(lower).not.toContain("audio");
    expect(lower).not.toContain("lyrics");
    expect(lower).not.toContain("file://");
  });
});
