import type { LessonExercise } from "@/types/lesson";
import type { DetectedLesson } from "./detected-lesson";

export const DETECTED_OPTION = { value: "detected", label: "Detected from your audio" } as const;
export const IMPORTED_OPTION = { value: "imported", label: "Imported lesson" } as const;

export type LessonOrigin = "detected" | "imported" | "demo";
export type LessonOption = { value: string; label: string };

export function getLessonSelectOptions(detectedLesson: DetectedLesson | null | undefined, demoExercises: LessonExercise[], importedLesson: LessonExercise | null | undefined = null): LessonOption[] {
  return [
    ...(detectedLesson ? [DETECTED_OPTION] : []),
    ...(importedLesson ? [{ value: IMPORTED_OPTION.value, label: importedLesson.title }] : []),
    ...demoExercises.map((item) => ({ value: item.id, label: item.title })),
  ];
}

export type LessonSelection = {
  origin: LessonOrigin;
  isDetected: boolean;
  isImported: boolean;
  safeLessonId: string;
  exercise: LessonExercise;
};

export function resolveLessonSelection(lessonId: string, detectedLesson: DetectedLesson | null | undefined, demoExercises: LessonExercise[], importedLesson: LessonExercise | null | undefined = null): LessonSelection {
  const wantsDetected = lessonId === "detected";
  const wantsImported = lessonId === "imported";
  if (wantsDetected && detectedLesson) return buildSelection("detected", "detected", detectedLesson.exercise);
  if (wantsImported && importedLesson) return buildSelection("imported", "imported", importedLesson);
  if (wantsImported && detectedLesson) return buildSelection("detected", "detected", detectedLesson.exercise);
  if (wantsDetected && importedLesson) return buildSelection("imported", "imported", importedLesson);
  const demo = demoExercises.find((item) => item.id === lessonId) ?? demoExercises[0];
  return buildSelection("demo", demo.id, demo);
}

function buildSelection(origin: LessonOrigin, safeLessonId: string, exercise: LessonExercise): LessonSelection {
  return { origin, isDetected: origin === "detected", isImported: origin === "imported", safeLessonId, exercise };
}
