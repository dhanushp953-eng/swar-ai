"use client";

import { AlertTriangle, Check, Pencil, RotateCcw, Save, Undo2, Redo2 } from "lucide-react";
import { useState } from "react";
import type { SongSheet } from "@/types/song-sheet";
import { useSongEditor } from "./useSongEditor";
import { SongSheetReader } from "@/components/chords/SongSheetReader";

type SongEditorPanelProps = {
  songSheet: SongSheet;
  onPublish?: (sheet: SongSheet) => void;
};

/**
 * ChordPro correction editor for an analyzed song. Typing updates the ChordPro
 * text and the live preview below via SongSheetReader; Publish hands the edited
 * sheet to the caller so the page can show it in the main song reader.
 */
export function SongEditorPanel({ songSheet, onPublish }: SongEditorPanelProps) {
  const editor = useSongEditor(songSheet);
  const [publishedText, setPublishedText] = useState<string | null>(() => editor?.getStateText() ?? null);
  if (!editor) return null;

  const preview = editor.editedSheet ?? songSheet;
  const hasUnpublishedChanges = editor.text !== publishedText;

  const publish = () => {
    if (!editor.editedSheet) return;
    setPublishedText(editor.text);
    onPublish?.(editor.editedSheet);
  };

  return (
    <section id="song-sheet-editor" className="song-editor-panel" aria-labelledby="song-editor-title">
      <div className="audio-analysis-heading">
        <div>
          <p className="eyebrow">Correct / CL1</p>
          <h2 id="song-editor-title">Fix the sheet.</h2>
        </div>
        <p className="audio-analysis-intro">AI lyrics and chords can drift. Edit the ChordPro below to correct words and chord names, watch the live preview, then publish to the song reader.</p>
      </div>

      <div className="song-editor-toolbar" aria-label="Song editor controls">
        <span className={`song-editor-state ${hasUnpublishedChanges ? "is-dirty" : "is-clean"}`}>{hasUnpublishedChanges ? <AlertTriangle size={13} /> : <Check size={13} />}{hasUnpublishedChanges ? "Unsaved changes" : "Sheet synced"}</span>
        <span className="song-editor-counts">{editor.derived.chordCount} chords · {editor.derived.lineCount} lines</span>
        <div className="song-editor-actions">
          <button type="button" className="audio-secondary-button" onClick={editor.undo} disabled={!editor.derived.canUndo} aria-label="Undo last edit"><Undo2 size={14} /> Undo</button>
          <button type="button" className="audio-secondary-button" onClick={editor.redo} disabled={!editor.derived.canRedo} aria-label="Redo last edit"><Redo2 size={14} /> Redo</button>
          <button type="button" className="audio-secondary-button" onClick={editor.reset} disabled={!editor.derived.dirty} aria-label="Reset to the analysed sheet"><RotateCcw size={14} /> Reset</button>
        </div>
      </div>

      <div className="song-editor-workspace">
        <div className="song-editor-source">
          <span className="song-editor-source-label"><Pencil size={13} /> ChordPro source</span>
          <textarea
            className="song-editor-textarea"
            value={editor.text}
            onChange={(event) => editor.setText(event.target.value)}
            aria-label="ChordPro source text"
            spellCheck={false}
          />
        </div>
        <div className="song-editor-preview">
          <span className="song-editor-source-label">Live preview</span>
          <SongSheetReader songSheet={preview} />
        </div>
      </div>

      <div className="song-editor-foot">
        <button type="button" className="primary-button audio-submit-button" onClick={publish} disabled={!hasUnpublishedChanges}><Save size={15} /> Publish to song reader</button>
        <p className="editor-legal-note">Corrections are kept locally in your browser. Only audio you own or are authorised to analyse should be uploaded.</p>
      </div>
    </section>
  );
}