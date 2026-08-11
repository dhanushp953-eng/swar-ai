import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { CorrectionEditorPanel } from "./CorrectionEditorPanel";
import { CorrectionSession } from "./correction-session";
import type { CorrectionEditorApi } from "./useCorrectionEditor";
import type { LessonExercise, NoteEvent } from "../../types/lesson";

function note(id: string, midi: number, name: string, start: number, duration = 0.5, velocity = 100): NoteEvent {
  return { id, midi, name, start, duration, velocity, hand: null };
}

function makeExercise(): LessonExercise {
  return {
    id: "detected-abc",
    title: "Detected melody",
    description: "test",
    bpm: 80,
    beatsPerMeasure: 4,
    duration: 3,
    events: [
      note("n1", 60, "C4", 0),
      note("n2", 62, "D4", 0.7),
      note("n3", 64, "E4", 1.4),
      note("n4", 67, "G4", 2.1),
    ],
  };
}

function createApi(session: CorrectionSession): CorrectionEditorApi {
  return {
    select: (id) => session.select(id),
    selectByIndex: (index) => session.selectByIndex(index),
    selectPrevious: () => session.selectPrevious(),
    selectNext: () => session.selectNext(),
    addNote: (input) => session.addNote(input),
    deleteNote: (id) => session.deleteNote(id),
    deleteSelected: () => session.deleteSelected(),
    changeMidi: (id, midi) => session.changeMidi(id, midi),
    changeStart: (id, start) => session.changeStart(id, start),
    changeDuration: (id, duration) => session.changeDuration(id, duration),
    changeVelocity: (id, velocity) => session.changeVelocity(id, velocity),
    moveSelected: (delta) => session.moveSelected(delta),
    shiftAll: (delta) => session.shiftAll(delta),
    resetSelected: () => session.resetSelected(),
    resetAll: () => session.resetAll(),
    undo: () => session.undo(),
    redo: () => session.redo(),
  };
}

function renderPanel(session: CorrectionSession): string {
  const onClose = vi.fn();
  return renderToString(<CorrectionEditorPanel api={createApi(session)} session={session} derived={session.getDerived()} onClose={onClose} />);
}function resetButtonHtml(html: string): string {
  const marker = "correction-reset-note-btn";
  const idx = html.indexOf(marker);
  if (idx === -1) return "";
  const start = html.lastIndexOf("<button", idx);
  const end = html.indexOf("</button>", idx);
  return html.slice(start, end);
}

describe("CorrectionEditorPanel reset selected note button", () => {
  it("is not rendered when no note is selected", () => {
    const session = new CorrectionSession(makeExercise());
    const html = renderPanel(session);
    expect(html).not.toContain("Reset selected note");
  });

  it("is rendered but disabled for an original, unchanged note", () => {
    const session = new CorrectionSession(makeExercise());
    session.select("n2");
    const html = renderPanel(session);
    expect(html).toContain("Reset selected note");
    expect(resetButtonHtml(html)).toContain('disabled=""');
    expect(resetButtonHtml(html)).toContain('aria-disabled="true"');
    expect(html).toContain("already matches its original detection");
  });

  it("is rendered and enabled for an edited note", () => {
    const session = new CorrectionSession(makeExercise());
    session.changeMidi("n2", 65);
    session.select("n2");
    const html = renderPanel(session);
    const btn = resetButtonHtml(html);
    expect(html).toContain("Reset selected note");
    expect(btn).not.toContain('disabled=""');
    expect(btn).toContain('aria-disabled="false"');
    expect(html).not.toContain("already matches its original detection");
  });

  it("is rendered but disabled for an added note, explaining it must be deleted", () => {
    const session = new CorrectionSession(makeExercise());
    const id = session.addNote({ midi: 69, start: 2.6, duration: 0.4, velocity: 88 });
    session.select(id as string);
    const html = renderPanel(session);
    expect(html).toContain("Reset selected note");
    expect(resetButtonHtml(html)).toContain('disabled=""');
    expect(resetButtonHtml(html)).toContain('aria-disabled="true"');
    expect(html).toContain("has no original detection");
  });
});

describe("CorrectionEditorPanel for an imported lesson", () => {
  function renderImported(session: CorrectionSession): string {
    return renderToString(
      <CorrectionEditorPanel
        api={createApi(session)}
        session={session}
        derived={session.getDerived()}
        onClose={vi.fn()}
        lessonLabel="Imported lesson"
        sourceAdjective="imported"
      />,
    );
  }

  it("labels the panel with the imported lesson heading", () => {
    const session = new CorrectionSession(makeExercise());
    session.select("n2");
    const html = renderImported(session);
    expect(html).toContain("aria-label=\"Imported lesson correction editor\"");
    expect(html).toContain("<h3>Imported lesson</h3>");
  });

  it("explains resetting against the originally imported notes", () => {
    const session = new CorrectionSession(makeExercise());
    session.select("n2");
    const html = renderImported(session);
    expect(html).toContain("matches its original imported value");
    expect(html).not.toContain("matches its original detection");
  });

  it("uses imported wording when a note has no original to reset to", () => {
    const session = new CorrectionSession(makeExercise());
    const id = session.addNote({ midi: 69, start: 2.6, duration: 0.4, velocity: 88 });
    session.select(id as string);
    const html = renderImported(session);
    expect(html).toContain("has no original imported value");
    expect(html).not.toContain("has no original detection");
  });
});
