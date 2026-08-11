"use client";

import { Download } from "lucide-react";
import type { LessonExportState } from "./lesson-export";

type ExportLessonControlsProps = {
  state: LessonExportState;
  canExportOriginal: boolean;
  correctionCount: number;
  onExportOriginal: () => void;
  onExportCurrent: () => void;
};

/**
 * Presentational export panel. The original export is only offered when the
 * pristine detected analysis still exists; the current export always reflects
 * whatever lesson is loaded (detected, corrected or imported). Corrections are
 * called out on the button and via a badge.
 */
export function ExportLessonControls({ state, canExportOriginal, correctionCount, onExportOriginal, onExportCurrent }: ExportLessonControlsProps) {
  const busy = state.status === "loading";
  const statusMessage = state.status === "success" ? `Exported ${state.fileName}.` : state.status === "error" ? state.message : null;
  return (
    <section className="lesson-export-controls" aria-label="Lesson export" aria-busy={busy}>
      <div className="lesson-export-heading">
        <strong>Export lesson</strong>
        {correctionCount > 0 && <span className="lesson-export-badge">Contains {correctionCount} correction{correctionCount === 1 ? "" : "s"}</span>}
      </div>
      <div className="lesson-export-actions">
        {canExportOriginal && <button type="button" className="lesson-export-btn" onClick={onExportOriginal} disabled={busy} aria-busy={busy}><Download size={14} /> Export original lesson</button>}
        <button type="button" className="lesson-export-btn" onClick={onExportCurrent} disabled={busy} aria-busy={busy}><Download size={14} /> Export current lesson{correctionCount > 0 ? " (corrected)" : ""}</button>
      </div>
      <p className="lesson-export-notice">Lesson JSON contains note data only; source audio is not included.</p>
      {statusMessage && <p className={`lesson-export-status ${state.status === "error" ? "lesson-export-error" : "lesson-export-ok"}`} role={state.status === "error" ? "alert" : "status"}>{statusMessage}</p>}
    </section>
  );
}
