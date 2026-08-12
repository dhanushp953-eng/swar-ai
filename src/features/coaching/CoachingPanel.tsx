"use client";

import { AlertCircle, Check, CheckCircle2, Clock3, ListChecks, LoaderCircle, Play, RefreshCw, ShieldCheck, Sparkles, Target } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StorageLike, StoredPracticeResult } from "@/features/practice/results-store";
import type { LessonExercise } from "@/types/lesson";
import { requestCoachingWording } from "./coaching-api";
import {
  buildCoachingPlan,
  preserveGoalCompletion,
  selectRecentCoachingResults,
  type CoachingPlan,
  type CoachingTrendDirection,
} from "./coaching-plan";
import {
  getBrowserStorage,
  readCoachingPlan,
  saveCoachingPlan,
  updateCoachingGoal,
} from "./coaching-store";
import { TutorApiError } from "@/lib/tutor-api";

type CoachingPanelProps = {
  lesson: LessonExercise;
  recentResults: StoredPracticeResult[];
  onPracticeLesson: () => void;
  onPracticeSection: (start: number, end: number) => void;
};

type CoachingState = "empty" | "loading" | "ready" | "fallback" | "error";

const TREND_LABELS: Record<CoachingTrendDirection, string> = {
  improving: "Improving",
  steady: "Steady",
  "needs-attention": "Needs attention",
  "insufficient-data": "Need more data",
};

function formatMinutes(value: number): string {
  return `${value} minute${value === 1 ? "" : "s"}`;
}

function formatSection(start: number, end: number): string {
  return `${start.toFixed(1)}s–${end.toFixed(1)}s`;
}

function providerLabel(plan: CoachingPlan): string {
  if (plan.wordingProvider === "local") return "Deterministic local plan";
  if (plan.wordingProvider === "mock") return "Local mock wording";
  return `${plan.wordingProvider === "gemini" ? "Gemini" : "Groq"} wording assist`;
}

function stateMessage(state: CoachingState): string {
  if (state === "loading") return "Building a local plan, then checking whether the tutor can improve its wording…";
  if (state === "error") return "The local plan is ready, but the wording assist could not respond.";
  return "";
}

function trendClass(direction: CoachingTrendDirection): string {
  return direction === "needs-attention" ? "is-warning" : direction === "improving" ? "is-positive" : "";
}

export function CoachingPanel({ lesson, recentResults: allResults, onPracticeLesson, onPracticeSection }: CoachingPanelProps) {
  const recentResults = useMemo(() => selectRecentCoachingResults(allResults, lesson.id), [allResults, lesson.id]);
  const [plan, setPlan] = useState<CoachingPlan | null>(null);
  const [state, setState] = useState<CoachingState>("empty");
  const [error, setError] = useState<string | null>(null);
  const storageRef = useRef<StorageLike | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const processedSourceRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    storageRef.current = getBrowserStorage();
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
    };
  }, []);

  const generate = useCallback((existingPlan: CoachingPlan | null = null) => {
    if (requestRef.current || recentResults.length === 0) return;
    const storage = storageRef.current ?? getBrowserStorage();
    storageRef.current = storage;
    const localPlan = buildCoachingPlan(lesson, recentResults);
    if (!localPlan) {
      setPlan(null);
      setState("empty");
      return;
    }
    const nextPlan = preserveGoalCompletion(localPlan, existingPlan ?? plan);
    setPlan(nextPlan);
    saveCoachingPlan(storage, nextPlan);
    setError(null);
    setState("loading");
    const latest = recentResults[0];
    const controller = new AbortController();
    requestRef.current = controller;
    void requestCoachingWording(lesson, latest, nextPlan, controller.signal)
      .then((wordedPlan) => {
        if (!mountedRef.current) return;
        const preserved = preserveGoalCompletion(wordedPlan, plan);
        setPlan(preserved);
        saveCoachingPlan(storage, preserved);
        setState(preserved.wordingFallback ? "fallback" : "ready");
      })
      .catch((requestError: unknown) => {
        if (!mountedRef.current || (requestError instanceof TutorApiError && requestError.kind === "cancelled")) return;
        setError(requestError instanceof TutorApiError ? requestError.message : "The wording assist could not respond.");
        setState("error");
      })
      .finally(() => {
        if (requestRef.current === controller) requestRef.current = null;
      });
  }, [lesson, plan, recentResults]);

  useEffect(() => {
    if (recentResults.length === 0) {
      processedSourceRef.current = null;
      return;
    }
    const sourceKey = `${lesson.id}:${recentResults[0].createdAt}:${recentResults.length}`;
    if (processedSourceRef.current === sourceKey) return;
    processedSourceRef.current = sourceKey;
    requestRef.current?.abort();
    requestRef.current = null;
    const storage = storageRef.current ?? getBrowserStorage();
    storageRef.current = storage;
    const stored = readCoachingPlan(storage, lesson.id);
    const latest = recentResults[0];
    if (stored && stored.sourceLatestCreatedAt === latest.createdAt) {
      setPlan(stored);
      setState(stored.wordingProvider === "local" ? "fallback" : stored.wordingFallback ? "fallback" : "ready");
      return;
    }
    generate(stored);
  }, [generate, lesson.id, recentResults]);

  const toggleGoal = (goalId: string, completed: boolean) => {
    const storage = storageRef.current ?? getBrowserStorage();
    storageRef.current = storage;
    const next = updateCoachingGoal(storage, lesson.id, goalId, completed);
    if (next) setPlan(next);
  };

  const retry = () => {
    if (plan) generate(plan);
  };
  const busy = state === "loading";
  const latestCreatedAt = recentResults[0]?.createdAt ?? null;
  const activePlan = plan?.lessonId === lesson.id && plan.sourceLatestCreatedAt === latestCreatedAt ? plan : null;
  const visibleState: CoachingState = recentResults.length === 0 ? "empty" : activePlan ? state : "loading";

  return (
    <section className="coaching-panel" aria-labelledby="coaching-title">
      <div className="coaching-heading">
        <div>
          <p className="eyebrow">Personalized coaching / 06D</p>
          <h2 id="coaching-title">Your next session.</h2>
        </div>
        <p className="coaching-intro">A private plan built from recent local score summaries, repeated mistakes, and difficult notes.</p>
      </div>
      <div className="coaching-safety-row">
        <span className="coaching-safe-note"><ShieldCheck size={14} /> Only sanitized score summaries are used. No raw MIDI, audio, files, history dump, or personal data leaves this browser.</span>
        {activePlan && <span className="coaching-provider-badge"><Sparkles size={13} /> {providerLabel(activePlan)}</span>}
      </div>

      {visibleState === "empty" && (
        <div className="coaching-empty" role="status">
          <span className="coaching-empty-icon"><Target size={19} /></span>
          <strong>{recentResults.length === 0 ? "Complete a scored attempt to unlock your plan." : "No plan is available yet."}</strong>
          <p>{recentResults.length === 0 ? "Your first plan will appear after a local practice result is saved for this lesson." : "Try generating the local plan again."}</p>
        </div>
      )}

      {busy || visibleState === "loading" ? <p className="coaching-state coaching-state-loading" aria-live="polite"><LoaderCircle className="coaching-spin" size={16} /> {stateMessage("loading")}</p> : null}
      {visibleState === "error" && <div className="coaching-state coaching-state-error" role="alert"><AlertCircle size={16} /><span>{error ?? stateMessage(visibleState)}</span><button type="button" onClick={retry}><RefreshCw size={13} /> Retry wording</button></div>}
      {visibleState === "fallback" && <p className="coaching-state coaching-state-fallback" role="status"><Sparkles size={15} /> Deterministic local recommendations are active. Wording assist is optional.</p>}
      {visibleState === "ready" && <p className="coaching-state coaching-state-success" role="status"><CheckCircle2 size={15} /> Plan facts come from local scoring; the tutor only polished the wording.</p>}

      {activePlan && (
        <div className="coaching-content">
          <div className="coaching-plan-header">
            <div><span className="coaching-section-label">Plan overview</span><p className="coaching-overview">{activePlan.overview}</p></div>
            <button type="button" className="coaching-regenerate" onClick={() => generate(activePlan)} disabled={busy || recentResults.length === 0}><RefreshCw size={13} /> Regenerate plan</button>
          </div>
          <div className="coaching-plan-facts">
            <div><Clock3 size={15} /><span>Recommended tempo<strong>{activePlan.recommendedTempo} BPM</strong></span><small>{activePlan.tempoReason}</small></div>
            <div><Target size={15} /><span>Practice mode<strong>{activePlan.practiceMode}</strong></span><small>{activePlan.practiceModeReason}</small></div>
            <div><ListChecks size={15} /><span>Session<strong>{formatMinutes(activePlan.sessionDurationMinutes)}</strong></span><small>Short enough to keep the focus deliberate and repeatable.</small></div>
          </div>
          <div className="coaching-trends" aria-labelledby="coaching-trends-title">
            <div className="coaching-subheading"><span id="coaching-trends-title" className="coaching-section-label">Progress trends</span><small>{activePlan.sourceAttemptCount} recent attempt{activePlan.sourceAttemptCount === 1 ? "" : "s"} used</small></div>
            <div className="coaching-trend-grid">
              {activePlan.trends.map((trend) => <div key={trend.metric} className={`coaching-trend ${trendClass(trend.direction)}`}><span>{trend.label}</span><strong>{trend.latest === null ? "—" : trend.latest}</strong><em>{TREND_LABELS[trend.direction]}{trend.change === null ? "" : ` · ${trend.change > 0 ? "+" : ""}${trend.change}`}</em><small>{trend.explanation}</small></div>)}
            </div>
          </div>
          <div className="coaching-focus-row">
            <div><span className="coaching-section-label">Focus notes and section</span><strong>{activePlan.focusNotes.length > 0 ? activePlan.focusNotes.join(", ") : "Opening phrase"}</strong><p>{activePlan.focusSection.reason}</p><small>{formatSection(activePlan.focusSection.start, activePlan.focusSection.end)}</small></div>
            <div className="coaching-focus-actions"><button type="button" className="coaching-action-primary" onClick={() => onPracticeSection(activePlan.focusSection.start, activePlan.focusSection.end)}><Play size={14} /> Practise section</button><button type="button" className="coaching-action-secondary" onClick={onPracticeLesson}><Play size={14} /> Practise full lesson</button></div>
          </div>
          <div className="coaching-goals"><div className="coaching-subheading"><span className="coaching-section-label">Goals</span><small>Mark each step as you complete it.</small></div><div className="coaching-goal-list">{activePlan.goals.map((goal) => <label key={goal.id} className={`coaching-goal ${goal.completed ? "is-complete" : ""}`}><input type="checkbox" checked={goal.completed} onChange={(event) => toggleGoal(goal.id, event.target.checked)} /><span className="coaching-goal-check"><Check size={13} /></span><span><strong>{goal.title}</strong><em>{goal.description}</em><small>Why: {goal.why}</small></span></label>)}</div></div>
          <div className="coaching-exercises"><span className="coaching-section-label">Exercises</span><div className="coaching-exercise-grid">{activePlan.exercises.map((exercise, index) => <article key={exercise.id}><span>{String(index + 1).padStart(2, "0")}</span><strong>{exercise.title}</strong><p>{exercise.instructions}</p><small>Why this was selected: {exercise.why}</small></article>)}</div></div>
        </div>
      )}
    </section>
  );
}
