"use client";

import { Gauge, RotateCcw } from "lucide-react";
import { useState } from "react";
import { usePracticeSession } from "@/hooks/usePracticeSession";
import {
  PRACTICE_PRESET_META,
  PRACTICE_PRESET_ORDER,
  type PerformedClassification,
  type PracticePresetId,
  type ScoreNoteEvent,
  type ScoreResult,
} from "@/lib/practice/scoring";
import type { WebMidiController } from "@/lib/midi/web-midi";
import type { LessonStatus } from "@/types/lesson";

const CLASSIFICATION_META: Record<PerformedClassification, { label: string; tone: string }> = {
  correct: { label: "Correct", tone: "correct" },
  early: { label: "Early", tone: "early" },
  late: { label: "Late", tone: "late" },
  wrong: { label: "Wrong pitch", tone: "wrong" },
  extra: { label: "Extra", tone: "extra" },
};

type PracticePanelProps = {
  events: ScoreNoteEvent[];
  controller?: WebMidiController;
  getLessonTime: () => number;
  status: LessonStatus;
  duration: number;
  onRestart: () => void;
  /** Start with scoring enabled (used by the mocked-MIDI verification page). */
  defaultEnabled?: boolean;
};

function ScoreLine({ label, score }: { label: string; score: number }) {
  return (
    <div className="practice-score-line">
      <span>{label}</span>
      <output>{Math.round(score)}</output>
    </div>
  );
}

export function Summary({ result, onRestart }: { result: ScoreResult; onRestart: () => void }) {
  const { counts, scores } = result;
  return (
    <div className="practice-summary">
      <div className="practice-summary-main">
        <span className="eyebrow">Final attempt</span>
        <strong className="practice-overall">{Math.round(scores.overall.value)}</strong>
        <span className="practice-overall-label">overall / 100</span>
        <button type="button" className="practice-restart" onClick={onRestart}><RotateCcw size={13} /> Practise again</button>
      </div>
      <div className="practice-summary-scores">
        <ScoreLine label="Correct notes" score={scores.correctNotes.value} />
        <ScoreLine label="Pitch" score={scores.pitch.value} />
        <ScoreLine label="Timing" score={scores.timing.value} />
        <ScoreLine label="Duration" score={scores.duration.value} />
      </div>
      <div className="practice-summary-counts">
        <span>Correct <strong>{counts.correct}</strong></span>
        <span>Early <strong>{counts.early}</strong></span>
        <span>Late <strong>{counts.late}</strong></span>
        <span>Wrong <strong>{counts.wrong}</strong></span>
        <span>Extra <strong>{counts.extra}</strong></span>
        <span>Missed <strong>{counts.missed}</strong></span>
      </div>
      <ul className="practice-reasons">
        {scores.overall.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        {scores.pitch.reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
    </div>
  );
}

export function PracticePanel({ events, controller, getLessonTime, status, duration, onRestart, defaultEnabled = false }: PracticePanelProps) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [preset, setPreset] = useState<PracticePresetId>("standard");
  const [latencyMs, setLatencyMs] = useState(0);
  const { result } = usePracticeSession({
    events,
    controller,
    getLessonTime,
    status,
    duration,
    preset,
    enabled,
    latencyMs,
  });

  const lastNote = result?.performedNotes[result.performedNotes.length - 1] ?? null;
  const isComplete = status === "complete";
  const showSummary = isComplete && result !== null && result.counts.performed > 0;

  return (
    <section className="practice-panel" aria-labelledby="practice-title">
      <div className="practice-heading">
        <div>
          <p className="eyebrow">Practice / 05B</p>
          <h2 id="practice-title">Practice scoring</h2>
        </div>
        <p className="practice-note"><Gauge size={13} /> Deterministic matching of your MIDI performance against the lesson, computed locally.</p>
      </div>

      <div className="practice-options">
        <label className="practice-toggle">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Score my playing
        </label>
        <label className="practice-preset">
          Strictness
          <select value={preset} onChange={(event) => setPreset(event.target.value as PracticePresetId)} aria-label="Scoring strictness">
            {PRACTICE_PRESET_ORDER.map((id) => (
              <option key={id} value={id}>{PRACTICE_PRESET_META[id].label} — {PRACTICE_PRESET_META[id].description}</option>
            ))}
          </select>
        </label>
        <label className="practice-latency">
          Latency compensation <output>{latencyMs} ms</output>
          <input aria-label="Latency compensation" type="range" min="0" max="200" step="10" value={latencyMs} onChange={(event) => setLatencyMs(Number(event.target.value))} />
        </label>
      </div>

      {!enabled && <p className="practice-hint">Turn on scoring, then play along with the lesson on your MIDI keyboard to see live feedback here.</p>}

      {enabled && !showSummary && (
        <div className="practice-live" aria-live="polite">
          <div className="practice-live-heading">
            <span className="eyebrow">Live feedback</span>
            <span className="practice-status-label">{status === "playing" ? "Listening" : status === "count-in" ? "Count-in" : status === "paused" ? "Paused" : "Ready"}</span>
          </div>
          <div className="practice-last-note">
            {lastNote ? (
              <>
                <strong>{lastNote.noteName}</strong>
                <span className={`practice-badge practice-badge-${lastNote.classification}`}>{CLASSIFICATION_META[lastNote.classification].label}</span>
                <em>{lastNote.reason}</em>
              </>
            ) : (
              <span className="practice-last-empty">Play a note to begin.</span>
            )}
          </div>
          <div className="practice-live-scores">
            <ScoreLine label="Live score" score={result?.scores.overall.value ?? 0} />
            <ScoreLine label="Pitch" score={result?.scores.pitch.value ?? 0} />
            <ScoreLine label="Timing" score={result?.scores.timing.value ?? 0} />
            <ScoreLine label="Duration" score={result?.scores.duration.value ?? 0} />
          </div>
          <div className="practice-summary-counts">
            <span>Correct <strong>{result?.counts.correct ?? 0}</strong></span>
            <span>Early <strong>{result?.counts.early ?? 0}</strong></span>
            <span>Late <strong>{result?.counts.late ?? 0}</strong></span>
            <span>Wrong <strong>{result?.counts.wrong ?? 0}</strong></span>
            <span>Extra <strong>{result?.counts.extra ?? 0}</strong></span>
            <span>Missed <strong>{result?.counts.missed ?? 0}</strong></span>
          </div>
        </div>
      )}

      {showSummary && result && <Summary result={result} onRestart={onRestart} />}
      {isComplete && enabled && (!result || result.counts.performed === 0) && <p className="practice-hint">No notes were scored during this attempt. Enable scoring and play along next time.</p>}
    </section>
  );
}
