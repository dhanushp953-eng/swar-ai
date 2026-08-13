"use client";

import { Check, FileJson, FolderOpen, X } from "lucide-react";
import { useRef, useState } from "react";
import { parseLessonImport } from "@/features/lesson/lesson-transfer";
import { formatBytes } from "@/lib/audio-api";
import type { LessonExercise } from "@/types/lesson";

type LessonFilePanelProps = {
  importedLesson?: LessonExercise | null;
  onLoadImportedLesson?: (lesson: LessonExercise) => void;
  onRemoveImportedLesson?: () => void;
};

const ACCEPTED_LESSON_FILE = ".lesson,.json,application/json,text/json";

type LessonFileMeta = { name: string; size: number; type: string };

export function LessonFilePanel({ importedLesson, onLoadImportedLesson, onRemoveImportedLesson }: LessonFilePanelProps) {
  const [fileMeta, setFileMeta] = useState<LessonFileMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFile = async (file: File | null) => {
    setError(null);
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError("The lesson file could not be read.");
      return;
    }
    setFileMeta({ name: file.name, size: file.size, type: file.type });
    const result = parseLessonImport(text);
    if (!result.lesson) {
      setError(result.error ?? "The lesson file could not be read.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    onLoadImportedLesson?.(result.lesson);
  };

  const removeLesson = () => {
    setFileMeta(null);
    setError(null);
    onRemoveImportedLesson?.();
    if (inputRef.current) inputRef.current.value = "";
  };

  const lessonFormat = fileMeta ? (fileMeta.type || fileMeta.name.split(".").pop()?.toUpperCase() || "Unknown") : "";

  return (
    <section className="audio-analysis-panel lesson-file-panel" aria-labelledby="lesson-file-title">
      <div className="audio-analysis-heading">
        <div>
          <p className="eyebrow">Bring a lesson file / 01B</p>
          <h2 id="lesson-file-title">Share the shape.</h2>
        </div>
        <p className="audio-analysis-intro">Load a SwarAI lesson file to practice a lesson created elsewhere. Notes, timing and velocity are imported; audio never leaves a file.</p>
      </div>

      <div className="audio-analysis-grid">
        <div>
          <div
            className={`audio-dropzone ${dragging ? "is-dragging" : ""} ${error ? "has-error" : ""}`}
          role="button"
          tabIndex={0}
          aria-label="Drop lesson file here"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void loadFile(event.dataTransfer.files[0] ?? null);
            }}
          >
            <span className="audio-dropzone-icon"><FolderOpen size={20} /></span>
            <strong>{dragging ? "Drop it here" : "Drop a lesson file here"}</strong>
            <span>or choose one from your device</span>
            <small>One .lesson JSON file with notes, timing and velocity</small>
          </div>
          <input ref={inputRef} key="lesson-file-input" className="audio-choose-button" type="file" accept={ACCEPTED_LESSON_FILE} aria-label="Choose a lesson file" onChange={(event) => void loadFile(event.currentTarget.files?.[0] ?? null)} />
          {error && <p className="audio-form-error" role="alert"><X size={14} />{error}</p>}
        </div>

        <div className="audio-analysis-side">
          {fileMeta ? (
            <div className="audio-file-card">
              <span className="audio-file-icon"><FileJson size={18} /></span>
              <div className="audio-file-details">
                <strong>{fileMeta.name}</strong>
                <span>{formatBytes(fileMeta.size)} / {lessonFormat} / {importedLesson?.events.length ?? 0} notes / ready to practice</span>
              </div>
              <button type="button" className="audio-icon-button" onClick={removeLesson} aria-label="Remove imported lesson"><X size={16} /></button>
            </div>
          ) : (
            <div className="lesson-file-empty">
              <Check size={15} />
              <span>No imported lesson yet. Load a .lesson file to add it to the lesson selector.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
