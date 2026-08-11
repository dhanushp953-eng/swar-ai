import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { LessonExercise, NoteEvent } from "../../types/lesson";
import type { LessonExportNote } from "./lesson-transfer";
import { ExportLessonControls } from "./ExportLessonControls";
import { createLessonExportJson, runLessonExport, sanitizeExportFilename, triggerFileDownload } from "./lesson-export";
import type { LessonExportProviders, LessonExportState } from "./lesson-export";

function note(id: string, midi: number, name: string, start: number, duration = 0.5, velocity = 100): NoteEvent {
  return { id, midi, name, start, duration, velocity, hand: null };
}

function makeLesson(title = "Detected melody", overrides: Partial<LessonExercise> = {}): LessonExercise {
  return {
    id: "detected-abc",
    title,
    description: "Detected from your audio.",
    bpm: 0,
    beatsPerMeasure: 4,
    duration: 1.5,
    events: [note("n1", 60, "C4", 0), note("n2", 64, "E4", 0.7)],
    ...overrides,
  };
}

function makeProviders(overrides: Partial<LessonExportProviders> = {}): LessonExportProviders {
  return { original: () => makeLesson(), current: () => makeLesson(), ...overrides };
}

function captureDownload(): { download: (fileName: string, content: string, mimeType: string) => void; calls: { fileName: string; content: string; mimeType: string }[] } {
  const calls: { fileName: string; content: string; mimeType: string }[] = [];
  return {
    calls,
    download: (fileName, content, mimeType) => {
      calls.push({ fileName, content, mimeType });
    },
  };
}

describe("sanitizeExportFilename", () => {
  it("keeps plain titles as-is with a .json suffix", () => {
    expect(sanitizeExportFilename("Detected melody")).toBe("Detected melody.json");
  });

  it("replaces path separators and reserved characters", () => {
    expect(sanitizeExportFilename("C:\\Users\\dhanush\\lesson")).toBe("C Users dhanush lesson.json");
    expect(sanitizeExportFilename('weird:name?"*<>|')).toBe("weird name.json");
  });

  it("strips control characters", () => {
    expect(sanitizeExportFilename("lesson\u0000\u0001name")).toBe("lesson name.json");
  });

  it("collapses whitespace runs", () => {
    expect(sanitizeExportFilename("My   corrected   lesson")).toBe("My corrected lesson.json");
  });

  it("keeps unicode letters", () => {
    expect(sanitizeExportFilename("राग ईयर")).toBe("राग ईयर.json");
  });

  it("strips leading and trailing dots and spaces", () => {
    expect(sanitizeExportFilename(" .hidden. ")).toBe("hidden.json");
  });

  it("removes a trailing .json suffix before appending it again", () => {
    expect(sanitizeExportFilename("lesson.json")).toBe("lesson.json");
  });

  it("caps the name at a reasonable length", () => {
    expect(sanitizeExportFilename("x".repeat(200))).toHaveLength(80 + ".json".length);
  });

  it("falls back to lesson when nothing usable remains", () => {
    expect(sanitizeExportFilename("")).toBe("lesson.json");
    expect(sanitizeExportFilename("...")).toBe("lesson.json");
    expect(sanitizeExportFilename("   ")).toBe("lesson.json");
  });
});

describe("triggerFileDownload", () => {
  it("creates one object URL, downloads once and revokes exactly once afterwards", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:mock-lesson");
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = revokeObjectURL;
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const anchor = { href: "", download: "", rel: "", click, remove };
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor), body: { appendChild } });
    try {
      triggerFileDownload("lesson.json", '{"ok":true}');
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(appendChild).toHaveBeenCalledWith(anchor);
      expect(anchor.href).toBe("blob:mock-lesson");
      expect(anchor.download).toBe("lesson.json");
      expect(click).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(0);
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-lesson");
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe("runLessonExport", () => {
  it("exports the current lesson through the injected downloader", () => {
    const current = makeLesson("Corrected melody", { events: [note("n1", 65, "F4", 0), note("n2", 67, "G4", 0.7)] });
    const capture = captureDownload();
    const state = runLessonExport("current", makeProviders({ current: () => current }), capture.download);
    expect(state.status).toBe("success");
    expect(state.kind).toBe("current");
    const success = expectSuccess(state);
    expect(success.fileName).toBe("Corrected melody.json");
    expect(capture.calls).toHaveLength(1);
    expect(capture.calls[0].fileName).toBe("Corrected melody.json");
    expect(capture.calls[0].mimeType).toBe("application/json");
    const parsed = JSON.parse(capture.calls[0].content);
    expect(parsed.lesson.title).toBe("Corrected melody");
    expect(parsed.lesson.events.map((event: { midi: number }) => event.midi)).toEqual([65, 67]);
  });

  it("exports the pristine original lesson when requested", () => {
    const original = makeLesson("Detected melody");
    const capture = captureDownload();
    const state = runLessonExport("original", makeProviders({ original: () => original }), capture.download);
    expect(state.status).toBe("success");
    const parsed = JSON.parse(capture.calls[0].content);
    expect(parsed.lesson.events.map((event: { midi: number }) => event.midi)).toEqual([60, 64]);
    expect(parsed.lesson.title).toBe("Detected melody");
  });

  it("reports an error without downloading when the requested lesson is missing", () => {
    const capture = captureDownload();
    const state = runLessonExport("original", makeProviders({ original: () => null }), capture.download);
    expect(state.status).toBe("error");
    expect(state.kind).toBe("original");
    expect(expectError(state).message).toBe("There is no lesson to export.");
    expect(capture.calls).toHaveLength(0);
  });

  it("surfaces serialization errors from the transfer validator", () => {
    const invalid = makeLesson("Broken melody", { events: [note("n1", 60, "C4", 0, 0.5, 9999)] });
    const capture = captureDownload();
    const state = runLessonExport("current", makeProviders({ current: () => invalid }), capture.download);
    expect(state.status).toBe("error");
    expect(expectError(state).message).toContain("could not be exported");
    expect(expectError(state).message).toContain("velocity");
    expect(capture.calls).toHaveLength(0);
  });

  it("never includes audio, blob URLs, paths, secrets or undo history in the JSON", () => {
    const taintedLesson = {
      ...makeLesson(),
      audioFile: { name: "take.wav" },
      objectUrl: "blob:http://localhost:3000/abc",
      sourcePath: "C:\\Users\\dhanush\\take.wav",
      apiKey: "sk-secret",
      secret: "hunter2",
      undoHistory: [{ midi: 60 }],
      redoHistory: [{ midi: 64 }],
      events: makeLesson().events.map((event) => ({
        ...event,
        confidence: 0.9 as number | null,
        audioFile: { name: "take.wav" },
        objectUrl: "blob:http://localhost:3000/abc",
      })) as LessonExportNote[],
    } as unknown as LessonExercise;
    const jsonText = createLessonExportJson(taintedLesson);
    expect(jsonText).not.toContain("blob:");
    expect(jsonText).not.toContain("audioFile");
    expect(jsonText).not.toContain("objectUrl");
    expect(jsonText).not.toContain("take.wav");
    expect(jsonText).not.toContain("C:\\\\");
    expect(jsonText).not.toContain("sourcePath");
    expect(jsonText).not.toContain("apiKey");
    expect(jsonText).not.toContain("sk-secret");
    expect(jsonText).not.toContain("secret");
    expect(jsonText).not.toContain("hunter2");
    expect(jsonText).not.toContain("undoHistory");
    expect(jsonText).not.toContain("redoHistory");
    const parsed = JSON.parse(jsonText);
    expect(Object.keys(parsed)).toEqual(expect.arrayContaining(["schema", "version", "exportedAt", "lesson"]));
    expect(parsed.lesson.events[0]).toMatchObject({ id: "n1", midi: 60, name: "C4", confidence: 0.9 });
  });
});

describe("ExportLessonControls", () => {
  const handlers = { onExportOriginal: vi.fn(), onExportCurrent: vi.fn() };
  const base: LessonExportState = { status: "idle", kind: null };

  it("offers only the current export when there is no original lesson", () => {
    const html = renderToString(<ExportLessonControls state={base} canExportOriginal={false} correctionCount={0} {...handlers} />);
    expect(html).not.toContain("Export original lesson");
    expect(html).toContain("Export current lesson");
  });

  it("offers both exports when the original detected lesson is available", () => {
    const html = renderToString(<ExportLessonControls state={base} canExportOriginal correctionCount={0} {...handlers} />);
    expect(html).toContain("Export original lesson");
    expect(html).toContain("Export current lesson");
  });

  it("shows a corrections badge and marks the current export as corrected", () => {
    const html = stripComments(renderToString(<ExportLessonControls state={base} canExportOriginal correctionCount={3} {...handlers} />));
    expect(html).toContain("Contains 3 corrections");
    expect(html).toContain("Export current lesson (corrected)");
  });

  it("keeps the singular badge for a single correction", () => {
    const html = stripComments(renderToString(<ExportLessonControls state={base} canExportOriginal={false} correctionCount={1} {...handlers} />));
    expect(html).toContain("Contains 1 correction");
  });

  it("states that the JSON contains note data only and no audio", () => {
    const html = renderToString(<ExportLessonControls state={base} canExportOriginal={false} correctionCount={0} {...handlers} />);
    expect(html).toContain("Lesson JSON contains note data only; source audio is not included.");
  });

  it("disables the buttons and sets aria-busy while exporting", () => {
    const loading: LessonExportState = { status: "loading", kind: "current" };
    const html = renderToString(<ExportLessonControls state={loading} canExportOriginal correctionCount={0} {...handlers} />);
    const originalButton = extractButton(html, "Export original lesson");
    const currentButton = extractButton(html, "Export current lesson");
    expect(originalButton).toContain('disabled=""');
    expect(originalButton).toContain('aria-busy="true"');
    expect(currentButton).toContain('disabled=""');
    expect(currentButton).toContain('aria-busy="true"');
    expect(html).toContain('aria-busy="true"');
  });

  it("announces a successful export politely", () => {
    const success: LessonExportState = { status: "success", kind: "current", fileName: "My Lesson.json" };
    const html = renderToString(<ExportLessonControls state={success} canExportOriginal={false} correctionCount={0} {...handlers} />);
    expect(html).toContain("Exported My Lesson.json.");
    expect(html).toContain('role="status"');
  });

  it("announces export errors as alerts", () => {
    const error: LessonExportState = { status: "error", kind: "current", message: "The lesson could not be exported: Note 1 velocity must be an integer." };
    const html = renderToString(<ExportLessonControls state={error} canExportOriginal={false} correctionCount={0} {...handlers} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("The lesson could not be exported: Note 1 velocity must be an integer.");
  });

  it("shows nothing in the status region while idle", () => {
    const html = renderToString(<ExportLessonControls state={base} canExportOriginal={false} correctionCount={0} {...handlers} />);
    expect(html).not.toContain("Exported");
    expect(html).not.toContain("role=\"status\"");
    expect(html).not.toContain("role=\"alert\"");
  });
});

function extractButton(html: string, label: string): string {
  const idx = html.indexOf(label);
  if (idx === -1) return "";
  const start = html.lastIndexOf("<button", idx);
  const end = html.indexOf("</button>", idx) + "</button>".length;
  return html.slice(start, end);
}

function stripComments(html: string): string {
  return html.replace(/<!-- -->/g, "");
}

function expectSuccess(state: LessonExportState): Extract<LessonExportState, { status: "success" }> {
  if (state.status !== "success") throw new Error(`Expected success, got "${state.status}".`);
  return state;
}

function expectError(state: LessonExportState): Extract<LessonExportState, { status: "error" }> {
  if (state.status !== "error") throw new Error(`Expected error, got "${state.status}".`);
  return state;
}
