import type { LessonExercise } from "@/types/lesson";
import type { PracticeFocus } from "@/lib/practice/modes";
import type { StoredPracticeResult } from "@/features/practice/results-store";

export const MAX_RECENT_COACHING_RESULTS = 8;
export const COACHING_PLAN_VERSION = 1 as const;

export type CoachingMetric = "overall" | "pitch" | "timing" | "duration";
export type CoachingTrendDirection = "improving" | "steady" | "needs-attention" | "insufficient-data";

export type CoachingTrend = {
  metric: CoachingMetric;
  label: string;
  direction: CoachingTrendDirection;
  first: number | null;
  latest: number | null;
  change: number | null;
  explanation: string;
};

export type CoachingSection = {
  label: string;
  start: number;
  end: number;
  reason: string;
};

export type CoachingGoal = {
  id: string;
  title: string;
  description: string;
  why: string;
  completed: boolean;
};

export type CoachingExercise = {
  id: string;
  title: string;
  instructions: string;
  why: string;
};

export type CoachingPlan = {
  version: typeof COACHING_PLAN_VERSION;
  planId: string;
  lessonId: string;
  lessonTitle: string;
  generatedAt: number;
  sourceAttemptCount: number;
  sourceLatestCreatedAt: number;
  overview: string;
  trends: CoachingTrend[];
  goals: CoachingGoal[];
  recommendedTempo: number;
  tempoReason: string;
  practiceMode: PracticeFocus;
  practiceModeReason: string;
  focusNotes: string[];
  focusSection: CoachingSection;
  exercises: CoachingExercise[];
  sessionDurationMinutes: number;
  wordingProvider: "local" | "gemini" | "groq" | "mock";
  wordingFallback: boolean;
};

export type CoachingMistakeTotals = {
  wrong_pitch: number;
  early: number;
  late: number;
  missed: number;
  extra: number;
};

export type CoachingSummary = {
  recentResults: StoredPracticeResult[];
  latest: StoredPracticeResult;
  latestScores: Record<CoachingMetric, number | null>;
  mistakeTotals: CoachingMistakeTotals;
  focusNotes: string[];
  recentCount: number;
  latestFocus: PracticeFocus;
  trends: CoachingTrend[];
};

const NOTE_NAME_PATTERN = /^[A-Ga-g](?:#|b)?[0-8]$/;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const PHONE_PATTERN = /(?<!\d)(?:\+?\d[\s().-]?){7,}\d(?!\d)/;
const UNSAFE_TEXT_MARKERS = ["my name is", "my address is", "my phone is", "my email is", "personal data", "private information", "lyrics", "song words", "raw midi", "microphone", "audio recording", "file://", "blob", "api key"];
const METRICS: Array<{ metric: CoachingMetric; label: string }> = [
  { metric: "overall", label: "Overall" },
  { metric: "pitch", label: "Pitch" },
  { metric: "timing", label: "Timing" },
  { metric: "duration", label: "Duration" },
];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function safePlanText(value: string, fallback: string, maxLength = 180): string {
  const cleaned = value.trim().replace(/\s+/g, " ");
  const lowered = cleaned.toLowerCase();
  if (!cleaned || cleaned.length > maxLength || EMAIL_PATTERN.test(cleaned) || PHONE_PATTERN.test(cleaned) || UNSAFE_TEXT_MARKERS.some((marker) => lowered.includes(marker))) return fallback;
  return cleaned;
}

function safeNoteName(value: string): string | null {
  const cleaned = value.trim();
  return NOTE_NAME_PATTERN.test(cleaned) ? cleaned : null;
}

function safeLessonTitle(value: string): string {
  return safePlanText(value, "Current lesson", 120);
}

function scoreFor(result: StoredPracticeResult, metric: CoachingMetric): number | null {
  const value = result[metric];
  return typeof value === "number" && Number.isFinite(value) ? clamp(Math.round(value), 0, 100) : null;
}

function trendFor(recent: StoredPracticeResult[], metric: CoachingMetric, label: string): CoachingTrend {
  const values = [...recent].reverse().map((result) => scoreFor(result, metric)).filter((value): value is number => value !== null);
  const first = values[0] ?? null;
  const latest = values.at(-1) ?? null;
  if (values.length < 2 || first === null || latest === null) {
    return { metric, label, direction: "insufficient-data", first, latest, change: null, explanation: `There is not enough ${label.toLowerCase()} history to show a reliable trend yet.` };
  }
  const change = round(latest - first);
  const direction: CoachingTrendDirection = change >= 4 ? "improving" : change <= -4 ? "needs-attention" : "steady";
  const explanation = direction === "improving"
    ? `${label} is up ${Math.abs(change)} points across the recent attempts, so the plan keeps this progress moving.`
    : direction === "needs-attention"
      ? `${label} is down ${Math.abs(change)} points across the recent attempts, so the plan gives it extra attention.`
      : `${label} is holding steady across the recent attempts, so the plan uses it as a stable base.`;
  return { metric, label, direction, first, latest, change, explanation };
}

function aggregateMistakes(recent: StoredPracticeResult[]): CoachingMistakeTotals {
  return recent.reduce<CoachingMistakeTotals>(
    (totals, result) => ({
      wrong_pitch: totals.wrong_pitch + clamp(result.counts.wrong, 0, 10000),
      early: totals.early + clamp(result.counts.early, 0, 10000),
      late: totals.late + clamp(result.counts.late, 0, 10000),
      missed: totals.missed + clamp(result.counts.missed, 0, 10000),
      extra: totals.extra + clamp(result.counts.extra, 0, 10000),
    }),
    { wrong_pitch: 0, early: 0, late: 0, missed: 0, extra: 0 },
  );
}

function aggregateDifficultNotes(recent: StoredPracticeResult[]): string[] {
  const counts = new Map<string, number>();
  for (const result of recent) {
    for (const problem of result.problems) {
      const name = safeNoteName(problem.name);
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([leftName, leftCount], [rightName, rightCount]) => rightCount - leftCount || leftName.localeCompare(rightName))
    .slice(0, 4)
    .map(([name]) => name);
}

function createTrends(recent: StoredPracticeResult[]): CoachingTrend[] {
  return METRICS.map(({ metric, label }) => trendFor(recent, metric, label));
}

export function selectRecentCoachingResults(results: StoredPracticeResult[], lessonId: string): StoredPracticeResult[] {
  return results
    .filter((result) => result.lessonId === lessonId)
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_RECENT_COACHING_RESULTS);
}

export function summarizeCoachingResults(recentResults: StoredPracticeResult[]): CoachingSummary | null {
  if (recentResults.length === 0) return null;
  const recent = recentResults.slice(0, MAX_RECENT_COACHING_RESULTS);
  const latest = recent[0];
  return {
    recentResults: recent,
    latest,
    latestScores: {
      overall: scoreFor(latest, "overall"),
      pitch: scoreFor(latest, "pitch"),
      timing: scoreFor(latest, "timing"),
      duration: scoreFor(latest, "duration"),
    },
    mistakeTotals: aggregateMistakes(recent),
    focusNotes: aggregateDifficultNotes(recent),
    recentCount: recent.length,
    latestFocus: latest.focus,
    trends: createTrends(recent),
  };
}

function firstSafeEventIndex(lesson: LessonExercise, focusNotes: string[]): number {
  if (focusNotes.length > 0) {
    const index = lesson.events.findIndex((event) => {
      const name = safeNoteName(event.name);
      return name !== null && focusNotes.includes(name);
    });
    if (index >= 0) return index;
  }
  return 0;
}

function createFocusSection(lesson: LessonExercise, focusNotes: string[], primaryReason: string): CoachingSection {
  const events = lesson.events.filter((event) => Number.isFinite(event.start) && Number.isFinite(event.duration) && event.start >= 0 && event.duration > 0);
  if (events.length === 0) return { label: "Opening phrase", start: 0, end: Math.max(1, lesson.duration), reason: primaryReason };
  const startIndex = Math.min(firstSafeEventIndex(lesson, focusNotes), events.length - 1);
  const sectionEvents = events.slice(startIndex, startIndex + 8);
  const start = clamp(sectionEvents[0].start, 0, Math.max(0, lesson.duration));
  const rawEnd = Math.max(...sectionEvents.map((event) => event.start + event.duration));
  const end = clamp(Math.max(rawEnd, start + 0.5), start + 0.5, Math.max(start + 0.5, lesson.duration));
  const label = focusNotes.length > 0 ? `${focusNotes.slice(0, 2).join(" + ")} focus phrase` : "Opening phrase";
  return { label, start: round(start), end: round(end), reason: primaryReason };
}

function choosePracticeMode(summary: CoachingSummary): { mode: PracticeFocus; reason: string } {
  const timingMistakes = summary.mistakeTotals.early + summary.mistakeTotals.late;
  const pitchMistakes = summary.mistakeTotals.wrong_pitch;
  if (timingMistakes > pitchMistakes && timingMistakes > 0) return { mode: "rhythm", reason: `Rhythm mode is selected because recent attempts contain ${timingMistakes} early or late entrances.` };
  if (pitchMistakes > timingMistakes && pitchMistakes > 0) return { mode: "melody", reason: `Melody mode is selected because recent attempts contain ${pitchMistakes} wrong-pitch mistakes.` };
  return { mode: summary.latestFocus, reason: `The plan keeps ${summary.latestFocus} mode because it matches the most recent practice focus while the next priority is balanced.` };
}

function chooseTempo(lesson: LessonExercise, summary: CoachingSummary): { tempo: number; reason: string } {
  const base = lesson.bpm > 0 && Number.isFinite(lesson.bpm) ? lesson.bpm : 60;
  const timing = summary.latestScores.timing;
  const timingMistakes = summary.mistakeTotals.early + summary.mistakeTotals.late;
  const factor = timing !== null && timing < 70 || timingMistakes >= 3 ? 0.75 : timing !== null && timing < 82 || timingMistakes > 0 ? 0.85 : 1;
  const tempo = Math.max(40, Math.round((base * factor) / 5) * 5);
  const reason = factor < 1
    ? `The tempo is reduced from the lesson's ${Math.round(base)} BPM so repeated timing issues can settle before speed returns.`
    : `The lesson tempo is retained because recent timing is stable enough to support a confident repetition.`;
  return { tempo, reason };
}

function choosePrimaryPriority(summary: CoachingSummary): { key: "timing" | "pitch" | "duration"; label: string; reason: string } {
  const timingMistakes = summary.mistakeTotals.early + summary.mistakeTotals.late;
  const candidates = [
    { key: "timing" as const, score: summary.latestScores.timing ?? 100, label: "timing consistency", reason: `${timingMistakes} early or late entrances accumulated across the recent attempts.` },
    { key: "pitch" as const, score: summary.latestScores.pitch ?? 100, label: "pitch accuracy", reason: `${summary.mistakeTotals.wrong_pitch} wrong-pitch mistakes accumulated across the recent attempts.` },
    { key: "duration" as const, score: summary.latestScores.duration ?? 100, label: "note length", reason: "The latest duration score is the clearest available signal for shaping note releases." },
  ];
  return candidates.sort((left, right) => left.score - right.score || (right.key === "timing" ? 1 : 0))[0];
}

function createGoals(summary: CoachingSummary, priority: ReturnType<typeof choosePrimaryPriority>, tempo: number, focusNotes: string[]): CoachingGoal[] {
  const goals: CoachingGoal[] = [
    {
      id: `improve-${priority.key}`,
      title: `Improve ${priority.label}`,
      description: `Complete three focused repetitions at ${tempo} BPM and keep the selected ${priority.label} target in mind.`,
      why: priority.reason,
      completed: false,
    },
  ];
  if (focusNotes.length > 0) {
    goals.push({
      id: "stabilize-focus-notes",
      title: `Stabilize ${focusNotes.slice(0, 2).join(" and ")}`,
      description: "Play the focus notes cleanly inside the recommended phrase before joining the whole section.",
      why: `These notes appeared most often in the recent difficult-note summaries: ${focusNotes.join(", ")}.`,
      completed: false,
    });
  } else {
    goals.push({
      id: "build-consistency",
      title: "Build three consistent repeats",
      description: "Finish three uninterrupted repetitions without increasing speed early.",
      why: "No repeated difficult note was recorded, so consistency is the safest next target.",
      completed: false,
    });
  }
  const overallTrend = summary.trends.find((trend) => trend.metric === "overall");
  goals.push({
    id: "review-progress",
    title: overallTrend?.direction === "improving" ? "Keep the upward trend" : "Make the next attempt more consistent",
    description: "Compare the next result with this plan and keep the practice change that helps most.",
    why: overallTrend?.explanation ?? "A progress comparison needs more than one recent attempt.",
    completed: false,
  });
  return goals;
}

function createExercises(priority: ReturnType<typeof choosePrimaryPriority>, focusNotes: string[], tempo: number): CoachingExercise[] {
  const notes = focusNotes.length > 0 ? focusNotes.join(", ") : "the opening phrase";
  if (priority.key === "timing") {
    return [
      { id: "tap-pulse", title: "Tap before playing", instructions: `Tap a steady pulse for one round, then play ${notes} at ${tempo} BPM.`, why: "A silent pulse exposes uneven entrances before the notes are added." },
      { id: "slow-groups", title: "Loop small groups", instructions: `Repeat ${notes} in groups of three and pause between groups.`, why: "Short loops keep timing corrections small and repeatable." },
      { id: "join-phrase", title: "Join the phrase", instructions: `Play the full focus section three times without speeding up after ${notes}.`, why: "The final step transfers the steady pulse into the musical section." },
    ];
  }
  if (priority.key === "pitch") {
    return [
      { id: "name-play", title: "Name then play", instructions: `Say ${notes} quietly before playing them at ${tempo} BPM.`, why: "Naming the target notes gives the ear a clear pitch destination." },
      { id: "isolate-pitches", title: "Isolate the targets", instructions: `Play ${notes} slowly, leaving one beat between each note.`, why: "Space makes each pitch easier to hear and correct." },
      { id: "connect-pitches", title: "Connect the phrase", instructions: "Join the isolated notes into the full focus section for three repeats.", why: "Connecting the notes checks that accuracy survives musical flow." },
    ];
  }
  return [
    { id: "hold-release", title: "Hold and release", instructions: `Practice ${notes} slowly and release each note deliberately at ${tempo} BPM.`, why: "Controlled releases make note-length changes easier to hear." },
    { id: "short-section", title: "Repeat a short section", instructions: "Loop the focus section four times while keeping each note length consistent.", why: "Repeated short sections build reliable physical timing." },
    { id: "full-run", title: "Test the full phrase", instructions: "Play the whole section once after the focused repetitions and compare the feel.", why: "A final run checks whether the improvement transfers beyond the drill." },
  ];
}

export function buildCoachingPlan(lesson: LessonExercise, recentResults: StoredPracticeResult[], now = Date.now()): CoachingPlan | null {
  const summary = summarizeCoachingResults(recentResults);
  if (!summary) return null;
  const priority = choosePrimaryPriority(summary);
  const focusNotes = summary.focusNotes;
  const { tempo, reason: tempoReason } = chooseTempo(lesson, summary);
  const { mode, reason: practiceModeReason } = choosePracticeMode(summary);
  const focusReason = focusNotes.length > 0
    ? `The section starts at the first occurrence of ${focusNotes[0]} so the repeated difficult notes are isolated before the full lesson.`
    : "The section starts at the opening phrase because no repeated difficult note was available to target.";
  const focusSection = createFocusSection(lesson, focusNotes, focusReason);
  const focusLabel = focusNotes.length > 0 ? focusNotes.join(", ") : "the opening phrase";
  const overview = `Your recent ${summary.recentCount} attempt${summary.recentCount === 1 ? "" : "s"} on ${safeLessonTitle(lesson.title)} point to ${priority.label} as the next opportunity. Start with ${focusLabel} at ${tempo} BPM for a ${mode} session.`;
  return {
    version: COACHING_PLAN_VERSION,
    planId: `coaching-${lesson.id}-${summary.latest.createdAt}`,
    lessonId: lesson.id,
    lessonTitle: safeLessonTitle(lesson.title),
    generatedAt: now,
    sourceAttemptCount: summary.recentCount,
    sourceLatestCreatedAt: summary.latest.createdAt,
    overview,
    trends: summary.trends,
    goals: createGoals(summary, priority, tempo, focusNotes),
    recommendedTempo: tempo,
    tempoReason,
    practiceMode: mode,
    practiceModeReason,
    focusNotes,
    focusSection,
    exercises: createExercises(priority, focusNotes, tempo),
    sessionDurationMinutes: focusNotes.length > 1 || summary.recentCount >= 4 ? 20 : 15,
    wordingProvider: "local",
    wordingFallback: false,
  };
}

export function preserveGoalCompletion(plan: CoachingPlan, previous: CoachingPlan | null): CoachingPlan {
  if (!previous || previous.lessonId !== plan.lessonId) return plan;
  const completed = new Set(previous.goals.filter((goal) => goal.completed).map((goal) => goal.id));
  return { ...plan, goals: plan.goals.map((goal) => ({ ...goal, completed: completed.has(goal.id) })) };
}

export function applyCoachingWording(plan: CoachingPlan, wording: { summary: string; exercises: Array<{ instructions: string }>; provider: "gemini" | "groq" | "mock"; usedFallback: boolean }): CoachingPlan {
  const factLine = `${plan.recommendedTempo} BPM, ${plan.practiceMode} mode, ${plan.focusSection.start}-${plan.focusSection.end} seconds, ${plan.sessionDurationMinutes} minutes.`;
  return {
    ...plan,
    overview: safePlanText(`${wording.summary} ${factLine}`, plan.overview, 500),
    exercises: plan.exercises.map((exercise, index) => ({
      ...exercise,
      instructions: safePlanText(wording.exercises[index]?.instructions ?? exercise.instructions, exercise.instructions, 260),
    })),
    wordingProvider: wording.provider,
    wordingFallback: wording.usedFallback || wording.provider === "mock",
  };
}
