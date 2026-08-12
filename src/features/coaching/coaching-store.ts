import {
  COACHING_PLAN_VERSION,
  type CoachingPlan,
} from "./coaching-plan";
import type { StorageLike } from "@/features/practice/results-store";

export const COACHING_STORAGE_KEY = "piano.practice.coaching.v1";
const MAX_STORED_PLANS = 20;
const NOTE_NAME_PATTERN = /^[A-Ga-g](?:#|b)?[0-8]$/;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const PHONE_PATTERN = /(?<!\d)(?:\+?\d[\s().-]?){7,}\d(?!\d)/;
const UNSAFE_TEXT_MARKERS = ["raw midi", "microphone", "audio recording", "file://", "blob", "lyrics", "song words", "api key", "personal data", "private information", "my name is", "my email is"];

type CoachingStoragePayload = {
  version: typeof COACHING_PLAN_VERSION;
  plans: CoachingPlan[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeText(value: unknown, maxLength: number): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return false;
  const lowered = value.toLowerCase();
  return !EMAIL_PATTERN.test(value) && !PHONE_PATTERN.test(value) && !UNSAFE_TEXT_MARKERS.some((marker) => lowered.includes(marker));
}

function isPlan(value: unknown): value is CoachingPlan {
  if (typeof value !== "object" || value === null) return false;
  const plan = value as Record<string, unknown>;
  if (plan.version !== COACHING_PLAN_VERSION || !isSafeText(plan.planId, 180) || !isSafeText(plan.lessonId, 120) || !isSafeText(plan.lessonTitle, 120) || !isSafeText(plan.overview, 500)) return false;
  if (!isFiniteNumber(plan.generatedAt) || !isFiniteNumber(plan.sourceLatestCreatedAt) || !isFiniteNumber(plan.sourceAttemptCount) || plan.sourceAttemptCount < 1 || plan.sourceAttemptCount > 8) return false;
  if (!isFiniteNumber(plan.recommendedTempo) || plan.recommendedTempo < 20 || plan.recommendedTempo > 240 || !isFiniteNumber(plan.sessionDurationMinutes) || plan.sessionDurationMinutes < 1 || plan.sessionDurationMinutes > 60) return false;
  if (plan.practiceMode !== "full" && plan.practiceMode !== "melody" && plan.practiceMode !== "rhythm") return false;
  if (plan.wordingProvider !== "local" && plan.wordingProvider !== "gemini" && plan.wordingProvider !== "groq" && plan.wordingProvider !== "mock") return false;
  if (typeof plan.wordingFallback !== "boolean" || !isSafeText(plan.tempoReason, 300) || !isSafeText(plan.practiceModeReason, 300) || !Array.isArray(plan.trends) || !Array.isArray(plan.goals) || plan.goals.length < 1 || plan.goals.length > 4 || !Array.isArray(plan.exercises) || plan.exercises.length < 2 || plan.exercises.length > 4 || !Array.isArray(plan.focusNotes) || plan.focusNotes.length > 4 || !plan.focusNotes.every((note) => typeof note === "string" && NOTE_NAME_PATTERN.test(note)) || typeof plan.focusSection !== "object" || plan.focusSection === null) return false;
  if (!plan.trends.every((trend) => {
    if (typeof trend !== "object" || trend === null) return false;
    const item = trend as Record<string, unknown>;
    return (item.metric === "overall" || item.metric === "pitch" || item.metric === "timing" || item.metric === "duration") && isSafeText(item.label, 40) && (item.direction === "improving" || item.direction === "steady" || item.direction === "needs-attention" || item.direction === "insufficient-data") && (item.first === null || (isFiniteNumber(item.first) && item.first >= 0 && item.first <= 100)) && (item.latest === null || (isFiniteNumber(item.latest) && item.latest >= 0 && item.latest <= 100)) && (item.change === null || isFiniteNumber(item.change)) && isSafeText(item.explanation, 240);
  })) return false;
  if (!plan.goals.every((goal) => typeof goal === "object" && goal !== null && isSafeText((goal as Record<string, unknown>).id, 80) && isSafeText((goal as Record<string, unknown>).title, 120) && isSafeText((goal as Record<string, unknown>).description, 260) && isSafeText((goal as Record<string, unknown>).why, 260) && typeof (goal as Record<string, unknown>).completed === "boolean")) return false;
  if (!plan.exercises.every((exercise) => typeof exercise === "object" && exercise !== null && isSafeText((exercise as Record<string, unknown>).id, 80) && isSafeText((exercise as Record<string, unknown>).title, 100) && isSafeText((exercise as Record<string, unknown>).instructions, 300) && isSafeText((exercise as Record<string, unknown>).why, 260))) return false;
  const section = plan.focusSection as Record<string, unknown>;
  if (!isFiniteNumber(section.start) || !isFiniteNumber(section.end) || section.start < 0 || section.end <= section.start || !isSafeText(section.label, 100) || !isSafeText(section.reason, 300)) return false;
  return true;
}

function parsePayload(value: unknown): CoachingPlan[] {
  if (typeof value !== "object" || value === null) return [];
  const payload = value as Partial<CoachingStoragePayload>;
  if (payload.version !== COACHING_PLAN_VERSION || !Array.isArray(payload.plans)) return [];
  return payload.plans.filter(isPlan).slice(0, MAX_STORED_PLANS);
}

export function readCoachingPlans(storage: StorageLike | null): CoachingPlan[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(COACHING_STORAGE_KEY);
    return raw ? parsePayload(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function readCoachingPlan(storage: StorageLike | null, lessonId: string): CoachingPlan | null {
  return readCoachingPlans(storage).find((plan) => plan.lessonId === lessonId) ?? null;
}

export function writeCoachingPlans(storage: StorageLike | null, plans: CoachingPlan[]): boolean {
  if (!storage) return false;
  try {
    storage.setItem(COACHING_STORAGE_KEY, JSON.stringify({ version: COACHING_PLAN_VERSION, plans: plans.slice(0, MAX_STORED_PLANS) } satisfies CoachingStoragePayload));
    return true;
  } catch {
    return false;
  }
}

export function saveCoachingPlan(storage: StorageLike | null, plan: CoachingPlan): CoachingPlan[] {
  const next = [plan, ...readCoachingPlans(storage).filter((existing) => existing.lessonId !== plan.lessonId)].slice(0, MAX_STORED_PLANS);
  writeCoachingPlans(storage, next);
  return next;
}

export function updateCoachingGoal(storage: StorageLike | null, lessonId: string, goalId: string, completed: boolean): CoachingPlan | null {
  const plan = readCoachingPlan(storage, lessonId);
  if (!plan) return null;
  const next = { ...plan, goals: plan.goals.map((goal) => goal.id === goalId ? { ...goal, completed } : goal) };
  saveCoachingPlan(storage, next);
  return next;
}

export function getBrowserStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}
