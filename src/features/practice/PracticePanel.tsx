"use client";

import { Gauge, Mic, Piano, RotateCcw, SkipForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMicInput } from "@/hooks/useMicInput";
import { usePracticeSession, isFreshStart, type PracticeNoteSource } from "@/hooks/usePracticeSession";
import {
  PRACTICE_PRESETS,
  PRACTICE_PRESET_META,
  PRACTICE_PRESET_ORDER,
  type PerformedClassification,
  type PracticeConfig,
  type PracticePresetId,
  type ScoreNoteEvent,
  type ScoreResult,
} from "@/lib/practice/scoring";
import { getPracticeEvents, PRACTICE_FOCUS_META, PRACTICE_FOCUS_ORDER, type PracticeFocus } from "@/lib/practice/modes";
import { getRetryPoint, getWaitTargets } from "@/lib/practice/guided";
import { getMicInput, type MicInputController } from "@/lib/mic/mic-input";
import type { MicConnectionState } from "@/lib/mic/mic-types";
import type { WebMidiController } from "@/lib/midi/web-midi";
import { sanitizeExportFilename, triggerFileDownload } from "@/features/lesson/lesson-export";
import type { HandMode, LessonStatus } from "@/types/lesson";
import { PracticeResults } from "@/features/practice/PracticeResults";
import { usePracticeResults } from "@/features/practice/usePracticeResults";
import { serializeResultsExport, type PracticeInput } from "@/features/practice/results-store";
import { createTutorPracticeSnapshot, createTutorPracticeSnapshotFromStoredResult, type TutorPracticeSnapshot } from "@/lib/tutor-api";

export type { PracticeInput } from "@/features/practice/results-store";

const CLASSIFICATION_META: Record<PerformedClassification, { label: string; tone: string }> = {
  correct: { label: "Correct", tone: "correct" },
  early: { label: "Early", tone: "early" },
  late: { label: "Late", tone: "late" },
  wrong: { label: "Wrong pitch", tone: "wrong" },
  extra: { label: "Extra", tone: "extra" },
};

/** The subset of the lesson engine the practice panel drives. */
export type LessonEngineHandle = {
  status: LessonStatus;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  loopIteration: number;
  play: () => void;
  seek: (time: number) => void;
  resume: () => void;
  setWaitMode: (enabled: boolean) => void;
  setWaitTargets: (targets: number[]) => void;
};

type PracticePanelProps = {
  /** Expected events, already filtered by hand mode (full + rhythm focus). */
  events: ScoreNoteEvent[];
  /** Unfiltered events, used to derive the melody line for melody focus. */
  allEvents?: ScoreNoteEvent[];
  /** Active hand mode; drives melody classification. */
  handMode?: HandMode;
  /** The lesson engine, enabling wait mode, loop iteration, and retry. */
  engine?: LessonEngineHandle;
  controller?: WebMidiController;
  micController?: MicInputController;
  getLessonTime: () => number;
  status: LessonStatus;
  duration: number;
  onRestart: () => void;
  /** Start with scoring enabled (used by the mocked-MIDI verification page). */
  defaultEnabled?: boolean;
  /** Which input to select on first render. Defaults to MIDI. */
  defaultInput?: PracticeInput;
  /** Lesson context recorded with each saved attempt. */
  lessonId?: string;
  lessonTitle?: string;
  /** Called with a stored result's lessonId when the user picks "Practise again". */
  onSelectLesson?: (lessonId: string) => void;
  /** Exposes only the current sanitized score summary to the lesson-scoped tutor. */
  onPracticeSnapshot?: (snapshot: TutorPracticeSnapshot | null) => void;
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

function micStatusLabel(mic: MicConnectionState): string {
  switch (mic.status) {
    case "listening":
      return mic.muted ? "Listening — no clear note right now." : "Listening for notes.";
    case "requesting":
      return "Requesting microphone permission…";
    case "permission-denied":
      return "Permission denied. Allow the microphone in your browser settings, then enable it again.";
    case "unsupported":
      return "Microphone input is not supported in this browser. Try Chrome, Edge, or Firefox.";
    case "device-disconnected":
      return "Microphone disconnected. Check the connection, then enable it again.";
    case "error":
      return mic.error ?? "Something went wrong with the microphone.";
    default:
      return "Click “Enable microphone” to begin. Audio is processed locally and never recorded or sent anywhere.";
  }
}

export function PracticePanel({ events, allEvents, handMode = "both", engine, controller, micController, getLessonTime, status, duration, onRestart, defaultEnabled = false, defaultInput = "midi", lessonId, lessonTitle, onSelectLesson, onPracticeSnapshot }: PracticePanelProps) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [preset, setPreset] = useState<PracticePresetId>("standard");
  const [latencyMs, setLatencyMs] = useState(0);
  const [input, setInput] = useState<PracticeInput>(defaultInput);
  const [focus, setFocus] = useState<PracticeFocus>("full");
  const [waitMode, setWaitMode] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const practiceResults = usePracticeResults();
  const { saveResult } = practiceResults;

  const mic = micController ?? getMicInput();
  const micState = useMicInput(mic);

  // Stop the microphone whenever it is not the selected input (privacy).
  useEffect(() => {
    if (input === "midi") mic.stop();
    return () => {
      if (input === "microphone") mic.stop();
    };
  }, [input, mic]);

  const noteSource: PracticeNoteSource | undefined = input === "microphone" ? mic : controller;

  // The note set scored for the active hand + focus combination.
  const sessionEvents = useMemo(
    () => getPracticeEvents(allEvents ?? events, handMode, focus),
    [allEvents, events, focus, handMode],
  );

  // Rhythm-only practice ignores pitch entirely and weights timing + duration.
  const configOverrides = useMemo<Partial<PracticeConfig> | undefined>(() => {
    if (focus !== "rhythm") return undefined;
    return { ignorePitch: true, weights: { ...PRACTICE_PRESETS[preset].weights, pitch: 0 } };
  }, [focus, preset]);

  const { result } = usePracticeSession({
    events: sessionEvents,
    controller: noteSource,
    getLessonTime,
    status,
    duration,
    preset,
    enabled,
    configOverrides,
    latencyMs,
  });

  useEffect(() => {
    const currentSnapshot = status === "complete" && result ? createTutorPracticeSnapshot(result, focus) : null;
    const latestStored = practiceResults.results.find((stored) => stored.lessonId === (lessonId ?? "unknown")) ?? null;
    onPracticeSnapshot?.(currentSnapshot ?? (latestStored ? createTutorPracticeSnapshotFromStoredResult(latestStored) : null));
  }, [focus, lessonId, onPracticeSnapshot, practiceResults.results, result, status]);

  // Keep the engine's wait targets in sync with the practised notes.
  const loopEnabled = engine?.loopEnabled ?? false;
  const loopStart = engine?.loopStart ?? 0;
  const loopEnd = engine?.loopEnd ?? duration;
  useEffect(() => {
    if (!engine || !waitMode) return;
    engine.setWaitTargets(getWaitTargets({ events: sessionEvents, loopEnabled, loopStart, loopEnd }));
  }, [engine, sessionEvents, waitMode, loopEnabled, loopStart, loopEnd]);

  // Reflect wait mode on the engine (and switch it off on unmount).
  useEffect(() => {
    engine?.setWaitMode(waitMode);
    return () => {
      engine?.setWaitMode(false);
    };
  }, [engine, waitMode]);

  // In wait mode, playing any note moves the lesson on to the next target.
  useEffect(() => {
    if (!engine || !waitMode || !noteSource) return;
    return noteSource.subscribeEvents((event) => {
      if (event.type === "noteon" && status === "waiting") engine.resume();
    });
  }, [engine, noteSource, status, waitMode]);

  const lastNote = result?.performedNotes[result.performedNotes.length - 1] ?? null;
  const lastPlayedOnset = lastNote?.onset ?? null;
  const isComplete = status === "complete";
  const showSummary = isComplete && result !== null && result.counts.performed > 0;

  // Record a completed attempt exactly once per run, as a sanitized summary.
  const savedThisRun = useRef(false);
  const previousStatus = useRef(status);
  useEffect(() => {
    if (isFreshStart(previousStatus.current, status)) savedThisRun.current = false;
    previousStatus.current = status;
  }, [status]);

  useEffect(() => {
    if (!isComplete || !enabled || !result || savedThisRun.current) return;
    savedThisRun.current = true;
    saveResult({
      lessonId: lessonId ?? "unknown",
      lessonTitle: lessonTitle ?? "Unknown lesson",
      input,
      focus,
      preset,
      handMode,
      result,
    });
  }, [enabled, focus, handMode, input, isComplete, lessonId, lessonTitle, preset, result, saveResult]);

  const handleExportResults = () => {
    if (practiceResults.results.length === 0) {
      setExportStatus("There are no saved attempts to export.");
      return;
    }
    try {
      const content = serializeResultsExport(practiceResults.results);
      const fileName = sanitizeExportFilename("Practice results");
      triggerFileDownload(fileName, content, "application/json");
      setExportStatus(`Exported ${practiceResults.results.length} attempt${practiceResults.results.length === 1 ? "" : "s"} as ${fileName}.`);
    } catch {
      setExportStatus("The practice results could not be exported.");
    }
  };

  const retryPoint = useMemo(
    () => getRetryPoint(getLessonTime(), loopEnabled, loopStart, lastPlayedOnset),
    [getLessonTime, lastPlayedOnset, loopEnabled, loopStart],
  );
  const retry = () => {
    if (!engine) return;
    engine.seek(retryPoint);
    engine.play();
  };

  const enableMic = () => { void mic.start(); };
  const disableMic = () => { mic.stop(); };
  const micIsListening = micState.status === "listening";
  const micActive = input === "microphone" && micIsListening;

  return (
    <section className="practice-panel" aria-labelledby="practice-title">
      <div className="practice-heading">
        <div>
          <p className="eyebrow">Practice / 05B</p>
          <h2 id="practice-title">Practice scoring</h2>
        </div>
        <p className="practice-note"><Gauge size={13} /> Deterministic matching of your performance against the lesson, computed locally.</p>
      </div>

      <div className="practice-options">
        <fieldset className="practice-input">
          <legend>Practice input</legend>
          <label className="practice-input-option">
            <input
              type="radio"
              name="practice-input"
              value="midi"
              checked={input === "midi"}
              onChange={() => setInput("midi")}
            />
            <Piano size={14} />
            MIDI keyboard
          </label>
          <label className="practice-input-option">
            <input
              type="radio"
              name="practice-input"
              value="microphone"
              checked={input === "microphone"}
              onChange={() => setInput("microphone")}
            />
            <Mic size={14} />
            Microphone
          </label>
        </fieldset>
        <fieldset className="practice-focus">
          <legend>Focus</legend>
          {PRACTICE_FOCUS_ORDER.map((id) => (
            <label key={id} className="practice-focus-option">
              <input
                type="radio"
                name="practice-focus"
                value={id}
                checked={focus === id}
                onChange={() => setFocus(id)}
              />
              <span>{PRACTICE_FOCUS_META[id].label}</span>
              <em>{PRACTICE_FOCUS_META[id].description}</em>
            </label>
          ))}
        </fieldset>
        <label className="practice-toggle">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Score my playing
        </label>
        <label className="practice-toggle">
          <input type="checkbox" aria-label="Pause at each note" checked={waitMode} onChange={(event) => setWaitMode(event.target.checked)} disabled={!engine} />
          Pause at each note
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

      {input === "microphone" && (
        <div className="practice-mic" aria-label="Microphone input">
          <div className="practice-mic-actions">
            <button
              type="button"
              className="practice-mic-toggle"
              onClick={micIsListening ? disableMic : enableMic}
              disabled={micState.status === "requesting"}
              aria-pressed={micIsListening}
            >
              {micState.status === "listening" ? "Disable microphone" : micState.status === "requesting" ? "Requesting permission…" : "Enable microphone"}
            </button>
            <button
              type="button"
              className="practice-mic-calibrate"
              onClick={() => { void mic.calibrateNoise(); }}
              disabled={!micIsListening || micState.calibrating}
            >
              {micState.calibrating ? "Calibrating…" : "Calibrate noise"}
            </button>
          </div>
          <p className="practice-mic-status" role="status">{micStatusLabel(micState)}</p>
          <div className="practice-mic-meter" role="meter" aria-label="Input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(micState.level * 100)}>
            <div className="practice-mic-meter-fill" style={{ width: `${Math.min(100, Math.max(0, micState.level * 100))}%` }} />
          </div>
          <div className="practice-mic-readings">
            <span>Note <strong>{micState.noteName ?? "—"}</strong></span>
            <span>Confidence <strong>{Math.round(micState.confidence * 100)}%</strong></span>
            <span>Tuning <strong>{micState.cents === null ? "—" : `${micState.cents > 0 ? "+" : ""}${Math.round(micState.cents)}¢`}</strong></span>
          </div>
          <label className="practice-mic-threshold">
            Noise threshold <output>{micState.noiseThreshold.toFixed(3)}</output>
            <input aria-label="Noise threshold" type="range" min="0.004" max="0.3" step="0.002" value={micState.noiseThreshold} onChange={(event) => mic.setNoiseThreshold(Number(event.target.value))} disabled={!micIsListening} />
          </label>
          <p className="practice-privacy">Audio is analysed locally in your browser and never recorded, stored, uploaded, or transmitted. Microphone mode works best with one note at a time; MIDI keyboards are more accurate.</p>
        </div>
      )}

      {status === "waiting" && (
        <div className="practice-waiting" role="status">
          <strong>Waiting — play the next note to continue</strong>
          <button type="button" onClick={() => engine?.resume()} disabled={!engine}><SkipForward size={13} /> Skip to next</button>
        </div>
      )}

      {!enabled && (
        <p className="practice-hint">
          Turn on scoring, then play along with the lesson{input === "microphone" ? " on your microphone" : " on your MIDI keyboard"} to see live feedback here.
        </p>
      )}

      {enabled && !showSummary && (
        <div className="practice-live" aria-live="polite">
          <div className="practice-live-heading">
            <span className="eyebrow">Live feedback</span>
            <span className="practice-status-label">
              {micActive ? "Listening (mic)" : status === "waiting" ? "Waiting" : status === "playing" ? "Listening" : status === "count-in" ? "Count-in" : status === "paused" ? "Paused" : "Ready"}
              {engine?.loopEnabled && <span className="practice-loop-iteration"> Loop {engine.loopIteration}</span>}
            </span>
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
          <div className="practice-live-actions">
            <button type="button" className="practice-retry" onClick={retry} disabled={!engine}>Retry section</button>
          </div>
        </div>
      )}

      {showSummary && result && <Summary result={result} onRestart={onRestart} />}
      {isComplete && enabled && (!result || result.counts.performed === 0) && <p className="practice-hint">No notes were scored during this attempt. Enable scoring and play along next time.</p>}

      <PracticeResults
        results={practiceResults.results}
        hasStorage={practiceResults.hasStorage}
        exportStatus={exportStatus}
        onDelete={practiceResults.deleteResult}
        onClear={practiceResults.clearResults}
        onExport={handleExportResults}
        onPracticeAgain={onSelectLesson ? (lessonIdValue) => onSelectLesson(lessonIdValue) : null}
      />
    </section>
  );
}
