import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { demoExercises } from "@/data/demo-exercises";
import { CoachingPanel } from "./CoachingPanel";

describe("CoachingPanel", () => {
  it("renders an SSR-safe empty state without media or personal-data controls", () => {
    const html = renderToString(<CoachingPanel lesson={demoExercises[0]} recentResults={[]} onPracticeLesson={() => undefined} onPracticeSection={() => undefined} />);
    expect(html).toContain("Personalized coaching / 06D");
    expect(html).toContain("Complete a scored attempt to unlock your plan");
    expect(html).toContain("Only sanitized score summaries are used");
    expect(html).not.toContain("raw_midi");
    expect(html).not.toContain("microphone");
    expect(html).not.toContain("api_key");
  });
});
