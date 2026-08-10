import type { AnalysisJob, MelodyNoteEvent } from "../../lib/audio-api";
import type { LessonExercise, NoteEvent } from "../../types/lesson";
import { midiToNote } from "../../utils/music";

export type DetectedLesson = {
  exercise: LessonExercise;
  audioFile: File;
  estimatedBpm: number | null;
  melodyConfidence: number | null;
  warnings: string[];
};

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function validateEvent(event: MelodyNoteEvent, index: number): string | null {
  if (!Number.isInteger(event.midi_note) || event.midi_note < 0 || event.midi_note > 127) return `Detected note ${index + 1} has an invalid MIDI value.`;
  if (!/^[A-G](?:#)?-?\d+$/.test(event.note_name) || event.note_name !== midiToNote(event.midi_note).name) return `Detected note ${index + 1} has an invalid note name.`;
  if (!isFiniteNumber(event.start_time) || event.start_time < 0) return `Detected note ${index + 1} has an invalid start time.`;
  if (!isFiniteNumber(event.duration) || event.duration <= 0) return `Detected note ${index + 1} has an invalid duration.`;
  if (!Number.isInteger(event.velocity) || event.velocity < 1 || event.velocity > 127) return `Detected note ${index + 1} has an invalid velocity.`;
  if (!isFiniteNumber(event.confidence) || event.confidence < 0 || event.confidence > 1) return `Detected note ${index + 1} has an invalid confidence value.`;
  if (event.hand !== null && event.hand !== "left" && event.hand !== "right") return `Detected note ${index + 1} has an invalid hand assignment.`;
  if (event.finger !== null && ![1, 2, 3, 4, 5].includes(event.finger)) return `Detected note ${index + 1} has an invalid finger assignment.`;
  return null;
}

export function convertAnalysisJobToDetectedLesson(file: File, job: AnalysisJob): { lesson: DetectedLesson | null; error: string | null } {
  if (job.status !== "completed") return { lesson: null, error: "The analysis is not complete yet." };
  if (job.note_events.length === 0) return { lesson: null, error: "No detected melody notes are available to load." };
  for (const [index, event] of job.note_events.entries()) {
    const error = validateEvent(event, index);
    if (error) return { lesson: null, error };
  }
  const events: NoteEvent[] = [...job.note_events].sort((left, right) => left.start_time - right.start_time || left.midi_note - right.midi_note).map((event) => ({
    id: event.id,
    midi: event.midi_note,
    name: event.note_name,
    start: event.start_time,
    duration: event.duration,
    velocity: event.velocity,
    hand: event.hand,
    finger: event.finger,
  }));
  const lastEventEnd = Math.max(...events.map((event) => event.start + event.duration));
  const duration = Math.max(job.duration ?? 0, lastEventEnd);
  if (!isFiniteNumber(duration) || duration <= 0) return { lesson: null, error: "The detected lesson has no valid duration." };
  const exercise: LessonExercise = {
    id: `detected-${job.job_id}`,
    title: "Detected melody",
    description: "Detected from your audio. Hand and finger assignments remain unassigned.",
    bpm: job.estimated_bpm ?? 0,
    beatsPerMeasure: 4,
    duration,
    events,
  };
  return {
    lesson: {
      exercise,
      audioFile: file,
      estimatedBpm: job.estimated_bpm,
      melodyConfidence: job.melody_confidence,
      warnings: job.warnings,
    },
    error: null,
  };
}
