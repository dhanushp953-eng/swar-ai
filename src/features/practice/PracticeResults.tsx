"use client";

import { BarChart3, Download, FilterX, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { PRACTICE_FOCUS_META, PRACTICE_FOCUS_ORDER } from "@/lib/practice/modes";
import { PRACTICE_PRESET_META, PRACTICE_PRESET_ORDER } from "@/lib/practice/scoring";
import {
  EMPTY_FILTERS,
  availableLessons,
  computeStats,
  filterResults,
  type PracticeInput,
  type ProblemKind,
  type ResultsFilters,
  type StoredPracticeResult,
} from "./results-store";

const INPUT_LABELS: Record<PracticeInput, string> = {
  midi: "MIDI keyboard",
  microphone: "Microphone",
};

const PROBLEM_LABELS: Record<ProblemKind, string> = {
  correct: "correct",
  missed: "missed",
  early: "early",
  late: "late",
  wrong: "wrong pitch",
  extra: "extra",
};

function formatResultDate(createdAt: number): string {
  try {
    return new Date(createdAt).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    });
  } catch {
    return new Date(createdAt).toString();
  }
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

function TrendChart({ scores }: { scores: number[] }) {
  if (scores.length < 2) {
    return <p className="practice-results-trend-empty">At least two attempts are needed to chart a trend.</p>;
  }
  const width = 120;
  const height = 32;
  const points = scores
    .map((score, index) => {
      const x = (index / (scores.length - 1)) * width;
      const y = height - (Math.min(100, Math.max(0, score)) / 100) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className="practice-results-spark"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Score trend, oldest to newest: ${scores.map((score) => Math.round(score)).join(" to ")} out of 100`}
      preserveAspectRatio="none"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="practice-results-stat">
      <span className="practice-results-stat-label">{label}</span>
      <strong className="practice-results-stat-value">{value}</strong>
      <span className="practice-results-stat-sub">{sub}</span>
    </div>
  );
}

export type PracticeResultsProps = {
  /** Newest-first stored results (already validated). */
  results: StoredPracticeResult[];
  /** False when localStorage is unavailable (SSR, privacy mode). */
  hasStorage: boolean;
  /** Latest export/status feedback for the live region. */
  exportStatus: string | null;
  onDelete: (id: string) => void;
  onClear: () => void;
  onExport: () => void;
  /** When provided, "Practise again" becomes available on each row. */
  onPracticeAgain: ((lessonId: string) => void) | null;
};

export function PracticeResults({ results, hasStorage, exportStatus, onDelete, onClear, onExport, onPracticeAgain }: PracticeResultsProps) {
  const [filters, setFilters] = useState<ResultsFilters>(EMPTY_FILTERS);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const lessons = useMemo(() => availableLessons(results), [results]);
  const hasActiveFilters = filters.lessonId !== null || filters.input !== null || filters.focus !== null || filters.preset !== null;
  const filtered = useMemo(() => filterResults(results, filters), [results, filters]);
  const stats = useMemo(() => computeStats(filtered), [filtered]);
  const trendScores = useMemo(() => [...filtered].reverse().map((result) => result.overall), [filtered]);

  const setLessonFilter = (value: string) => setFilters((current) => ({ ...current, lessonId: value === "" ? null : value }));
  const setInputFilter = (value: string) => setFilters((current) => ({ ...current, input: value === "" ? null : (value as PracticeInput) }));
  const setFocusFilter = (value: string) => setFilters((current) => ({ ...current, focus: value === "" ? null : (value as ResultsFilters["focus"]) }));
  const setPresetFilter = (value: string) => setFilters((current) => ({ ...current, preset: value === "" ? null : (value as ResultsFilters["preset"]) }));
  const resetFilters = () => setFilters(EMPTY_FILTERS);

  if (!hasStorage) {
    return (
      <section className="practice-results" aria-labelledby="practice-results-title">
        <div className="practice-results-heading">
          <div>
            <p className="eyebrow">Practice / 05E</p>
            <h3 id="practice-results-title">Results dashboard</h3>
          </div>
        </div>
        <p className="practice-results-empty">Attempt results are kept in your browser’s local storage, which is unavailable in this session, so nothing can be saved or shown here.</p>
      </section>
    );
  }

  return (
    <section className="practice-results" aria-labelledby="practice-results-title">
      <div className="practice-results-heading">
        <div>
          <p className="eyebrow">Practice / 05E</p>
          <h3 id="practice-results-title">Results dashboard</h3>
        </div>
        <p className="practice-results-note"><BarChart3 size={13} /> History is stored locally in your browser. Nothing is uploaded.</p>
      </div>

      {results.length === 0 ? (
        <div className="practice-results-empty">
          <p>No saved attempts yet. Finish a practice run with scoring enabled and your results will appear here.</p>
        </div>
      ) : (
        <>
          <div className="practice-results-stats">
            <StatCard
              label="Latest"
              value={stats.latest ? String(stats.latest.overall) : "—"}
              sub={stats.latest ? stats.latest.lessonTitle : "No attempts"}
            />
            <StatCard
              label="Best"
              value={stats.best ? String(stats.best.overall) : "—"}
              sub={stats.best ? stats.best.lessonTitle : "No attempts"}
            />
            <StatCard
              label="Average"
              value={stats.average === null ? "—" : String(stats.average)}
              sub={`${stats.count} attempt${stats.count === 1 ? "" : "s"}`}
            />
            <div className="practice-results-stat practice-results-trend">
              <span className="practice-results-stat-label">Trend</span>
              <TrendChart scores={trendScores} />
            </div>
          </div>

          <fieldset className="practice-results-filters">
            <legend>Filter attempts</legend>
            <label>
              Lesson
              <select aria-label="Filter by lesson" value={filters.lessonId ?? ""} onChange={(event) => setLessonFilter(event.target.value)}>
                <option value="">All lessons</option>
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>{lesson.title}</option>
                ))}
              </select>
            </label>
            <label>
              Input
              <select aria-label="Filter by input" value={filters.input ?? ""} onChange={(event) => setInputFilter(event.target.value)}>
                <option value="">All inputs</option>
                <option value="midi">MIDI keyboard</option>
                <option value="microphone">Microphone</option>
              </select>
            </label>
            <label>
              Focus
              <select aria-label="Filter by focus mode" value={filters.focus ?? ""} onChange={(event) => setFocusFilter(event.target.value)}>
                <option value="">All focus modes</option>
                {PRACTICE_FOCUS_ORDER.map((focus) => (
                  <option key={focus} value={focus}>{PRACTICE_FOCUS_META[focus].label}</option>
                ))}
              </select>
            </label>
            <label>
              Strictness
              <select aria-label="Filter by strictness" value={filters.preset ?? ""} onChange={(event) => setPresetFilter(event.target.value)}>
                <option value="">All strictness</option>
                {PRACTICE_PRESET_ORDER.map((preset) => (
                  <option key={preset} value={preset}>{PRACTICE_PRESET_META[preset].label}</option>
                ))}
              </select>
            </label>
            {hasActiveFilters && (
              <button type="button" className="practice-results-reset" onClick={resetFilters}>
                <FilterX size={13} /> Reset filters
              </button>
            )}
          </fieldset>

          <ul className="practice-results-list" aria-label="Saved practice attempts">
            {filtered.map((result, index) => (
              <li key={`${result.id}-${index}`} className="practice-results-row">
                <div className="practice-results-score">
                  <strong>{result.overall}</strong>
                  <span>/ 100</span>
                </div>
                <div className="practice-results-row-main">
                  <div className="practice-results-row-heading">
                    <strong>{result.lessonTitle}</strong>
                    <time dateTime={new Date(result.createdAt).toISOString()}>{formatResultDate(result.createdAt)}</time>
                  </div>
                  <p className="practice-results-meta">
                    <span>{INPUT_LABELS[result.input]}</span>
                    <span>{PRACTICE_FOCUS_META[result.focus].label}</span>
                    <span>{PRACTICE_PRESET_META[result.preset].label}</span>
                    <span>Matched {result.counts.matched} of {result.counts.expected}</span>
                  </p>
                  {result.problems.length > 0 && (
                    <ul className="practice-results-problems" aria-label={`Difficult notes for ${result.lessonTitle}`}>
                      {result.problems.slice(0, 5).map((problem, index) => (
                        <li key={`${result.id}-${index}`}>
                          <span className="practice-results-problem-kind">{PROBLEM_LABELS[problem.kind]}</span>
                          {problem.name} at {formatSeconds(problem.at)}
                        </li>
                      ))}
                      {result.problems.length > 5 && <li className="practice-results-problems-more">+{result.problems.length - 5} more</li>}
                    </ul>
                  )}
                </div>
                <div className="practice-results-row-actions">
                  {onPracticeAgain && (
                    <button type="button" className="practice-results-practice" onClick={() => onPracticeAgain(result.lessonId)}>
                      <RotateCcw size={13} /> Practise again
                    </button>
                  )}
                  <button
                    type="button"
                    className="practice-results-delete"
                    aria-label={`Delete attempt from ${formatResultDate(result.createdAt)}`}
                    onClick={() => onDelete(result.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {filtered.length === 0 && <p className="practice-results-empty">No attempts match the current filters.</p>}

          <div className="practice-results-actions">
            <button type="button" className="practice-results-export" onClick={onExport}>
              <Download size={13} /> Export results
            </button>
            {confirmingClear ? (
              <span className="practice-results-clear-confirm">
                <span className="practice-results-clear-question">Delete all {results.length} attempts?</span>
                <button type="button" className="practice-results-danger" onClick={() => { onClear(); setConfirmingClear(false); }}>
                  Confirm delete all
                </button>
                <button type="button" className="practice-results-cancel" onClick={() => setConfirmingClear(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" className="practice-results-danger" onClick={() => setConfirmingClear(true)}>
                <Trash2 size={13} /> Clear all history
              </button>
            )}
          </div>
        </>
      )}

      <p className="practice-results-status" role="status" aria-live="polite">{exportStatus}</p>
    </section>
  );
}
