// Pure, framework-independent practice-results store.
// Persists compact, sanitized score summaries (never raw MIDI streams, audio,
// blobs, or personal data) to versioned localStorage. Everything here is
// storage-injectable and DOM-free so the read/write/validate/export logic can
// be unit tested without a browser. No React.

import {
  PRACTICE_PRESET_ORDER,
  type PerformedClassification,
  type PracticePresetId,
  type ScoreCounts,
  type ScoreResult,
} from "@/lib/practice/scoring";
import { PRACTICE_FOCUS_ORDER, type PracticeFocus } from "@/lib/practice/modes";
import type { HandMode } from "@/types/lesson";

export type PracticeInput = "midi" | "microphone";

export const STORAGE_KEY = "piano.practice.results.v1";
export const RESULTS_SCHEMA = "piano-practice-results";
export const STORAGE_VERSION = 1;
export const MAX_RESULTS = 100;
export const MAX_PROBLEMS_PER_RESULT = 40;
const MAX_LESSON_TITLE_LENGTH = 120;

/** Minimal storage surface so tests can inject an in-memory fake. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type ProblemKind = PerformedClassification | "missed";

export type ProblemNote = {
  name: string;
  /** lesson-time (seconds) where the problem occurred */
  at: number;
  kind: ProblemKind;
};

export type StoredPracticeResult = {
  version: typeof STORAGE_VERSION;
  id: string;
  lessonId: string;
  lessonTitle: string;
  input: PracticeInput;
  focus: PracticeFocus;
  preset: PracticePresetId;
  handMode: HandMode;
  /** epoch milliseconds */
  createdAt: number;
  /** rounded overall score, 0-100 */
  overall: number;
  pitch: number;
  timing: number;
  duration: number;
  correctNotes: number;
  counts: ScoreCounts;
  /** capped list of the most problematic performed/expected notes */
  problems: ProblemNote[];
};

export type NewStoredResult = {
  id?: string;
  lessonId: string;
  lessonTitle: string;
  input: PracticeInput;
  focus: PracticeFocus;
  preset: PracticePresetId;
  handMode: HandMode;
  createdAt?: number;
  result: ScoreResult;
};

export type ResultsFilters = {
  lessonId: string | null;
  input: PracticeInput | null;
  focus: PracticeFocus | null;
  preset: PracticePresetId | null;
};

export const EMPTY_FILTERS: ResultsFilters = { lessonId: null, input: null, focus: null, preset: null };

const PROBLEM_KINDS: ReadonlySet<string> = new Set<string>(["correct", "early", "late", "wrong", "extra", "missed"]);

export function createResultId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** True when the unknown value is a structurally valid stored result. */
export function isStoredResult(value: unknown): value is StoredPracticeResult {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== STORAGE_VERSION) return false;
  if (typeof record.id !== "string" || typeof record.lessonId !== "string" || typeof record.lessonTitle !== "string") return false;
  if (record.input !== "midi" && record.input !== "microphone") return false;
  if (!PRACTICE_FOCUS_ORDER.includes(record.focus as PracticeFocus)) return false;
  if (!PRACTICE_PRESET_ORDER.includes(record.preset as PracticePresetId)) return false;
  if (record.handMode !== "left" && record.handMode !== "right" && record.handMode !== "both") return false;
  if (!isFiniteNumber(record.createdAt)) return false;
  for (const key of ["overall", "pitch", "timing", "duration", "correctNotes"]) {
    const score = record[key];
    if (!isFiniteNumber(score) || score < 0 || score > 100) return false;
  }
  const counts = record.counts as Record<string, unknown> | undefined;
  if (typeof counts !== "object" || counts === null) return false;
  for (const key of ["expected", "performed", "correct", "early", "late", "wrong", "extra", "matched", "missed", "pending"]) {
    if (!isFiniteNumber(counts[key]) || counts[key] < 0) return false;
  }
  if (!Array.isArray(record.problems)) return false;
  for (const problem of record.problems) {
    if (typeof problem !== "object" || problem === null) return false;
    const entry = problem as Record<string, unknown>;
    if (typeof entry.name !== "string" || !isFiniteNumber(entry.at)) return false;
    if (typeof entry.kind !== "string" || !PROBLEM_KINDS.has(entry.kind)) return false;
  }
  return true;
}

/** Keeps only structurally valid entries, newest first, capped.
 *  Records that share an id (e.g. legacy collision-prone ids stored by an
 *  older build) are collapsed to a single entry, keeping the newest valid
 *  result so history is preserved rather than duplicated. */
export function validateResultsArray(value: unknown): StoredPracticeResult[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const deduped: StoredPracticeResult[] = [];
  for (const result of value.filter(isStoredResult).sort((a, b) => b.createdAt - a.createdAt)) {
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    deduped.push(result);
  }
  return deduped.slice(0, MAX_RESULTS);
}

/** Best-effort storage read; corrupted, truncated, or foreign payloads become empty.
 *  When the stored payload contains duplicate ids (legacy collision-prone data),
 *  the cleaned, newest-wins list is written back so the store self-repairs. */
export function readResults(storage: StorageLike | null): StoredPracticeResult[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const results = validateResultsArray(JSON.parse(raw));
    const repaired = JSON.stringify(results);
    if (repaired !== raw) {
      try {
        storage.setItem(STORAGE_KEY, repaired);
      } catch {
        // repair is best-effort; the cleaned list is still returned
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Writes the results, trimming the oldest entries if the payload no longer
 * fits (e.g. quota exceeded), so the store never throws at the caller.
 */
export function writeResults(storage: StorageLike, results: StoredPracticeResult[]): boolean {
  if (!storage) return false;
  let current = results;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(current));
    return true;
  } catch {
    // fall through and drop oldest until the payload fits
  }
  while (current.length > 0) {
    current = current.slice(0, -1);
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(current));
      return true;
    } catch {
      // keep dropping
    }
  }
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // storage is unusable
  }
  return false;
}

/** Prepends a result, enforces the cap, and persists. Returns the new list. */
export function addResult(storage: StorageLike | null, result: StoredPracticeResult): StoredPracticeResult[] {
  const next = [result, ...readResults(storage)].slice(0, MAX_RESULTS);
  if (storage) writeResults(storage, next);
  return next;
}

/** Removes one attempt by id. Returns the new list. */
export function deleteResult(storage: StorageLike | null, id: string): StoredPracticeResult[] {
  const next = readResults(storage).filter((result) => result.id !== id);
  if (storage) writeResults(storage, next);
  return next;
}

/** Removes every attempt. Returns the (now empty) list. */
export function clearResults(storage: StorageLike | null): StoredPracticeResult[] {
  if (storage) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // storage is unusable
    }
  }
  return [];
}

function deriveProblems(result: ScoreResult): ProblemNote[] {
  const problems: ProblemNote[] = [];
  for (const note of result.performedNotes) {
    if (note.classification === "correct") continue;
    problems.push({ name: note.noteName, at: note.onset, kind: note.classification });
  }
  for (const note of result.expectedNotes) {
    if (note.classification !== "missed") continue;
    problems.push({ name: note.noteName, at: note.start, kind: "missed" });
  }
  return problems.sort((a, b) => a.at - b.at).slice(0, MAX_PROBLEMS_PER_RESULT);
}

/**
 * Builds a compact, sanitized stored result from a full ScoreResult. Only
 * rounded scores, summary counts, and derived problem notes are kept — never
 * the raw performed/expected note streams or any media.
 */
export function createStoredResult(input: NewStoredResult): StoredPracticeResult {
  const { result } = input;
  return {
    version: STORAGE_VERSION,
    id: input.id ?? createResultId(),
    lessonId: input.lessonId,
    lessonTitle: String(input.lessonTitle ?? "Untitled lesson").slice(0, MAX_LESSON_TITLE_LENGTH),
    input: input.input,
    focus: input.focus,
    preset: input.preset,
    handMode: input.handMode,
    createdAt: input.createdAt ?? Date.now(),
    overall: Math.round(result.scores.overall.value),
    pitch: Math.round(result.scores.pitch.value),
    timing: Math.round(result.scores.timing.value),
    duration: Math.round(result.scores.duration.value),
    correctNotes: Math.round(result.scores.correctNotes.value),
    counts: result.counts,
    problems: deriveProblems(result),
  };
}

/** Serializes results to a versioned, validated JSON document for download. */
export function serializeResultsExport(results: StoredPracticeResult[]): string {
  return JSON.stringify(
    { schema: RESULTS_SCHEMA, version: STORAGE_VERSION, exportedAt: Date.now(), results },
    null,
    2,
  );
}

/** Parses an exported JSON document back into validated results (round-trip). */
export function parseResultsExport(text: string): StoredPracticeResult[] {
  try {
    const parsed = JSON.parse(text) as { results?: unknown };
    if (typeof parsed !== "object" || parsed === null) return [];
    return validateResultsArray(parsed.results);
  } catch {
    return [];
  }
}

/** Unique lessons present in the history, newest lesson title wins. */
export function availableLessons(results: StoredPracticeResult[]): { id: string; title: string }[] {
  const byId = new Map<string, string>();
  for (const result of results) byId.set(result.lessonId, result.lessonTitle);
  return [...byId.entries()].map(([id, title]) => ({ id, title }));
}

/** Applies the (nullable) filter selections. Preserves input order. */
export function filterResults(results: StoredPracticeResult[], filters: ResultsFilters): StoredPracticeResult[] {
  return results.filter(
    (result) =>
      (filters.lessonId === null || result.lessonId === filters.lessonId) &&
      (filters.input === null || result.input === filters.input) &&
      (filters.focus === null || result.focus === filters.focus) &&
      (filters.preset === null || result.preset === filters.preset),
  );
}

export type ResultStats = {
  count: number;
  /** most recent attempt in the (already newest-first) list */
  latest: StoredPracticeResult | null;
  best: StoredPracticeResult | null;
  /** rounded mean overall score, null when there are no attempts */
  average: number | null;
};

export function computeStats(results: StoredPracticeResult[]): ResultStats {
  if (results.length === 0) return { count: 0, latest: null, best: null, average: null };
  let best = results[0];
  let sum = 0;
  for (const result of results) {
    sum += result.overall;
    if (result.overall > best.overall) best = result;
  }
  return { count: results.length, latest: results[0], best, average: Math.round(sum / results.length) };
}
