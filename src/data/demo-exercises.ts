import type { LessonExercise, NoteEvent } from "@/types/lesson";

const note = (
  id: string,
  midi: number,
  name: string,
  start: number,
  duration: number,
  hand: NoteEvent["hand"],
  finger?: NoteEvent["finger"],
  velocity = 88,
): NoteEvent => ({ id, midi, name, start, duration, hand, velocity, ...(finger ? { finger } : {}) });

export const demoExercises: LessonExercise[] = [
  {
    id: "morning-steps",
    title: "Morning Steps",
    description: "A five-note walk through a bright, steady pulse.",
    bpm: 84,
    beatsPerMeasure: 4,
    duration: 8.57,
    events: [
      note("ms-l-1", 36, "C2", 0, 1.55, "left", 5, 70), note("ms-l-2", 43, "G2", 2.86, 1.55, "left", 1, 66), note("ms-l-3", 45, "A2", 5.71, 1.55, "left", 2, 66),
      note("ms-r-1", 60, "C4", 0, 0.54, "right", 1), note("ms-r-2", 62, "D4", 0.71, 0.54, "right", 2), note("ms-r-3", 64, "E4", 1.43, 0.54, "right", 3), note("ms-r-4", 67, "G4", 2.14, 0.54, "right", 5),
      note("ms-r-5", 69, "A4", 2.86, 0.54, "right", 1), note("ms-r-6", 67, "G4", 3.57, 0.54, "right", 3), note("ms-r-7", 64, "E4", 4.29, 0.54, "right", 2), note("ms-r-8", 62, "D4", 5, 0.54, "right", 1),
      note("ms-r-9", 60, "C4", 5.71, 0.54, "right", 1), note("ms-r-10", 64, "E4", 6.43, 0.54, "right", 3), note("ms-r-11", 67, "G4", 7.14, 0.54, "right", 5), note("ms-r-12", 72, "C5", 7.86, 0.54, "right", 5, 96),
    ],
  },
  {
    id: "open-fifths",
    title: "Open Fifths",
    description: "Slow left-hand anchors with a simple answering phrase.",
    bpm: 72,
    beatsPerMeasure: 4,
    duration: 10,
    events: [
      note("of-l-1", 48, "C3", 0, 2.35, "left", 5, 74), note("of-l-2", 55, "G3", 0, 2.35, "left", 1, 68), note("of-l-3", 45, "A2", 3.33, 2.35, "left", 5, 74), note("of-l-4", 52, "E3", 3.33, 2.35, "left", 1, 68), note("of-l-5", 43, "G2", 6.67, 2.35, "left", 5, 74), note("of-l-6", 50, "D3", 6.67, 2.35, "left", 1, 68),
      note("of-r-1", 64, "E4", 0, 0.7, "right", 2), note("of-r-2", 67, "G4", 0.83, 0.7, "right", 4), note("of-r-3", 69, "A4", 1.67, 0.7, "right", 5), note("of-r-4", 67, "G4", 2.5, 0.7, "right", 4),
      note("of-r-5", 64, "E4", 3.33, 0.7, "right", 2), note("of-r-6", 62, "D4", 4.17, 0.7, "right", 1), note("of-r-7", 64, "E4", 5, 0.7, "right", 2), note("of-r-8", 67, "G4", 5.83, 0.7, "right", 4),
      note("of-r-9", 69, "A4", 6.67, 0.7, "right", 5), note("of-r-10", 72, "C5", 7.5, 0.7, "right", 5), note("of-r-11", 71, "B4", 8.33, 0.7, "right", 4), note("of-r-12", 67, "G4", 9.17, 0.7, "right", 2),
    ],
  },
  {
    id: "quiet-lantern",
    title: "Quiet Lantern",
    description: "A gentle chord study for hearing notes together.",
    bpm: 60,
    beatsPerMeasure: 3,
    duration: 12,
    events: [
      note("ql-l-1", 41, "F2", 0, 2.7, "left", 5, 68), note("ql-l-2", 48, "C3", 0, 2.7, "left", 1, 62), note("ql-l-3", 43, "G2", 3, 2.7, "left", 5, 68), note("ql-l-4", 50, "D3", 3, 2.7, "left", 1, 62), note("ql-l-5", 36, "C2", 6, 2.7, "left", 5, 68), note("ql-l-6", 43, "G2", 6, 2.7, "left", 1, 62), note("ql-l-7", 41, "F2", 9, 2.7, "left", 5, 68), note("ql-l-8", 48, "C3", 9, 2.7, "left", 1, 62),
      note("ql-r-1", 60, "C4", 0, 1.1, "right", 1), note("ql-r-2", 65, "F4", 0, 1.1, "right", 3), note("ql-r-3", 69, "A4", 0, 1.1, "right", 5),
      note("ql-r-4", 62, "D4", 1.5, 1.1, "right", 1), note("ql-r-5", 67, "G4", 1.5, 1.1, "right", 3), note("ql-r-6", 71, "B4", 1.5, 1.1, "right", 5),
      note("ql-r-7", 60, "C4", 3, 1.1, "right", 1), note("ql-r-8", 64, "E4", 3, 1.1, "right", 3), note("ql-r-9", 67, "G4", 3, 1.1, "right", 5),
      note("ql-r-10", 59, "B3", 4.5, 1.1, "right", 1), note("ql-r-11", 64, "E4", 4.5, 1.1, "right", 3), note("ql-r-12", 67, "G4", 4.5, 1.1, "right", 5),
      note("ql-r-13", 60, "C4", 6, 1.1, "right", 1), note("ql-r-14", 65, "F4", 6, 1.1, "right", 3), note("ql-r-15", 69, "A4", 6, 1.1, "right", 5),
      note("ql-r-16", 62, "D4", 7.5, 1.1, "right", 1), note("ql-r-17", 67, "G4", 7.5, 1.1, "right", 3), note("ql-r-18", 71, "B4", 7.5, 1.1, "right", 5),
      note("ql-r-19", 60, "C4", 9, 1.1, "right", 1), note("ql-r-20", 64, "E4", 9, 1.1, "right", 3), note("ql-r-21", 72, "C5", 9, 1.1, "right", 5),
      note("ql-r-22", 67, "G4", 10.5, 1.1, "right", 3), note("ql-r-23", 72, "C5", 10.5, 1.1, "right", 5),
    ],
  },
];
