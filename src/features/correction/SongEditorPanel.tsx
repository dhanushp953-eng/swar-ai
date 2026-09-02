"use client";

import { AlertTriangle, Check, Download, Pencil, RotateCcw, Save, Undo2, Redo2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { SongSheet } from "@/types/song-sheet";
import { useSongEditor } from "./useSongEditor";
import { SongSheetReader } from "@/components/chords/SongSheetReader";
import { songSheetToChordPro } from "@/lib/song-sheet/chordpro";
import {
  exportSongSheetChordPro,
  exportSongSheetJson,
  parseChordProSheet,
  parseSongSheetJson,
  readSheetImportFile,
  MAX_CHORD_PRO_IMPORT_CHARS,
  MAX_SONG_SHEET_IMPORT_BYTES,
} from "@/lib/song-sheet/sheet-exchange";

type SongEditorPanelProps = {
  songSheet: SongSheet;
  onPublish?: (sheet: SongSheet) => void;
};

type ExchangeNotice = { kind: "success" | "error"; message: string } | null;

function describeExchangeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The import could not be completed.";
}

/**
 * ChordPro correction editor for an analyzed song. Typing updates the ChordPro
 * text and the live preview below via SongSheetReader; Publish hands the edited
 * sheet to the caller so the page can show it in the main song reader. The
 * editor also exports the sheet as JSON or ChordPro and imports either format
 * back, validating structure and chord symbols before replacing the draft.
 */
export function SongEditorPanel({ songSheet, onPublish }: SongEditorPanelProps) {
  const editor = useSongEditor(songSheet);
  const [publishedText, setPublishedText] = useState<string | null>(() => editor?.getStateText() ?? null);
  const [notice, setNotice] = useState<ExchangeNotice>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const chordProInputRef = useRef<HTMLInputElement>(null);
  const importingRef = useRef(false);
  if (!editor) return null;

  const preview = editor.editedSheet ?? songSheet;
  const hasUnpublishedChanges = editor.text !== publishedText;
  const currentSheet = editor.editedSheet ?? songSheet;

  const publish = () => {
    if (!editor.editedSheet) return;
    setPublishedText(editor.text);
    onPublish?.(editor.editedSheet);
  };

  const exportJson = () => {
    try {
      const fileName = exportSongSheetJson(currentSheet);
      setNotice({ kind: "success", message: `Exported ${fileName} (JSON).` });
    } catch (error) {
      setNotice({ kind: "error", message: describeExchangeError(error) });
    }
  };

  const exportChordPro = () => {
    try {
      const fileName = exportSongSheetChordPro(currentSheet);
      setNotice({ kind: "success", message: `Exported ${fileName} (ChordPro).` });
    } catch (error) {
      setNotice({ kind: "error", message: describeExchangeError(error) });
    }
  };

  const applyImport = (sheet: SongSheet, chordProText: string) => {
    editor.setText(chordProText);
    setPublishedText(chordProText);
    onPublish?.(sheet);
  };

  const importFile = async (kind: "json" | "chordpro") => {
    if (importingRef.current) return;
    importingRef.current = true;
    try {
      const input = kind === "json" ? jsonInputRef.current : chordProInputRef.current;
      const file = input?.files?.[0] ?? null;
      if (!file) {
        setNotice({ kind: "error", message: "Choose a file to import." });
        return;
      }
      const maxBytes = kind === "json" ? MAX_SONG_SHEET_IMPORT_BYTES : MAX_CHORD_PRO_IMPORT_CHARS;
      const text = await readSheetImportFile(file, maxBytes);
      if (kind === "json") {
        const sheet = parseSongSheetJson(text);
        applyImport(sheet, songSheetToChordPro(sheet));
        setNotice({ kind: "success", message: `Imported ${sheet.metadata.title || "song sheet"} from JSON.` });
      } else {
        const sheet = parseChordProSheet(text, { metadata: songSheet.metadata, chordsUsed: songSheet.chordsUsed });
        const normalized = text.replace(/^\uFEFF/, "");
        applyImport(sheet, normalized);
        setNotice({ kind: "success", message: `Imported ${sheet.metadata.title || "ChordPro"} chords and lyrics.` });
      }
      if (input) input.value = "";
    } catch (error) {
      setNotice({ kind: "error", message: describeExchangeError(error) });
    } finally {
      importingRef.current = false;
    }
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

      <div className="song-editor-exchange" aria-label="Import and export controls">
        <div className="song-editor-exchange-actions">
          <button type="button" className="audio-secondary-button" onClick={exportJson} aria-label="Export song sheet as JSON"><Download size={14} /> Export JSON</button>
          <button type="button" className="audio-secondary-button" onClick={exportChordPro} aria-label="Export song sheet as ChordPro"><Download size={14} /> Export ChordPro</button>
          <button type="button" className="audio-secondary-button" onClick={() => jsonInputRef.current?.click()} aria-label="Import song sheet JSON file"><Upload size={14} /> Import JSON</button>
          <button type="button" className="audio-secondary-button" onClick={() => chordProInputRef.current?.click()} aria-label="Import ChordPro file"><Upload size={14} /> Import ChordPro</button>
        </div>
        <input ref={jsonInputRef} className="song-editor-file-input" type="file" accept=".json,application/json" aria-label="Choose a song sheet JSON file to import" onChange={() => void importFile("json")} />
        <input ref={chordProInputRef} className="song-editor-file-input" type="file" accept=".cho,.chordpro,.txt,text/plain,text/x-chordpro" aria-label="Choose a ChordPro file to import" onChange={() => void importFile("chordpro")} />
        {notice && (
          <p className={`song-editor-notice is-${notice.kind}`} role="status" aria-live="polite">
            {notice.kind === "error" ? <AlertTriangle size={14} /> : <Check size={14} />}
            {notice.message}
          </p>
        )}
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
        <p className="editor-legal-note">Corrections and imports are kept locally in your browser. Only audio you own or are authorised to analyse should be uploaded.</p>
      </div>
    </section>
  );
}