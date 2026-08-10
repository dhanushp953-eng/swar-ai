export type LessonHand = "left" | "right";
export type HandMode = LessonHand | "both";
export type LessonStatus = "idle" | "count-in" | "playing" | "paused" | "complete";

export type NoteEvent = {
  id: string;
  midi: number;
  name: string;
  start: number;
  duration: number;
  velocity: number;
  hand: LessonHand | null;
  finger?: 1 | 2 | 3 | 4 | 5 | null;
};

export type LessonExercise = {
  id: string;
  title: string;
  description: string;
  bpm: number;
  beatsPerMeasure: number;
  duration: number;
  events: NoteEvent[];
};
