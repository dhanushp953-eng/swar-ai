"use client";

import { Pause, Pencil, Play, Repeat2, RotateCcw, TimerReset } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { demoExercises } from "@/data/demo-exercises";
import { Piano } from "@/components/piano";
import { type OutputMode, useLessonEngine } from "@/hooks/useLessonEngine";
import type { DetectedLesson } from "@/features/lesson/detected-lesson";
import type { HandMode, LessonExercise } from "@/types/lesson";
  import { filterEventsByHand, getActiveMidi, getCurrentMusicalDisplay } from "@/utils/lesson-notes";
import { PLAYBACK_SPEEDS } from "@/utils/lesson-timing";
import { PianoRoll } from "@/features/lesson/PianoRoll";
import { getLessonSelectOptions, resolveLessonSelection } from "@/features/lesson/lesson-selection";
import { CorrectionEditorPanel } from "@/features/correction/CorrectionEditorPanel";
import { type CorrectionSource, useCorrectionEditor } from "@/features/correction/useCorrectionEditor";
import { getMidiController } from "@/lib/midi/web-midi";
import { ExportLessonControls } from "@/features/lesson/ExportLessonControls";
import { useLessonExport } from "@/features/lesson/useLessonExport";
import { PracticePanel } from "@/features/practice/PracticePanel";

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

type LessonSourceMode = "detected" | "imported" | "demo";

export function LessonWorkspace({ detectedLesson, detectedObjectUrl, detectedAudioRef, importedLesson, importedLessonKey }: { detectedLesson?: DetectedLesson | null; detectedObjectUrl?: string | null; detectedAudioRef?: RefObject<HTMLAudioElement | null>; importedLesson?: LessonExercise | null; importedLessonKey?: string | null }) {
  const [lessonId, setLessonId] = useState(() => detectedLesson ? "detected" : importedLesson ? "imported" : demoExercises[0].id);
  const [editMode, setEditMode] = useState(false);
  const previousImportKey = useRef<string | null | undefined>(importedLessonKey);
  useEffect(() => {
    if (importedLesson && importedLessonKey !== previousImportKey.current) {
      previousImportKey.current = importedLessonKey;
      setLessonId("imported");
      setEditMode(false);
    }
  }, [importedLesson, importedLessonKey]);
  const selection = resolveLessonSelection(lessonId, detectedLesson, demoExercises, importedLesson);
  const correctionSource: CorrectionSource | null = selection.origin === "detected" && detectedLesson
    ? { origin: "detected", sourceKey: detectedLesson.exercise.id, exercise: detectedLesson.exercise }
    : selection.origin === "imported" && importedLesson
      ? { origin: "imported", sourceKey: importedLessonKey ?? importedLesson.id, exercise: importedLesson }
      : null;
  const correction = useCorrectionEditor(correctionSource);
  const canEdit = selection.origin === "detected" || selection.origin === "imported";
  const exercise = correction.exercise ?? selection.exercise;
  const sourceMode = selection.origin as LessonSourceMode;
  const canExportOriginal = sourceMode === "detected" && Boolean(detectedLesson);
  const lessonExport = useLessonExport({ original: () => detectedLesson?.exercise ?? null, current: () => exercise });
  const handleExerciseChange = (id: string) => {
    setLessonId(id);
    setEditMode(false);
  };
  return <>
    {canEdit && editMode && correction.session && correction.derived && <CorrectionEditorPanel api={correction.api} session={correction.session} derived={correction.derived} onClose={() => setEditMode(false)} lessonLabel={sourceMode === "imported" ? "Imported lesson" : "Detected lesson"} sourceAdjective={sourceMode === "imported" ? "imported" : "detected"} />}
    <LessonSession key={`${selection.origin}-${selection.exercise.id}`} exercise={exercise} onExerciseChange={handleExerciseChange} sourceMode={sourceMode} detectedLesson={detectedLesson} detectedObjectUrl={detectedObjectUrl} detectedAudioRef={detectedAudioRef} importedLesson={importedLesson} canEdit={canEdit} correctionDirty={correction.derived?.dirty ?? false} correctionCount={correction.derived?.correctionCount ?? 0} editing={editMode} onEdit={() => setEditMode(true)} exportState={lessonExport.state} canExportOriginal={canExportOriginal} onExportOriginal={lessonExport.exportOriginal} onExportCurrent={lessonExport.exportCurrent} />;
  </>;
}

function LessonSession({ exercise, onExerciseChange, sourceMode, detectedLesson, detectedObjectUrl, detectedAudioRef, importedLesson, canEdit, correctionDirty, correctionCount, editing, onEdit, exportState, canExportOriginal, onExportOriginal, onExportCurrent }: { exercise: LessonExercise; onExerciseChange: (id: string) => void; sourceMode: LessonSourceMode; detectedLesson: DetectedLesson | null | undefined; detectedObjectUrl?: string | null; detectedAudioRef?: RefObject<HTMLAudioElement | null>; importedLesson?: LessonExercise | null; canEdit: boolean; correctionDirty: boolean; correctionCount: number; editing: boolean; onEdit: () => void; exportState: ReturnType<typeof useLessonExport>["state"]; canExportOriginal: boolean; onExportOriginal: () => void; onExportCurrent: () => void }) {
  const [showNoteNames, setShowNoteNames] = useState(true);
  const [showFingerNumbers, setShowFingerNumbers] = useState(true);
  const localAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioRef = detectedAudioRef ?? localAudioRef;
  const isDetected = sourceMode === "detected";
  const engine = useLessonEngine(exercise, { audioFile: isDetected ? detectedLesson?.audioFile : null, audioRef, objectUrl: isDetected ? detectedObjectUrl ?? null : null });
  const midiReleaseAll = useMemo(() => () => getMidiController().releaseAll(), []);
  useEffect(() => {
    midiReleaseAll();
  }, [exercise.id, midiReleaseAll]);
  const activeMidi = useMemo(() => engine.status === "playing" || engine.status === "paused" ? getActiveMidi(exercise.events, engine.currentTime, engine.handMode) : new Set<number>(), [engine.currentTime, engine.handMode, engine.status, exercise.events]);
  const display = useMemo(() => getCurrentMusicalDisplay(exercise.events, engine.currentTime, engine.handMode), [engine.currentTime, engine.handMode, exercise.events]);
  const isPlaying = engine.status === "playing" || engine.status === "count-in";
  const statusLabel = engine.status === "count-in" ? "Count-in" : engine.status === "complete" ? "Complete" : engine.status === "paused" ? "Paused" : engine.status === "waiting" ? "Waiting" : engine.status === "playing" ? "Playing" : "Ready";
  const bpmLabel = isDetected ? detectedLesson?.estimatedBpm === null ? "Unknown" : Math.round(detectedLesson?.estimatedBpm ?? 0) : exercise.bpm === 0 ? "Unknown" : Math.round(exercise.bpm);
  const selectValue = sourceMode === "detected" ? "detected" : sourceMode === "imported" ? "imported" : exercise.id;
  const editLabel = sourceMode === "imported" ? "Edit imported lesson" : "Edit detected lesson";
  const practiceAllEvents = useMemo(() => exercise.events.map((event) => ({ id: event.id, midi: event.midi, name: event.name, start: event.start, duration: event.duration, hand: event.hand, velocity: event.velocity })), [exercise.events]);
  const practiceEvents = useMemo(() => filterEventsByHand(exercise.events, engine.handMode).map((event) => ({ id: event.id, midi: event.midi, name: event.name, start: event.start, duration: event.duration, hand: event.hand, velocity: event.velocity })), [engine.handMode, exercise.events]);
  const getLessonTime = useCallback(() => engine.currentTime, [engine.currentTime]);

  return <div className="lesson-workspace lesson-engine">
    <div className="workspace-top"><div><span className="status-dot" />Lesson workspace <span className="muted">/ {statusLabel.toLowerCase()}</span></div><div className="workspace-actions"><button type="button" onClick={engine.restart} aria-label="Restart lesson"><RotateCcw size={16} /></button><button type="button" onClick={isPlaying ? engine.pause : engine.play} aria-label={isPlaying ? "Pause lesson" : "Play lesson"}>{isPlaying ? <Pause size={16} /> : <Play size={16} />}</button></div></div>
    <div className="lesson-topline"><label className="lesson-select">Lesson<select aria-label="Lesson selection" value={selectValue} onChange={(event) => onExerciseChange(event.target.value)}>{getLessonSelectOptions(detectedLesson, demoExercises, importedLesson).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><div className="lesson-topline-copy"><p>{isDetected ? <strong className="detected-lesson-label">Detected from your audio.</strong> : exercise.description}</p>{canEdit && <button type="button" className={`correction-open-btn ${editing ? "is-active" : ""}`} onClick={onEdit}><Pencil size={13} /> {editLabel}{correctionDirty ? ` · ${correctionCount} change${correctionCount === 1 ? "" : "s"}` : ""}</button>}</div><div className="lesson-meta"><span>{bpmLabel === "Unknown" ? "BPM unknown" : `${bpmLabel} BPM`}</span><span>{isDetected || sourceMode === "imported" ? `${exercise.events.length} notes` : `${exercise.beatsPerMeasure}/4`}</span></div></div>
    {(sourceMode === "detected" || sourceMode === "imported") && <ExportLessonControls state={exportState} canExportOriginal={canExportOriginal} correctionCount={correctionCount} onExportOriginal={onExportOriginal} onExportCurrent={onExportCurrent} />}
    <div className="lesson-reading"><div><span>{display.label}</span><strong>{display.value}</strong></div><div className="hand-legend">{isDetected ? <span className="legend-detected">Detected melody</span> : <><span className="legend-left">Left hand</span><span className="legend-right">Right hand</span></>}</div></div>
    <Piano lessonActiveMidi={activeMidi} lessonRoll={<PianoRoll events={exercise.events} currentTime={engine.currentTime} handMode={engine.handMode} showNoteNames={showNoteNames} showFingerNumbers={showFingerNumbers} countInBeat={engine.countInBeat} isPlaying={engine.status === "playing"} />} />
    {isDetected && <div className="detected-audio-controls"><audio ref={audioRef} preload="metadata" aria-label="Original uploaded audio" /><div className="detected-audio-heading"><span><span className="eyebrow">Master clock</span><strong>Original audio</strong></span><span>{detectedLesson?.melodyConfidence === null ? "Confidence unknown" : `${Math.round((detectedLesson?.melodyConfidence ?? 0) * 100)}% melody confidence`}</span></div><div className="detected-audio-options"><label>Output mode<select value={engine.outputMode} onChange={(event) => engine.setOutputMode(event.target.value as OutputMode)}><option value="both">Both</option><option value="original">Original audio</option><option value="piano">Generated piano</option></select></label><label>Original volume<input aria-label="Original audio volume" type="range" min="0" max="1" step="0.01" value={engine.originalVolume} onChange={(event) => engine.setOriginalVolume(Number(event.target.value))} /></label><label>Generated piano volume<input aria-label="Generated piano volume" type="range" min="-30" max="0" value={engine.generatedVolume} onChange={(event) => engine.setGeneratedVolume(Number(event.target.value))} /></label><label>Sync offset <output>{engine.syncOffsetMs} ms</output><input aria-label="Synchronization offset" type="range" min="-500" max="500" step="10" value={engine.syncOffsetMs} onChange={(event) => engine.setSyncOffsetMs(Number(event.target.value))} /></label><button type="button" className="audio-sync-reset" onClick={() => engine.setSyncOffsetMs(0)}>Reset offset</button></div>{!engine.preservesPitchSupported && <p className="audio-limitation">Pitch preservation is not supported by this browser; changing speed may change the original audio pitch.</p>}{engine.audioError && <p className="audio-form-error" role="alert">{engine.audioError}</p>}</div>}
    <div className="lesson-progress-row"><output>{formatTime(engine.currentTime)}</output><input aria-label="Lesson progress" className="lesson-progress" type="range" min="0" max={exercise.duration} step="0.01" value={engine.currentTime} onChange={(event) => engine.seek(Number(event.target.value))} /><output>{formatTime(exercise.duration)}</output></div>
    <div className="lesson-option-grid">
      <div className="lesson-option-group"><span className="lesson-option-label">Playback speed</span><div className="speed-options">{PLAYBACK_SPEEDS.map((option) => <button key={option} type="button" className={engine.speed === option ? "selected" : ""} onClick={() => engine.setSpeed(option)}>{option * 100}%</button>)}</div></div>
      <div className="lesson-option-group"><span className="lesson-option-label">Hands</span><div className="speed-options">{(["left", "right", "both"] as HandMode[]).map((mode) => <button key={mode} type="button" className={engine.handMode === mode ? "selected" : ""} onClick={() => engine.setHandMode(mode)}>{mode === "both" ? "Both" : mode[0].toUpperCase() + mode.slice(1)}</button>)}</div></div>
      <div className="lesson-option-group lesson-toggles"><label><input type="checkbox" checked={engine.metronome} onChange={(event) => engine.setMetronome(event.target.checked)} /> Metronome</label><label><input type="checkbox" checked={showNoteNames} onChange={(event) => setShowNoteNames(event.target.checked)} /> Note names</label><label><input type="checkbox" checked={showFingerNumbers} onChange={(event) => setShowFingerNumbers(event.target.checked)} /> Finger numbers</label></div>
    </div>
    <div className="loop-panel"><div className="loop-heading"><span><Repeat2 size={15} /> Loop range</span><label><input type="checkbox" checked={engine.loopEnabled} onChange={(event) => engine.setLoopEnabled(event.target.checked)} /> Repeat range</label></div><div className="loop-sliders"><label>A <input aria-label="Loop start" type="range" min="0" max={exercise.duration - 0.1} step="0.1" value={engine.loopStart} onChange={(event) => engine.setLoopRange(Number(event.target.value), engine.loopEnd)} /><output>{formatTime(engine.loopStart)}</output></label><label>B <input aria-label="Loop end" type="range" min="0.1" max={exercise.duration} step="0.1" value={engine.loopEnd} onChange={(event) => engine.setLoopRange(engine.loopStart, Number(event.target.value))} /><output>{formatTime(engine.loopEnd)}</output></label></div><div className="loop-actions"><button type="button" onClick={() => engine.setLoopRange(engine.currentTime, engine.loopEnd)}><TimerReset size={13} /> Set A here</button><button type="button" onClick={() => engine.setLoopRange(engine.loopStart, Math.max(engine.currentTime, engine.loopStart + 0.1))}><TimerReset size={13} /> Set B here</button></div></div>
    <PracticePanel events={practiceEvents} allEvents={practiceAllEvents} handMode={engine.handMode} engine={engine} controller={getMidiController()} getLessonTime={getLessonTime} status={engine.status} duration={exercise.duration} onRestart={engine.restart} />
  </div>;
}
