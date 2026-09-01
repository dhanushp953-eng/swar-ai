// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SongEditorPanel } from "./SongEditorPanel";
import type { SongSheet } from "@/types/song-sheet";

const cleanSheet: SongSheet = {
  id: "fs1-clean",
  metadata: {
    title: "Clean Song",
    composer: "Detected",
    periodOrOrigin: "Full-song analysis",
    attribution: "AI-detected — verify before publication",
    difficulty: "Beginner",
    key: "C major",
    originalKey: "C major",
    timeSignature: "4/4",
    tuning: "E A D G B E",
    defaultCapo: 0,
    description: "Plain lyrics.",
    isPublicDomain: false,
  },
  chordsUsed: ["C", "G", "Am"],
  sections: [
    {
      id: "s1",
      title: "Verse",
      type: "verse",
      lines: [
        {
          id: "l1",
          segments: [
            { chord: "C", text: "Hello " },
            { chord: "G", text: "world" },
          ],
        },
      ],
    },
  ],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("SongEditorPanel", () => {
  it("renders the ChordPro source and a live preview", () => {
    render(<SongEditorPanel songSheet={cleanSheet} />);
    const textarea = screen.getByLabelText("ChordPro source text") as HTMLTextAreaElement;
    expect(textarea.value).toContain("{title:Clean Song}");
    expect(screen.getByText("Clean Song")).toBeTruthy();
    expect(screen.getByText(/Sheet synced/i)).toBeTruthy();
  });

  it("publishes the edited sheet on demand", () => {
    const publish = vi.fn();
    render(<SongEditorPanel songSheet={cleanSheet} onPublish={publish} />);
    const textarea = screen.getByLabelText("ChordPro source text") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "{title:Changed}\n{key:C major}\n\n{section:Verse}\n[Em]new line" } });

    const publishButton = screen.getByRole("button", { name: /publish to song reader/i }) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(false);
    fireEvent.click(publishButton);
    expect(publish).toHaveBeenCalledTimes(1);
    const published = publish.mock.calls[0][0] as SongSheet;
    expect(published.metadata.title).toBe("Changed");
    expect(published.sections[0].lines[0].segments[0].chord).toBe("Em");
  });

  it("disables publish when there are no changes", () => {
    render(<SongEditorPanel songSheet={cleanSheet} onPublish={() => undefined} />);
    const publishButton = screen.getByRole("button", { name: /publish to song reader/i }) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);
  });
});