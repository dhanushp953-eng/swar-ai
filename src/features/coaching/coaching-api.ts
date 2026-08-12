import type { StoredPracticeResult } from "@/features/practice/results-store";
import type { LessonExercise } from "@/types/lesson";
import {
  applyCoachingWording,
  type CoachingPlan,
} from "./coaching-plan";
import {
  buildTutorAdviceRequest,
  createTutorPracticeSnapshotFromStoredResult,
  requestTutorAdvice,
  TutorApiError,
} from "@/lib/tutor-api";

function wordingQuestion(plan: CoachingPlan): string {
  const notes = plan.focusNotes.length > 0 ? plan.focusNotes.join(", ") : "the opening phrase";
  return `Improve wording only. Keep these plan facts exactly: ${plan.recommendedTempo} BPM, ${plan.practiceMode} mode, focus ${notes}, section ${plan.focusSection.start}-${plan.focusSection.end} seconds, ${plan.sessionDurationMinutes} minute session. Make the overview and exercise instructions encouraging.`;
}

export async function requestCoachingWording(lesson: LessonExercise, latestResult: StoredPracticeResult, plan: CoachingPlan, signal?: AbortSignal): Promise<CoachingPlan> {
  const built = buildTutorAdviceRequest(lesson, createTutorPracticeSnapshotFromStoredResult(latestResult), wordingQuestion(plan));
  if (built.error || !built.request) throw new TutorApiError(built.error ?? "The coaching wording request could not be prepared.", { code: "invalid_coaching_request", kind: "invalid_response" });
  const response = await requestTutorAdvice(built.request, signal);
  return applyCoachingWording(plan, {
    summary: response.advice.summary,
    exercises: response.advice.exercises,
    provider: response.provider,
    usedFallback: response.used_fallback,
  });
}
