import type { LessonExercise } from "@/types/lesson";
import type { DetectedLesson } from "./detected-lesson";

export const DETECTED_OPTION = { value: "detected", label: "Detected from your audio" } as const;

export type LessonOption = { value: string; label: string };

export function getLessonSelectOptions(detectedLesson: DetectedLesson | null | undefined, demoExercises: LessonExercise[]): LessonOption[] {
  return [...(detectedLesson ? [DETECTED_OPTION] : []), ...demoExercises.map((item) => ({ value: item.id, label: item.title }))];
}

export type LessonSelection = {
  isDetected: boolean;
  safeLessonId: string;
  exercise: LessonExercise;
};

export function resolveLessonSelection(lessonId: string, detectedLesson: DetectedLesson | null | undefined, demoExercises: LessonExercise[]): LessonSelection {
  const safeLessonId = lessonId === "detected" && !detectedLesson ? demoExercises[0]?.id ?? "detected" : lessonId;
  const isDetected = safeLessonId === "detected" && Boolean(detectedLesson);
  const exercise = isDetected && detectedLesson ? detectedLesson.exercise : demoExercises.find((item) => item.id === safeLessonId) ?? demoExercises[0];
  return { isDetected, safeLessonId, exercise };
}
