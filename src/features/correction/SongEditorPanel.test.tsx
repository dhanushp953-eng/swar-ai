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

  it("renders the import and export toolbar buttons and file inputs", () => {
    render(<SongEditorPanel songSheet={cleanSheet} />);
    expect(screen.getByRole("button", { name: /export song sheet as json/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /export song sheet as chordpro/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /import song sheet json file/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /import chordpro file/i })).toBeTruthy();

    const jsonInput = screen.getByLabelText("Choose a song sheet JSON file to import") as HTMLInputElement;
    const chordProInput = screen.getByLabelText("Choose a ChordPro file to import") as HTMLInputElement;
    expect(jsonInput.accept).toContain(".json");
    expect(chordProInput.accept).toContain(".cho");
  });

  it("export json triggers a download and shows a success notice", () => {
    const noop = () => undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(noop);
    (URL as unknown as Record<string, unknown>).createObjectURL = () => "blob:test";
    (URL as unknown as Record<string, unknown>).revokeObjectURL = noop;
    render(<SongEditorPanel songSheet={cleanSheet} />);
    fireEvent.click(screen.getByRole("button", { name: /export song sheet as json/i }));
    expect(screen.getByRole("status").textContent).toContain("Exported Clean Song.json (JSON).");
  });

  it("imports JSON, publishes it, and keeps the sheet editable", async () => {
    const publish = vi.fn();
    render(<SongEditorPanel songSheet={cleanSheet} onPublish={publish} />);
    const imported: SongSheet = {
      id: "imported-1",
      metadata: { ...cleanSheet.metadata, title: "Imported JSON Song" },
      chordsUsed: ["Em", "Bm"],
      sections: [
        { id: "s2", title: "Verse", type: "verse", lines: [{ id: "l2", segments: [{ chord: "Em", text: "Imported " }, { chord: "Bm", text: "lyrics" }] }] },
      ],
    };
    const file = new File([JSON.stringify(imported, null, 2)], "import.json", { type: "application/json" });
    const input = screen.getByLabelText("Choose a song sheet JSON file to import") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect((await screen.findByRole("status")).textContent).toContain("Imported Imported JSON Song from JSON.");
    expect(publish).toHaveBeenCalled();
    expect(publish.mock.calls[0][0]).toEqual(imported);

    const textarea = screen.getByLabelText("ChordPro source text") as HTMLTextAreaElement;
    expect(textarea.value).toContain("{title:Imported JSON Song}");
    const publishButton = screen.getByRole("button", { name: /publish to song reader/i }) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);
    fireEvent.change(textarea, { target: { value: textarea.value + "\n[Em]edited" } });
    expect((screen.getByRole("button", { name: /publish to song reader/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("imports ChordPro, publishes it, and shows success", async () => {
    const publish = vi.fn();
    render(<SongEditorPanel songSheet={cleanSheet} onPublish={publish} />);
    const file = new File(["{title:Chord Song}\n\n[C]hello [G]world"], "import.cho", { type: "text/x-chordpro" });
    const input = screen.getByLabelText("Choose a ChordPro file to import") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect((await screen.findByRole("status")).textContent).toContain("Imported Chord Song chords and lyrics.");
    expect(publish).toHaveBeenCalled();
    expect(publish.mock.calls[0][0].metadata.title).toBe("Chord Song");
  });

  it("shows an error notice for a malformed JSON import", async () => {
    render(<SongEditorPanel songSheet={cleanSheet} />);
    const file = new File(["not json"], "bad.json", { type: "application/json" });
    const input = screen.getByLabelText("Choose a song sheet JSON file to import") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect((await screen.findByRole("status")).textContent).toContain("not valid JSON");
  });

  it("shows an error notice for an invalid chord in an imported ChordPro", async () => {
    render(<SongEditorPanel songSheet={cleanSheet} />);
    const file = new File(["[Haddock]bad chord"], "bad.cho", { type: "text/x-chordpro" });
    const input = screen.getByLabelText("Choose a ChordPro file to import") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect((await screen.findByRole("status")).textContent).toContain("Unrecognised chord symbol");
  });

  it("supports undo and redo after an import-driven edit", () => {
    const publish = vi.fn();
    render(<SongEditorPanel songSheet={cleanSheet} onPublish={publish} />);
    const textarea = screen.getByLabelText("ChordPro source text") as HTMLTextAreaElement;
    const undoButton = screen.getByRole("button", { name: /undo last edit/i }) as HTMLButtonElement;
    expect(undoButton.disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "{title:Clean Song}\n{key:C major}\n\n{section:Verse}\n[Em]first edit" } });
    expect(undoButton.disabled).toBe(false);
    fireEvent.click(undoButton);
    expect(textarea.value).toContain("[C]Hello[G]world");

    const redoButton = screen.getByRole("button", { name: /redo last edit/i }) as HTMLButtonElement;
    expect(redoButton.disabled).toBe(false);
    fireEvent.click(redoButton);
    expect(textarea.value).toContain("[Em]first edit");
  });
});