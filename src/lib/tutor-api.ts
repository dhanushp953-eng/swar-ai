import type { PracticeFocus } from "@/lib/practice/modes";
import type { ScoreResult } from "@/lib/practice/scoring";
import type { StoredPracticeResult } from "@/features/practice/results-store";
import type { LessonExercise } from "@/types/lesson";
import { resolveServiceBaseUrl } from "./service-url";

export type TutorPracticeMode = "full" | "melody" | "rhythm";

export type TutorExpectedNote = {
  name: string;
  start: number;
  duration: number;
  hand: "left" | "right" | null;
};

export type TutorScores = {
  overall: number | null;
  pitch: number | null;
  timing: number | null;
  rhythm: number | null;
  duration: number | null;
};

export type TutorMistakeCounts = {
  wrong_pitch: number;
  early: number;
  late: number;
  missed: number;
  extra: number;
};

export type TutorAdviceRequest = {
  lesson_name: string;
  expected_notes: TutorExpectedNote[];
  scores: TutorScores;
  mistake_counts: TutorMistakeCounts;
  difficult_notes: string[];
  practice_mode: TutorPracticeMode;
  user_question?: string;
};

export type TutorExercise = {
  title: string;
  instructions: string;
};

export type TutorAdvice = {
  summary: string;
  strengths: string[];
  improvement_priorities: string[];
  pitch_feedback: string;
  timing_feedback: string;
  rhythm_feedback: string;
  exercises: TutorExercise[];
};

export type TutorProvider = "gemini" | "groq" | "mock";
export type TutorFallbackReason = "not_configured" | "timeout" | "invalid_response" | "response_too_large" | "rate_limited" | "provider_failure";

export type TutorAdviceResponse = {
  advice: TutorAdvice;
  provider: TutorProvider;
  used_fallback: boolean;
  fallback_reason: TutorFallbackReason | null;
};

export type TutorPracticeSnapshot = {
  scores: TutorScores;
  mistake_counts: TutorMistakeCounts;
  difficult_notes: string[];
  practice_mode: TutorPracticeMode;
};

export type TutorProviderAvailability = "configured" | "available" | "unavailable";
export type TutorProviderStatus = { providers: Record<TutorProvider, TutorProviderAvailability> };

export const TUTOR_REQUEST_TIMEOUT_MS = 20_000;
export const TUTOR_API_PATH = "/api/tutor/advice";

export class TutorApiError extends Error {
  readonly code: string;
  readonly statusCode: number | null;
  readonly kind: "offline" | "timeout" | "server" | "invalid_response" | "cancelled";

  constructor(message: string, options: { code?: string; statusCode?: number | null; kind?: TutorApiError["kind"] } = {}) {
    super(message);
    this.name = "TutorApiError";
    this.code = options.code ?? "tutor_api_error";
    this.statusCode = options.statusCode ?? null;
    this.kind = options.kind ?? "server";
  }
}

const NOTE_NAME_PATTERN = /^[A-Ga-g](?:#|b)?[0-8]$/;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const PHONE_PATTERN = /(?<!\d)(?:\+?\d[\s().-]?){7,}\d(?!\d)/;
const UNSAFE_QUESTION_MARKERS = [
  "ignore previous",
  "ignore the context",
  "system prompt",
  "developer message",
  "reveal the prompt",
  "follow these instructions instead",
  "raw midi",
  "audio recording",
  "microphone",
  "file://",
  "lyrics",
  "song words",
  "personal data",
  "private information",
  "my name is",
  "my address is",
  "my phone is",
  "my email is",
  "api key",
  "secret",
];

export function sanitizeTutorQuestion(value: string): { value: string | null; error: string | null } {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) return { value: null, error: null };
  if (cleaned.length > 300) return { value: null, error: "Keep your question under 300 characters." };
  const lowered = cleaned.toLowerCase();
  if (EMAIL_PATTERN.test(cleaned) || PHONE_PATTERN.test(cleaned) || UNSAFE_QUESTION_MARKERS.some((marker) => lowered.includes(marker))) {
    return { value: null, error: "Keep questions focused on music practice. Personal data, media, lyrics, and instructions are not sent." };
  }
  return { value: cleaned, error: null };
}

function safeLessonName(title: string): string {
  const cleaned = title.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > 120 || EMAIL_PATTERN.test(cleaned) || PHONE_PATTERN.test(cleaned) || UNSAFE_QUESTION_MARKERS.some((marker) => cleaned.toLowerCase().includes(marker))) return "Current lesson";
  return cleaned;
}

function safeNoteName(name: string): string | null {
  const cleaned = name.trim();
  return NOTE_NAME_PATTERN.test(cleaned) ? cleaned : null;
}

function safeScore(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
}

export function createTutorPracticeSnapshot(result: ScoreResult, focus: PracticeFocus): TutorPracticeSnapshot {
  const difficult = [
    ...result.expectedNotes.filter((note) => note.classification === "missed").map((note) => note.noteName),
    ...result.performedNotes.filter((note) => note.classification === "wrong").map((note) => note.matchedEventName ?? note.noteName),
  ].filter((name, index, names) => NOTE_NAME_PATTERN.test(name) && names.indexOf(name) === index).slice(0, 24);
  return {
    scores: {
      overall: safeScore(result.scores.overall.value),
      pitch: safeScore(result.scores.pitch.value),
      timing: safeScore(result.scores.timing.value),
      rhythm: focus === "rhythm" ? safeScore(result.scores.timing.value) : null,
      duration: safeScore(result.scores.duration.value),
    },
    mistake_counts: {
      wrong_pitch: result.counts.wrong,
      early: result.counts.early,
      late: result.counts.late,
      missed: result.counts.missed,
      extra: result.counts.extra,
    },
    difficult_notes: difficult,
    practice_mode: focus,
  };
}

export function createTutorPracticeSnapshotFromStoredResult(result: StoredPracticeResult): TutorPracticeSnapshot {
  return {
    scores: {
      overall: safeScore(result.overall),
      pitch: safeScore(result.pitch),
      timing: safeScore(result.timing),
      rhythm: result.focus === "rhythm" ? safeScore(result.timing) : null,
      duration: safeScore(result.duration),
    },
    mistake_counts: {
      wrong_pitch: Math.max(0, result.counts.wrong),
      early: Math.max(0, result.counts.early),
      late: Math.max(0, result.counts.late),
      missed: Math.max(0, result.counts.missed),
      extra: Math.max(0, result.counts.extra),
    },
    difficult_notes: result.problems
      .map((problem) => problem.name)
      .filter((name, index, names) => NOTE_NAME_PATTERN.test(name) && names.indexOf(name) === index)
      .slice(0, 24),
    practice_mode: result.focus,
  };
}

export function buildTutorAdviceRequest(lesson: LessonExercise, snapshot: TutorPracticeSnapshot, question: string): { request: TutorAdviceRequest | null; error: string | null } {
  const sanitizedQuestion = sanitizeTutorQuestion(question);
  if (sanitizedQuestion.error) return { request: null, error: sanitizedQuestion.error };
  const expectedNotes = lesson.events.slice(0, 128).flatMap((event) => {
    const name = safeNoteName(event.name);
    if (!name || !Number.isFinite(event.start) || !Number.isFinite(event.duration) || event.start < 0 || event.duration <= 0) return [];
    return [{ name, start: Math.max(0, event.start), duration: Math.max(0.01, event.duration), hand: event.hand }];
  });
  return {
    request: {
      lesson_name: safeLessonName(lesson.title),
      expected_notes: expectedNotes,
      scores: snapshot.scores,
      mistake_counts: snapshot.mistake_counts,
      difficult_notes: snapshot.difficult_notes.filter((name) => Boolean(safeNoteName(name))).slice(0, 24),
      practice_mode: snapshot.practice_mode,
      ...(sanitizedQuestion.value ? { user_question: sanitizedQuestion.value } : {}),
    },
    error: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown, min: number, max: number): value is string[] {
  return Array.isArray(value) && value.length >= min && value.length <= max && value.every((item) => typeof item === "string" && item.length > 0);
}

function isAdvice(value: unknown): value is TutorAdvice {
  if (!isRecord(value)) return false;
  return typeof value.summary === "string" && isStringArray(value.strengths, 1, 3) && isStringArray(value.improvement_priorities, 1, 3) && typeof value.pitch_feedback === "string" && typeof value.timing_feedback === "string" && typeof value.rhythm_feedback === "string" && Array.isArray(value.exercises) && value.exercises.length >= 2 && value.exercises.length <= 4 && value.exercises.every((exercise) => isRecord(exercise) && typeof exercise.title === "string" && typeof exercise.instructions === "string");
}

function isTutorResponse(value: unknown): value is TutorAdviceResponse {
  if (!isRecord(value) || !isAdvice(value.advice)) return false;
  const validFallbackReason = value.fallback_reason === null || value.fallback_reason === "not_configured" || value.fallback_reason === "timeout" || value.fallback_reason === "invalid_response" || value.fallback_reason === "response_too_large" || value.fallback_reason === "rate_limited" || value.fallback_reason === "provider_failure";
  return (value.provider === "gemini" || value.provider === "groq" || value.provider === "mock") && typeof value.used_fallback === "boolean" && validFallbackReason;
}

export function getTutorApiUrl(): string {
  return resolveServiceBaseUrl(process.env.NEXT_PUBLIC_TUTOR_API_URL ?? process.env.NEXT_PUBLIC_AUDIO_API_URL);
}

function getErrorPayload(payload: unknown): { code: string; message: string } {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
    return { code: typeof payload.error.code === "string" ? payload.error.code : "tutor_request_failed", message: payload.error.message };
  }
  return { code: "tutor_request_failed", message: "The tutor could not respond right now." };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function timeoutError(): TutorApiError {
  return new TutorApiError("The tutor request timed out. Try again.", { code: "timeout", kind: "timeout" });
}

export async function requestTutorAdvice(request: TutorAdviceRequest, signal?: AbortSignal): Promise<TutorAdviceResponse> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TUTOR_REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(`${getTutorApiUrl()}${TUTOR_API_PATH}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const payload = parseJson(await response.text());
    if (!response.ok) {
      const error = getErrorPayload(payload);
      throw new TutorApiError(error.message, { code: error.code, statusCode: response.status, kind: "server" });
    }
    if (!isTutorResponse(payload)) throw new TutorApiError("The tutor response was invalid. Try again.", { code: "invalid_response", statusCode: response.status, kind: "invalid_response" });
    return payload;
  } catch (error) {
    if (timedOut) throw timeoutError();
    if (signal?.aborted) throw new TutorApiError("Tutor request cancelled.", { code: "cancelled", kind: "cancelled" });
    if (error instanceof TutorApiError) throw error;
    throw new TutorApiError("The tutor is offline. Check that FastAPI is running and try again.", { code: "offline", kind: "offline" });
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export async function getTutorProviderStatus(signal?: AbortSignal): Promise<TutorProviderStatus> {
  try {
    const response = await fetch(`${getTutorApiUrl()}/api/ai/providers/status`, { headers: { Accept: "application/json" }, signal });
    const payload = parseJson(await response.text());
    if (!response.ok || !isRecord(payload) || !isRecord(payload.providers)) throw new Error("status");
    const providers = payload.providers as Record<string, unknown>;
    const valid = (name: TutorProvider): boolean => providers[name] === "configured" || providers[name] === "available" || providers[name] === "unavailable";
    if (!(valid("gemini") && valid("groq") && valid("mock"))) throw new Error("status");
    return {
      providers: {
        gemini: providers.gemini as TutorProviderAvailability,
        groq: providers.groq as TutorProviderAvailability,
        mock: providers.mock as TutorProviderAvailability,
      },
    };
  } catch {
    return { providers: { gemini: "unavailable", groq: "unavailable", mock: "available" } };
  }
}

export function isTutorAdviceResponse(value: unknown): value is TutorAdviceResponse {
  return isTutorResponse(value);
}
