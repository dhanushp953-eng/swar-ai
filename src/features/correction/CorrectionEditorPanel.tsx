"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Plus,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { CorrectionDerivedState, CorrectionNote, CorrectionNoteInput } from "./correction-engine";
import { CORRECTION_MIDI_MAX, CORRECTION_MIDI_MIN, CORRECTION_VELOCITY_MAX, CORRECTION_VELOCITY_MIN } from "./correction-engine";
import { getResetSelectedStatus, mapCorrectionShortcut, requiresConfirmation } from "./correction-session";
import type { ResetSelectedStatus } from "./correction-session";
import type { CorrectionSession } from "./correction-session";
import type { CorrectionEditorApi } from "./useCorrectionEditor";
import { midiToNote } from "../../utils/music";
import { ConfirmDialog } from "./ConfirmDialog";

const NOTE_OPTIONS = Array.from({ length: CORRECTION_MIDI_MAX - CORRECTION_MIDI_MIN + 1 }, (_, index) => {
  const midi = CORRECTION_MIDI_MIN + index;
  return { midi, name: midiToNote(midi).name };
});

const DEFAULT_MOVE_STEP = 0.1;

const MIDI_FIELD = { min: CORRECTION_MIDI_MIN, max: CORRECTION_MIDI_MAX, integer: true as const };
const START_FIELD = { min: 0, max: 999, integer: false as const };
const DURATION_FIELD = { min: 0.01, max: 999, integer: false as const };
const VELOCITY_FIELD = { min: CORRECTION_VELOCITY_MIN, max: CORRECTION_VELOCITY_MAX, integer: true as const };

type Task = "delete" | "reset-all" | "reset-note" | null;

function validateNumber(value: number, options: { min: number; max: number; integer: boolean }): string | null {
  if (!Number.isFinite(value)) return "Enter a number.";
  if (options.integer && !Number.isInteger(value)) return "Enter a whole number.";
  if (value < options.min || value > options.max) return `Must be between ${options.min} and ${options.max}.`;
  return null;
}

function NumberField(props: {
  id: string;
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  integer: boolean;
  commit: (value: number) => void;
}) {
  const { id, label, value, step, min, max, integer, commit } = props;
  const [committedValue, setCommittedValue] = useState(value);
  const [draft, setDraft] = useState<string>(String(value));
  const [error, setError] = useState<string | null>(null);

  if (committedValue !== value) {
    setCommittedValue(value);
    setDraft(String(value));
    setError(null);
  }

  const handleChange = (raw: string) => {
    setDraft(raw);
    if (raw.trim() === "") {
      setError("Required.");
      return;
    }
    const parsed = Number(raw);
    const validationError = validateNumber(parsed, { min, max, integer });
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    commit(parsed);
  };

  const handleBlur = () => {
    if (error) {
      setDraft(String(value));
      setError(null);
    }
  };

  return (
    <label className={`correction-field ${error ? "has-error" : ""}`}>
      {label}
      <input
        id={id}
        type="number"
        value={draft}
        step={step}
        min={min}
        max={max}
        inputMode={integer ? "numeric" : "decimal"}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => handleChange(event.currentTarget.value)}
        onBlur={handleBlur}
      />
      {error && (
        <span className="correction-field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </label>
  );
}

type CorrectionEditorPanelProps = {
  api: CorrectionEditorApi;
  session: CorrectionSession;
  derived: CorrectionDerivedState;
  onClose: () => void;
};

export function CorrectionEditorPanel({ api, session, derived, onClose }: CorrectionEditorPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [step, setStep] = useState(DEFAULT_MOVE_STEP);
  const [task, setTask] = useState<Task>(null);

  const events = session.getEvents();
  const selectedNote = session.getSelectedNote();
  const selectedIndex = session.getSelectedIndex();
  const noteCount = session.getNoteCount();
  const editedIds = useMemo(() => new Set(derived.editedNoteIds), [derived.editedNoteIds]);
  const addedIds = useMemo(() => new Set(derived.addedNoteIds), [derived.addedNoteIds]);
  const resetStatus: ResetSelectedStatus = getResetSelectedStatus(selectedNote ? selectedNote.id : null, derived.editedNoteIds, derived.addedNoteIds);

  const safeStep = Number.isFinite(step) && step > 0 ? step : DEFAULT_MOVE_STEP;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = Boolean(target && target.closest && target.closest("input, textarea, select"));
      if (isTyping) return;
      if (task) return;
      const shortcut = mapCorrectionShortcut(event);
      if (shortcut) {
        event.preventDefault();
        if (shortcut === "undo") api.undo();
        else api.redo();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        api.select(null);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && session.selectedNoteId) {
        event.preventDefault();
        setTask("delete");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [api, session, task]);

  const handleAddNote = () => {
    const lastEnd = events.reduce((max, event) => Math.max(max, event.start + event.duration), 0);
    const input: CorrectionNoteInput = {
      midi: selectedNote?.midi ?? 60,
      start: selectedNote ? selectedNote.start + selectedNote.duration : lastEnd,
      duration: selectedNote?.duration ?? 0.5,
      velocity: selectedNote?.velocity ?? 88,
    };
    const id = api.addNote(input);
    if (id) api.select(id);
  };

  const handleDelete = () => {
    if (requiresConfirmation("delete-note")) setTask("delete");
    else api.deleteSelected();
  };

  const handleResetAll = () => {
    if (requiresConfirmation("reset-all")) setTask("reset-all");
    else api.resetAll();
  };

  const handleResetSelected = () => {
    if (requiresConfirmation("reset-note")) setTask("reset-note");
    else api.resetSelected();
  };

  return (
    <div className="correction-editor" role="region" aria-label="Detected lesson correction editor">
      <div className="correction-editor-header">
        <div>
          <p className="eyebrow">Correction editor</p>
          <h3>Detected lesson</h3>
        </div>
        <div className="correction-status">
          <span className="correction-chip correction-chip-count">
            {derived.correctionCount} change{derived.correctionCount === 1 ? "" : "s"}
          </span>
          <span className={`correction-chip ${derived.dirty ? "correction-chip-dirty" : ""}`}>
            {derived.dirty ? "Unsaved session" : "No changes"}
          </span>
        </div>
        <div className="correction-header-actions">
          <button
            type="button"
            className="correction-btn"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            {collapsed ? "Expand" : "Collapse"}
          </button>
          <button type="button" className="correction-btn" onClick={onClose}>
            <X size={14} /> Done
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="correction-editor-body">
          <div className="correction-toolbar">
            <button type="button" className="correction-btn" onClick={api.undo} disabled={!derived.canUndo}>
              <Undo2 size={14} /> Undo
            </button>
            <button type="button" className="correction-btn" onClick={api.redo} disabled={!derived.canRedo}>
              <Redo2 size={14} /> Redo
            </button>
            <span className="correction-toolbar-sep" aria-hidden="true" />
            <button type="button" className="correction-btn primary" onClick={handleAddNote}>
              <Plus size={14} /> Add note
            </button>
            <span className="correction-toolbar-sep" aria-hidden="true" />
            <button type="button" className="correction-btn" onClick={() => api.shiftAll(-safeStep)} disabled={noteCount === 0}>
              <ChevronsLeft size={14} /> Shift earlier
            </button>
            <button type="button" className="correction-btn" onClick={() => api.shiftAll(safeStep)} disabled={noteCount === 0}>
              <ChevronsRight size={14} /> Shift later
            </button>
            <span className="correction-toolbar-sep" aria-hidden="true" />
            <button type="button" className="correction-btn danger" onClick={handleResetAll} disabled={!derived.dirty}>
              <RotateCcw size={14} /> Reset all
            </button>
          </div>

          <div className="correction-editor-grid">
            <div className="correction-note-list">
              <div className="correction-note-list-head">
                <strong>
                  Notes <span className="correction-note-count">{noteCount}</span>
                </strong>
                <span className="correction-note-position">
                  {selectedIndex >= 0 ? `Note ${selectedIndex + 1} of ${noteCount}` : "No note selected"}
                </span>
                <div className="correction-note-nav">
                  <button
                    type="button"
                    className="correction-btn"
                    onClick={api.selectPrevious}
                    disabled={selectedIndex <= 0}
                    aria-label="Previous note"
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <button
                    type="button"
                    className="correction-btn"
                    onClick={api.selectNext}
                    disabled={selectedIndex >= noteCount - 1}
                    aria-label="Next note"
                  >
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
              <ul className="correction-note-rows">
                {events.map((event, index) => {
                  const isSelected = event.id === session.selectedNoteId;
                  const isEdited = editedIds.has(event.id);
                  const isAdded = addedIds.has(event.id);
                  return (
                    <li key={event.id}>
                      <button
                        type="button"
                        className={`correction-note-row ${isSelected ? "is-selected" : ""} ${isEdited ? "is-edited" : ""} ${isAdded ? "is-added" : ""}`}
                        aria-pressed={isSelected}
                        onClick={() => api.select(event.id)}
                      >
                        <span className="correction-note-index">{index + 1}</span>
                        <span className="correction-note-name">{event.name}</span>
                        <span className="correction-note-time">{event.start.toFixed(2)}s</span>
                        <span className="correction-note-state">{isAdded ? "added" : isEdited ? "edited" : "original"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="correction-fields">
              {selectedNote ? (
                <SelectedNoteFields
                  key={selectedNote.id}
                  note={selectedNote}
                  api={api}
                  selectedIndex={selectedIndex}
                  noteCount={noteCount}
                  safeStep={safeStep}
                  resetStatus={resetStatus}
                  onMoveEarlier={() => api.moveSelected(-safeStep)}
                  onMoveLater={() => api.moveSelected(safeStep)}
                  onToggleStep={(value) => setStep(value)}
                  onDelete={handleDelete}
                  onReset={handleResetSelected}
                />
              ) : (
                <p className="correction-empty-fields">Select a note to edit its pitch, timing and velocity.</p>
              )}
            </div>
          </div>

          {derived.warnings.length > 0 && (
            <div className="correction-warnings" role="alert">
              <strong>
                <AlertTriangle size={13} /> Overlap warnings
              </strong>
              <ul>
                {derived.warnings.map((warning, index) => (
                  <li key={index}>{warning.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {task === "delete" && (
        <ConfirmDialog
          title="Delete note?"
          message={
            selectedNote
              ? `Remove ${selectedNote.name} (note ${selectedIndex + 1} of ${noteCount}) from the corrected lesson? This change can be undone after deleting.`
              : "Remove the selected note from the corrected lesson?"
          }
          confirmLabel="Delete note"
          onCancel={() => setTask(null)}
          onConfirm={() => {
            api.deleteSelected();
            setTask(null);
          }}
        />
      )}
      {task === "reset-all" && (
        <ConfirmDialog
          title="Reset the whole lesson?"
          message="This restores every corrected note to the original detected analysis. You can undo this afterwards."
          confirmLabel="Reset lesson"
          onCancel={() => setTask(null)}
          onConfirm={() => {
            api.resetAll();
            setTask(null);
          }}
        />
      )}
      {task === "reset-note" && selectedNote && (
        <ConfirmDialog
          title="Reset note?"
          message={`Restore ${selectedNote.name} (note ${selectedIndex + 1} of ${noteCount}) to its original detected value? This change can be undone after resetting.`}
          confirmLabel="Reset note"
          onCancel={() => setTask(null)}
          onConfirm={() => {
            api.resetSelected();
            setTask(null);
          }}
        />
      )}
    </div>
  );
}

function SelectedNoteFields(props: {
  note: CorrectionNote;
  api: CorrectionEditorApi;
  selectedIndex: number;
  noteCount: number;
  safeStep: number;
  resetStatus: ResetSelectedStatus;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onToggleStep: (value: number) => void;
  onDelete: () => void;
  onReset: () => void;
}) {
  const { note, api, selectedIndex, noteCount, safeStep, resetStatus, onMoveEarlier, onMoveLater, onToggleStep, onDelete, onReset } = props;
  return (
    <>
      <div className="correction-selected-heading">
        <strong>
          Editing {note.name} <span className="correction-note-count">note {selectedIndex + 1} of {noteCount}</span>
        </strong>
      </div>
      <div className="correction-field-grid">
        <label className="correction-field">
          Pitch
          <select value={note.midi} onChange={(event) => api.changeMidi(note.id, Number(event.currentTarget.value))} aria-label="Note name">
            {NOTE_OPTIONS.map((option) => (
              <option key={option.midi} value={option.midi}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          id="correction-midi"
          label="MIDI value"
          value={note.midi}
          step={1}
          min={MIDI_FIELD.min}
          max={MIDI_FIELD.max}
          integer={MIDI_FIELD.integer}
          commit={(midi) => api.changeMidi(note.id, midi)}
        />
        <NumberField
          id="correction-start"
          label="Start (seconds)"
          value={note.start}
          step={0.01}
          min={START_FIELD.min}
          max={START_FIELD.max}
          integer={START_FIELD.integer}
          commit={(start) => api.changeStart(note.id, start)}
        />
        <NumberField
          id="correction-duration"
          label="Duration (seconds)"
          value={note.duration}
          step={0.01}
          min={DURATION_FIELD.min}
          max={DURATION_FIELD.max}
          integer={DURATION_FIELD.integer}
          commit={(duration) => api.changeDuration(note.id, duration)}
        />
        <NumberField
          id="correction-velocity"
          label="Velocity"
          value={note.velocity}
          step={1}
          min={VELOCITY_FIELD.min}
          max={VELOCITY_FIELD.max}
          integer={VELOCITY_FIELD.integer}
          commit={(velocity) => api.changeVelocity(note.id, velocity)}
        />
      </div>
      <div className="correction-move-row">
        <button type="button" className="correction-btn" onClick={onMoveEarlier}>
          <ArrowLeft size={14} /> Move earlier
        </button>
        <button type="button" className="correction-btn" onClick={onMoveLater}>
          Move later <ArrowRight size={14} />
        </button>
        <label className="correction-field correction-step-field">
          Step (s)
          <input
            type="number"
            value={safeStep}
            min={0.001}
            step={0.05}
            inputMode="decimal"
            aria-label="Move step in seconds"
            onChange={(event) => onToggleStep(Number(event.currentTarget.value))}
          />
        </label>
      </div>
      <div className="correction-reset-row">
        <button type="button" className="correction-btn correction-reset-note-btn" onClick={onReset} disabled={!resetStatus.enabled} aria-disabled={!resetStatus.enabled}>
          <RotateCcw size={14} /> Reset selected note
        </button>
      </div>
      {!resetStatus.enabled && resetStatus.reason === "added" && (
        <p className="correction-reset-hint">This note was added, so it has no original detection to reset to. Use &ldquo;Delete note&rdquo; to remove it instead.</p>
      )}
      {!resetStatus.enabled && resetStatus.reason === "not-edited" && (
        <p className="correction-reset-hint">This note already matches its original detection, so there is nothing to reset.</p>
      )}
      <button type="button" className="correction-btn danger correction-delete-btn" onClick={onDelete}>
        <Trash2 size={14} /> Delete note
      </button>
    </>
  );
}
