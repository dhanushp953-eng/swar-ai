import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { demoExercises } from "@/data/demo-exercises";
import { TutorPanel } from "./TutorPanel";
import type { TutorPracticeSnapshot } from "@/lib/tutor-api";

const snapshot: TutorPracticeSnapshot = {
  scores: { overall: 74, pitch: 86, timing: 61, rhythm: null, duration: 70 },
  mistake_counts: { wrong_pitch: 1, early: 2, late: 1, missed: 1, extra: 0 },
  difficult_notes: ["E4", "G4"],
  practice_mode: "full",
};

describe("TutorPanel", () => {
  it("renders an accessible empty state before a scored attempt", () => {
    const html = renderToString(<TutorPanel lesson={demoExercises[0]} practiceSnapshot={null} />);
    expect(html).toContain('aria-labelledby="tutor-title"');
    expect(html).toContain("Complete a scored practice attempt first");
    expect(html).toContain("No audio, MIDI, files, or personal data");
    expect(html).not.toContain("Ask about my performance");
  });

  it("renders quick actions and question form after a scored attempt", () => {
    const html = renderToString(<TutorPanel lesson={demoExercises[0]} practiceSnapshot={snapshot} />);
    expect(html).toContain("Ask about my performance");
    expect(html).toContain("Explain my mistakes");
    expect(html).toContain("Create a practice plan");
    expect(html).toContain('aria-label="Ask tutor"');
    expect(html).toContain("Provider availability");
  });

  it("does not render any client-side media or raw performance payload controls", () => {
    const html = renderToString(<TutorPanel lesson={demoExercises[0]} practiceSnapshot={snapshot} />);
    expect(html).not.toContain("microphone");
    expect(html).not.toContain("audio_recording");
    expect(html).not.toContain("raw_midi");
    expect(html).not.toContain("api_key");
  });
});
