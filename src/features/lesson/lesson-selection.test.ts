import { describe, expect, it } from "vitest";
import { demoExercises } from "../../data/demo-exercises";
import type { DetectedLesson } from "./detected-lesson";
import { getLessonSelectOptions, resolveLessonSelection } from "./lesson-selection";

const detectedLesson = {
  exercise: {
    id: "detected-test",
    title: "Detected melody",
    description: "Detected from your audio.",
    bpm: 136,
    beatsPerMeasure: 4,
    duration: 1.8,
    events: [],
  },
  audioFile: new File([new Uint8Array([1, 2, 3])], "melody.wav", { type: "audio/wav" }),
  estimatedBpm: 136,
  melodyConfidence: 0.94,
  warnings: [],
} satisfies DetectedLesson;

describe("lesson selection keeps the detected lesson available", () => {
  it("always lists the detected option while a detected lesson is present", () => {
    const options = getLessonSelectOptions(detectedLesson, demoExercises);
    expect(options.map((option) => option.value)).toEqual(["detected", ...demoExercises.map((item) => item.id)]);
  });

  it("drops the detected option once the detected lesson is removed", () => {
    const options = getLessonSelectOptions(null, demoExercises);
    expect(options.map((option) => option.value)).not.toContain("detected");
  });

  it("resolves repeated detected -> demo -> detected -> demo -> detected switching", () => {
    let selection = resolveLessonSelection("detected", detectedLesson, demoExercises);
    expect(selection.isDetected).toBe(true);
    expect(selection.exercise).toBe(detectedLesson.exercise);

    selection = resolveLessonSelection("morning-steps", detectedLesson, demoExercises);
    expect(selection.isDetected).toBe(false);
    expect(selection.exercise.id).toBe("morning-steps");

    selection = resolveLessonSelection("detected", detectedLesson, demoExercises);
    expect(selection.isDetected).toBe(true);
    expect(selection.exercise).toBe(detectedLesson.exercise);

    selection = resolveLessonSelection("open-fifths", detectedLesson, demoExercises);
    expect(selection.isDetected).toBe(false);
    expect(selection.exercise.id).toBe("open-fifths");

    selection = resolveLessonSelection("detected", detectedLesson, demoExercises);
    expect(selection.isDetected).toBe(true);
    expect(selection.exercise).toBe(detectedLesson.exercise);
  });

  it("falls back to the first demo when detected is selected after the lesson was removed", () => {
    const selection = resolveLessonSelection("detected", null, demoExercises);
    expect(selection.isDetected).toBe(false);
    expect(selection.safeLessonId).toBe(demoExercises[0].id);
    expect(selection.exercise.id).toBe(demoExercises[0].id);
  });
});
