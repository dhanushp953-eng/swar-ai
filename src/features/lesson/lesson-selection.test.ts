import { describe, expect, it } from "vitest";
import { demoExercises } from "../../data/demo-exercises";
import type { DetectedLesson } from "./detected-lesson";
import type { LessonExercise } from "../../types/lesson";
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

const importedExercise = {
  id: "imported-test",
  title: "My Song",
  description: "Imported from a lesson file.",
  bpm: 96,
  beatsPerMeasure: 4,
  duration: 4,
  events: [{ id: "e1", midi: 60, name: "C4", start: 0, duration: 0.5, velocity: 100, hand: null }],
} satisfies LessonExercise;

describe("lesson selection includes the imported lesson", () => {
  it("lists the imported option while an imported lesson is present", () => {
    const options = getLessonSelectOptions(detectedLesson, demoExercises, importedExercise);
    expect(options.map((option) => option.value)).toEqual(["detected", "imported", ...demoExercises.map((item) => item.id)]);
    expect(options[1].label).toBe("My Song");
  });

  it("drops the imported option once the imported lesson is removed", () => {
    const options = getLessonSelectOptions(detectedLesson, demoExercises, null);
    expect(options.map((option) => option.value)).not.toContain("imported");
  });

  it("resolves the imported selection to the imported exercise", () => {
    const selection = resolveLessonSelection("imported", detectedLesson, demoExercises, importedExercise);
    expect(selection.origin).toBe("imported");
    expect(selection.isImported).toBe(true);
    expect(selection.isDetected).toBe(false);
    expect(selection.exercise).toBe(importedExercise);
  });

  it("switches imported -> demo -> detected -> imported", () => {
    let selection = resolveLessonSelection("imported", detectedLesson, demoExercises, importedExercise);
    expect(selection.origin).toBe("imported");
    selection = resolveLessonSelection("morning-steps", detectedLesson, demoExercises, importedExercise);
    expect(selection.origin).toBe("demo");
    expect(selection.exercise.id).toBe("morning-steps");
    selection = resolveLessonSelection("detected", detectedLesson, demoExercises, importedExercise);
    expect(selection.origin).toBe("detected");
    selection = resolveLessonSelection("imported", detectedLesson, demoExercises, importedExercise);
    expect(selection.origin).toBe("imported");
  });

  it("falls back to detected when imported is selected but no lesson was imported", () => {
    const selection = resolveLessonSelection("imported", detectedLesson, demoExercises, null);
    expect(selection.origin).toBe("detected");
    expect(selection.exercise.id).toBe("detected-test");
  });

  it("falls back to the first demo when imported is selected with no detected or imported lesson", () => {
    const selection = resolveLessonSelection("imported", null, demoExercises, null);
    expect(selection.origin).toBe("demo");
    expect(selection.safeLessonId).toBe(demoExercises[0].id);
  });

  it("falls back to imported when detected is selected after the detected lesson was removed", () => {
    const selection = resolveLessonSelection("detected", null, demoExercises, importedExercise);
    expect(selection.origin).toBe("imported");
    expect(selection.exercise).toBe(importedExercise);
  });
});
