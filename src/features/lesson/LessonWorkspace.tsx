"use client";

import { Pause, Play, Repeat2, RotateCcw, TimerReset } from "lucide-react";
import { useMemo, useState } from "react";
import { demoExercises } from "@/data/demo-exercises";
import { Piano } from "@/components/piano";
import { useLessonEngine } from "@/hooks/useLessonEngine";
import type { HandMode, LessonExercise } from "@/types/lesson";
import { getActiveMidi, getCurrentMusicalDisplay } from "@/utils/lesson-notes";
import { PLAYBACK_SPEEDS } from "@/utils/lesson-timing";
import { PianoRoll } from "@/features/lesson/PianoRoll";

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function LessonWorkspace() {
  const [exerciseId, setExerciseId] = useState(demoExercises[0].id);
  const exercise = demoExercises.find((item) => item.id === exerciseId) ?? demoExercises[0];
  return <LessonSession key={exercise.id} exercise={exercise} onExerciseChange={setExerciseId} />;
}

function LessonSession({ exercise, onExerciseChange }: { exercise: LessonExercise; onExerciseChange: (id: string) => void }) {
  const [showNoteNames, setShowNoteNames] = useState(true);
  const [showFingerNumbers, setShowFingerNumbers] = useState(true);
  const engine = useLessonEngine(exercise);
  const activeMidi = useMemo(() => engine.status === "playing" ? getActiveMidi(exercise.events, engine.currentTime, engine.handMode) : new Set<number>(), [engine.currentTime, engine.handMode, engine.status, exercise.events]);
  const display = useMemo(() => getCurrentMusicalDisplay(exercise.events, engine.currentTime, engine.handMode), [engine.currentTime, engine.handMode, exercise.events]);
  const isPlaying = engine.status === "playing" || engine.status === "count-in";
  const statusLabel = engine.status === "count-in" ? "Count-in" : engine.status === "complete" ? "Complete" : engine.status === "paused" ? "Paused" : engine.status === "playing" ? "Playing" : "Ready";

  return <div className="lesson-workspace lesson-engine">
    <div className="workspace-top"><div><span className="status-dot" />Lesson workspace <span className="muted">/ {statusLabel.toLowerCase()}</span></div><div className="workspace-actions"><button type="button" onClick={engine.restart} aria-label="Restart lesson"><RotateCcw size={16} /></button><button type="button" onClick={isPlaying ? engine.pause : engine.play} aria-label={isPlaying ? "Pause lesson" : "Play lesson"}>{isPlaying ? <Pause size={16} /> : <Play size={16} />}</button></div></div>
    <div className="lesson-topline"><label className="lesson-select">Exercise<select aria-label="Demo exercise" value={exercise.id} onChange={(event) => onExerciseChange(event.target.value)}>{demoExercises.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><p>{exercise.description}</p><div className="lesson-meta"><span>{exercise.bpm} BPM</span><span>{exercise.beatsPerMeasure}/4</span></div></div>
    <div className="lesson-reading"><div><span>{display.label}</span><strong>{display.value}</strong></div><div className="hand-legend"><span className="legend-left">Left hand</span><span className="legend-right">Right hand</span></div></div>
    <Piano lessonActiveMidi={activeMidi} lessonRoll={<PianoRoll events={exercise.events} currentTime={engine.currentTime} handMode={engine.handMode} showNoteNames={showNoteNames} showFingerNumbers={showFingerNumbers} countInBeat={engine.countInBeat} isPlaying={engine.status === "playing"} />} />
    <div className="lesson-progress-row"><output>{formatTime(engine.currentTime)}</output><input aria-label="Lesson progress" className="lesson-progress" type="range" min="0" max={exercise.duration} step="0.01" value={engine.currentTime} onChange={(event) => engine.seek(Number(event.target.value))} /><output>{formatTime(exercise.duration)}</output></div>
    <div className="lesson-option-grid">
      <div className="lesson-option-group"><span className="lesson-option-label">Playback speed</span><div className="speed-options">{PLAYBACK_SPEEDS.map((option) => <button key={option} type="button" className={engine.speed === option ? "selected" : ""} onClick={() => engine.setSpeed(option)}>{option * 100}%</button>)}</div></div>
      <div className="lesson-option-group"><span className="lesson-option-label">Hands</span><div className="speed-options">{(["left", "right", "both"] as HandMode[]).map((mode) => <button key={mode} type="button" className={engine.handMode === mode ? "selected" : ""} onClick={() => engine.setHandMode(mode)}>{mode === "both" ? "Both" : mode[0].toUpperCase() + mode.slice(1)}</button>)}</div></div>
      <div className="lesson-option-group lesson-toggles"><label><input type="checkbox" checked={engine.metronome} onChange={(event) => engine.setMetronome(event.target.checked)} /> Metronome</label><label><input type="checkbox" checked={showNoteNames} onChange={(event) => setShowNoteNames(event.target.checked)} /> Note names</label><label><input type="checkbox" checked={showFingerNumbers} onChange={(event) => setShowFingerNumbers(event.target.checked)} /> Finger numbers</label></div>
    </div>
    <div className="loop-panel"><div className="loop-heading"><span><Repeat2 size={15} /> Loop range</span><label><input type="checkbox" checked={engine.loopEnabled} onChange={(event) => engine.setLoopEnabled(event.target.checked)} /> Repeat range</label></div><div className="loop-sliders"><label>A <input aria-label="Loop start" type="range" min="0" max={exercise.duration - 0.1} step="0.1" value={engine.loopStart} onChange={(event) => engine.setLoopRange(Number(event.target.value), engine.loopEnd)} /><output>{formatTime(engine.loopStart)}</output></label><label>B <input aria-label="Loop end" type="range" min="0.1" max={exercise.duration} step="0.1" value={engine.loopEnd} onChange={(event) => engine.setLoopRange(engine.loopStart, Number(event.target.value))} /><output>{formatTime(engine.loopEnd)}</output></label></div><div className="loop-actions"><button type="button" onClick={() => engine.setLoopRange(engine.currentTime, engine.loopEnd)}><TimerReset size={13} /> Set A here</button><button type="button" onClick={() => engine.setLoopRange(engine.loopStart, Math.max(engine.currentTime, engine.loopStart + 0.1))}><TimerReset size={13} /> Set B here</button></div></div>
  </div>;
}
