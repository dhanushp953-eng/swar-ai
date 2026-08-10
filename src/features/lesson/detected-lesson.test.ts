import { describe, expect, it } from "vitest";
import type { AnalysisJob } from "@/lib/audio-api";
import { convertAnalysisJobToDetectedLesson } from "./detected-lesson";

const file = new File([new Uint8Array([1, 2, 3])], "melody.wav", { type: "audio/wav" });

function job(noteEvents: AnalysisJob["note_events"]): AnalysisJob {
  return {
    job_id: "job-1",
    status: "completed",
    progress: 100,
    result: null,
    error: null,
    duration: 2,
    estimated_bpm: 120,
    beat_timestamps: [],
    rhythm_confidence: 0.9,
    warnings: ["local warning"],
    analysis_engine: "librosa.beat.beat_track",
    analysis_version: "3.0.0",
    note_events: noteEvents,
    melody_confidence: 0.8,
    melody_engine: "librosa.pyin",
    melody_analysis_version: "3.1.0",
  };
}

const note = (overrides: Partial<AnalysisJob["note_events"][number]> = {}): AnalysisJob["note_events"][number] => ({ id: "n", midi_note: 60, note_name: "C4", start_time: 0, duration: 0.5, velocity: 100, confidence: 0.9, hand: null, finger: null, ...overrides });

describe("detected lesson conversion", () => {
  it("sorts valid events and preserves null assignments", () => {
    const converted = convertAnalysisJobToDetectedLesson(file, job([note({ id: "late", start_time: 1, note_name: "E4", midi_note: 64 }), note({ id: "early" })]));
    expect(converted.error).toBeNull();
    expect(converted.lesson?.exercise.events.map((event) => event.id)).toEqual(["early", "late"]);
    expect(converted.lesson?.exercise.events[0].hand).toBeNull();
    expect(converted.lesson?.exercise.events[0].finger).toBeNull();
  });

  it.each([
    ["invalid MIDI", { midi_note: 128 }],
    ["invalid note name", { note_name: "D4" }],
    ["invalid start", { start_time: -1 }],
    ["invalid duration", { duration: 0 }],
    ["invalid velocity", { velocity: 128 }],
    ["invalid confidence", { confidence: 2 }],
  ])("rejects %s without inventing events", (_label, overrides) => {
    const converted = convertAnalysisJobToDetectedLesson(file, job([note(overrides)]));
    expect(converted.lesson).toBeNull();
    expect(converted.error).toBeTruthy();
  });

  it("rejects an empty detected melody", () => {
    const converted = convertAnalysisJobToDetectedLesson(file, job([]));
    expect(converted.lesson).toBeNull();
    expect(converted.error).toContain("No detected melody");
  });
});
