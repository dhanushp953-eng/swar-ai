// Pure, framework-independent MIDI practice scoring engine.
// Compares expected lesson note events against performed MIDI notes with
// deterministic one-to-one matching, configurable windows/weights, and
// structured human-readable reasons. No DOM, no audio, no React.

export type ScoreNoteEvent = {
  id: string;
  midi: number;
  name: string;
  start: number;
  duration: number;
  hand?: string | null;
  velocity?: number;
};

export type PerformedNote = {
  id: string;
  midi: number;
  name: string;
  /** lesson-time onset (seconds), latency-compensated by the caller */
  onset: number;
  /** lesson-time offset (seconds) */
  offset: number;
  velocity?: number;
  channel?: number;
};

export type PracticePresetId = "beginner" | "standard" | "strict";

export type PracticeConfig = {
  /** early/late tolerance windows (seconds) around each expected onset */
  windows: { early: number; late: number };
  /** |onset - start| below this counts as on-time rather than early/late */
  correctOnsetTolerance: number;
  /** extra allowance when judging held duration */
  durationTolerance: number;
  weights: { pitch: number; timing: number; duration: number };
  penalties: { missed: number; extra: number };
  /** Rhythm-only practice: any pitch inside the window satisfies the event. */
  ignorePitch?: boolean;
};

export const PRACTICE_PRESETS: Record<PracticePresetId, PracticeConfig> = {
  beginner: {
    windows: { early: 0.35, late: 0.35 },
    correctOnsetTolerance: 0.06,
    durationTolerance: 0.4,
    weights: { pitch: 0.5, timing: 0.3, duration: 0.2 },
    penalties: { missed: 0.5, extra: 0.25 },
  },
  standard: {
    windows: { early: 0.25, late: 0.25 },
    correctOnsetTolerance: 0.05,
    durationTolerance: 0.3,
    weights: { pitch: 0.5, timing: 0.3, duration: 0.2 },
    penalties: { missed: 0.55, extra: 0.3 },
  },
  strict: {
    windows: { early: 0.12, late: 0.12 },
    correctOnsetTolerance: 0.04,
    durationTolerance: 0.2,
    weights: { pitch: 0.5, timing: 0.3, duration: 0.2 },
    penalties: { missed: 0.6, extra: 0.35 },
  },
};

export const PRACTICE_PRESET_META: Record<PracticePresetId, { label: string; description: string }> = {
  beginner: { label: "Beginner", description: "Forgiving timing (±0.35s)" },
  standard: { label: "Standard", description: "Balanced timing (±0.25s)" },
  strict: { label: "Strict", description: "Tight timing (±0.12s)" },
};

export const PRACTICE_PRESET_ORDER: PracticePresetId[] = ["beginner", "standard", "strict"];

export type PerformedClassification = "correct" | "early" | "late" | "wrong" | "extra";

export type ExpectedClassification = "matched" | "missed" | "pending";

export type PerformedNoteResult = {
  performedId: string;
  noteName: string;
  midi: number;
  onset: number;
  offset: number;
  classification: PerformedClassification;
  matchedEventId: string | null;
  matchedEventName: string | null;
  /** onset - expected.start in seconds; positive = late, null for extra */
  timingDeviation: number | null;
  /** offset - expected.end in seconds; positive = held too long, null for extra */
  durationDeviation: number | null;
  reason: string;
};

export type ExpectedNoteResult = {
  eventId: string;
  noteName: string;
  midi: number;
  start: number;
  duration: number;
  classification: ExpectedClassification;
  matchedPerformedId: string | null;
  reason: string;
};

export type ScoredValue = { value: number; reasons: string[] };

export type ScoreCounts = {
  expected: number;
  performed: number;
  correct: number;
  early: number;
  late: number;
  wrong: number;
  extra: number;
  matched: number;
  missed: number;
  pending: number;
};

export type ScoreResult = {
  counts: ScoreCounts;
  scores: {
    pitch: ScoredValue;
    timing: ScoredValue;
    duration: ScoredValue;
    correctNotes: ScoredValue;
    overall: ScoredValue;
  };
  performedNotes: PerformedNoteResult[];
  expectedNotes: ExpectedNoteResult[];
};

export function clampScore(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function formatSec(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

/** Timing classification of a performed onset relative to an expected start. */
export function classifyOnset(
  onset: number,
  start: number,
  config: PracticeConfig,
): { timing: "correct" | "early" | "late"; deviation: number } {
  const deviation = onset - start;
  if (Math.abs(deviation) <= config.correctOnsetTolerance) {
    return { timing: "correct", deviation };
  }
  return { timing: deviation < 0 ? "early" : "late", deviation };
}

/** Whether a performed onset falls inside the early/late window of a start. */
export function withinWindow(onset: number, start: number, config: PracticeConfig): boolean {
  return onset >= start - config.windows.early && onset <= start + config.windows.late;
}

type PendingEvent = {
  event: ScoreNoteEvent;
  matched: boolean;
  /** true only when matched by a performed note with the correct pitch */
  satisfiedCorrectly: boolean;
  matchedPerformedId: string | null;
};

function pickNearest(candidates: PendingEvent[], onset: number): PendingEvent {
  let nearest = candidates[0];
  for (const candidate of candidates) {
    if (Math.abs(onset - candidate.event.start) < Math.abs(onset - nearest.event.start)) nearest = candidate;
  }
  return nearest;
}

function decisionReason(
  classification: "correct" | "early" | "late" | "wrong",
  performed: PerformedNote,
  event: ScoreNoteEvent,
  deviation: number,
): string {
  if (classification === "correct") {
    return `Matched ${event.name} at ${formatSec(event.start)} (onset ${formatSec(performed.onset)} is within tolerance)`;
  }
  if (classification === "early") {
    return `Correct pitch but early: played ${event.name} ${formatSec(Math.abs(deviation))} before the expected ${formatSec(event.start)}`;
  }
  if (classification === "late") {
    return `Correct pitch but late: played ${event.name} ${formatSec(deviation)} after the expected ${formatSec(event.start)}`;
  }
  return `Wrong pitch: played ${performed.name} instead of the expected ${event.name} at ${formatSec(event.start)}`;
}

function performedResultFor(
  note: PerformedNote,
  classification: PerformedClassification,
  matched: PendingEvent | null,
  config: PracticeConfig,
): PerformedNoteResult {
  if (!matched) {
    return {
      performedId: note.id,
      noteName: note.name,
      midi: note.midi,
      onset: note.onset,
      offset: note.offset,
      classification: "extra",
      matchedEventId: null,
      matchedEventName: null,
      timingDeviation: null,
      durationDeviation: null,
      reason: `Extra note: played ${note.name} at ${formatSec(note.onset)} with no expected note in range`,
    };
  }
  const deviation = note.onset - matched.event.start;
  const isCorrectPitch = config.ignorePitch === true || matched.event.midi === note.midi;
  const classificationSafe: "correct" | "early" | "late" | "wrong" = isCorrectPitch
    ? classifyOnset(note.onset, matched.event.start, config).timing
    : "wrong";
  return {
    performedId: note.id,
    noteName: note.name,
    midi: note.midi,
    onset: note.onset,
    offset: note.offset,
    classification: classificationSafe,
    matchedEventId: matched.event.id,
    matchedEventName: matched.event.name,
    timingDeviation: deviation,
    durationDeviation: note.offset - (matched.event.start + matched.event.duration),
    reason: decisionReason(classificationSafe, note, matched.event, deviation),
  };
}

/**
 * One-pass, one-to-one matcher. Each performed note can satisfy at most one
 * expected event and vice versa. Performed notes are consumed in onset order;
 * each matches the nearest same-pitch pending event inside the window, else the
 * nearest any-pitch pending event (counted as a wrong pitch and consuming the
 * event), else it is extra. Events whose window has passed are missed; events
 * still reachable at `endTime` stay pending so live feedback does not over-count.
 */
export function matchNotes(
  events: ScoreNoteEvent[],
  performed: PerformedNote[],
  config: PracticeConfig,
  opts: { endTime?: number } = {},
): { performedNotes: PerformedNoteResult[]; expectedNotes: ExpectedNoteResult[] } {
  const endTime = opts.endTime ?? Math.max(0, ...events.map((e) => e.start + e.duration));
  const performedSorted = [...performed].sort((a, b) => a.onset - b.onset);

  const pending: PendingEvent[] = events.map((event) => ({
    event,
    matched: false,
    satisfiedCorrectly: false,
    matchedPerformedId: null,
  }));
  const performedResults: PerformedNoteResult[] = [];

  for (const note of performedSorted) {
    const samePitch = pending.filter(
      (p) =>
        !p.matched &&
        (config.ignorePitch === true || p.event.midi === note.midi) &&
        withinWindow(note.onset, p.event.start, config),
    );
    if (samePitch.length > 0) {
      const matched = pickNearest(samePitch, note.onset);
      performedResults.push(performedResultFor(note, "correct", matched, config));
      matched.matched = true;
      matched.satisfiedCorrectly = true;
      matched.matchedPerformedId = note.id;
      continue;
    }

    const anyPitch = pending.filter(
      (p) => !p.matched && withinWindow(note.onset, p.event.start, config),
    );
    if (anyPitch.length > 0) {
      const matched = pickNearest(anyPitch, note.onset);
      performedResults.push(performedResultFor(note, "wrong", matched, config));
      matched.matched = true;
      matched.satisfiedCorrectly = false;
      matched.matchedPerformedId = note.id;
      continue;
    }

    performedResults.push(performedResultFor(note, "extra", null, config));
  }

  const expectedNotes: ExpectedNoteResult[] = pending.map((p) => {
    const windowOpen = p.event.start + config.windows.late >= endTime;
    if (p.matched && p.satisfiedCorrectly) {
      return {
        eventId: p.event.id,
        noteName: p.event.name,
        midi: p.event.midi,
        start: p.event.start,
        duration: p.event.duration,
        classification: "matched",
        matchedPerformedId: p.matchedPerformedId,
        reason: `Matched by performed note ${p.matchedPerformedId}`,
      };
    }
    if (p.matched) {
      return {
        eventId: p.event.id,
        noteName: p.event.name,
        midi: p.event.midi,
        start: p.event.start,
        duration: p.event.duration,
        classification: "missed",
        matchedPerformedId: p.matchedPerformedId,
        reason: `Missed: performed note ${p.matchedPerformedId} had the wrong pitch for ${p.event.name} at ${formatSec(p.event.start)}`,
      };
    }
    if (windowOpen) {
      return {
        eventId: p.event.id,
        noteName: p.event.name,
        midi: p.event.midi,
        start: p.event.start,
        duration: p.event.duration,
        classification: "pending",
        matchedPerformedId: null,
        reason: `Not playable yet: the window for ${p.event.name} at ${formatSec(p.event.start)} is still open`,
      };
    }
    return {
      eventId: p.event.id,
      noteName: p.event.name,
      midi: p.event.midi,
      start: p.event.start,
      duration: p.event.duration,
      classification: "missed",
      matchedPerformedId: null,
      reason: `Missed: no performed note with the correct pitch in ${formatSec(p.event.start)} ± ${formatSec(Math.max(config.windows.early, config.windows.late))}`,
    };
  });

  return { performedNotes: performedResults, expectedNotes };
}

/**
 * Build final counts and scores from resolved outcome lists. All scores clamp
 * to 0..100 and every score carries structured reasons.
 */
export function computeScores(
  performedNotes: PerformedNoteResult[],
  expectedNotes: ExpectedNoteResult[],
  config: PracticeConfig,
): ScoreResult {
  const counts: ScoreCounts = {
    expected: expectedNotes.length,
    performed: performedNotes.length,
    correct: 0,
    early: 0,
    late: 0,
    wrong: 0,
    extra: 0,
    matched: 0,
    missed: 0,
    pending: 0,
  };

  for (const p of performedNotes) {
    counts[p.classification] += 1;
  }
  for (const e of expectedNotes) {
    if (e.classification === "matched") counts.matched += 1;
    else if (e.classification === "missed") counts.missed += 1;
    else counts.pending += 1;
  }

  const matchedAttempts = counts.correct + counts.early + counts.late + counts.wrong;
  const correctPitchAttempts = counts.correct + counts.early + counts.late;

  const pitchValue = matchedAttempts > 0 ? (correctPitchAttempts / matchedAttempts) * 100 : 0;
  const pitchReasons: string[] = [];
  if (performedNotes.length === 0) {
    pitchReasons.push("No notes were played.");
  } else {
    pitchReasons.push(
      `${correctPitchAttempts} of ${matchedAttempts} matched attempt${matchedAttempts === 1 ? "" : "s"} hit the correct pitch (${counts.wrong} wrong); ${counts.extra} extra note${counts.extra === 1 ? "" : "s"} excluded from pitch accuracy.`,
    );
  }

  const expectedDurationByEvent = new Map(expectedNotes.map((e) => [e.eventId, e.duration]));
  const correctlyPitched = performedNotes.filter(
    (p) => p.classification === "correct" || p.classification === "early" || p.classification === "late",
  );

  let timingValue = 0;
  const timingReasons: string[] = [];
  if (correctlyPitched.length === 0) {
    timingReasons.push("No correctly-pitched notes to evaluate timing on.");
  } else {
    let total = 0;
    for (const p of correctlyPitched) {
      const deviation = Math.abs(p.timingDeviation ?? 0);
      const window = (p.timingDeviation ?? 0) < 0 ? config.windows.early : config.windows.late;
      total += 1 - Math.min(1, deviation / Math.max(window, 1e-9));
    }
    timingValue = (total / correctlyPitched.length) * 100;
    timingReasons.push(
      `Average timing score of ${correctlyPitched.length} correctly-pitched note${correctlyPitched.length === 1 ? "" : "s"}; perfect = 100, falling linearly to 0 at the edge of the ±${config.windows.early.toFixed(2)}s window.`,
    );
  }

  let durationValue = 0;
  const durationReasons: string[] = [];
  if (correctlyPitched.length === 0) {
    durationReasons.push("No correctly-pitched notes to evaluate duration on.");
  } else {
    let total = 0;
    for (const p of correctlyPitched) {
      const expectedDuration = Math.max(expectedDurationByEvent.get(p.matchedEventId ?? "") ?? 0, 0.1);
      const deviation = Math.abs(p.durationDeviation ?? 0);
      total += 1 - Math.min(1, deviation / (expectedDuration + config.durationTolerance));
    }
    durationValue = (total / correctlyPitched.length) * 100;
    durationReasons.push(
      `Average held-duration score of ${correctlyPitched.length} note${correctlyPitched.length === 1 ? "" : "s"}; deviation beyond the expected length + ${config.durationTolerance.toFixed(2)}s tolerance scores 0.`,
    );
  }

  const correctNoteValue = counts.expected > 0 ? (correctPitchAttempts / counts.expected) * 100 : 0;
  const correctNoteReasons = [
    `${correctPitchAttempts} of ${counts.expected} expected note${counts.expected === 1 ? "" : "s"} were played with the correct pitch inside the timing window.`,
  ];

  const missedRatio = counts.expected > 0 ? counts.missed / counts.expected : 0;
  const extraRatio = counts.performed > 0 ? counts.extra / counts.performed : 0;
  const weighted =
    pitchValue * config.weights.pitch +
    timingValue * config.weights.timing +
    durationValue * config.weights.duration;
  const penalty =
    missedRatio * config.penalties.missed * 100 +
    extraRatio * config.penalties.extra * 100;
  const rawOverall = weighted - penalty;
  const overallValue = clampScore(rawOverall);
  const overallReasons = [
    `Weighted: pitch × ${config.weights.pitch} + timing × ${config.weights.timing} + duration × ${config.weights.duration}`,
    `Penalties: ${counts.missed} missed (× ${config.penalties.missed}) + ${counts.extra} extra (× ${config.penalties.extra})`,
    rawOverall < 0 ? "Score clamped to 0." : rawOverall > 100 ? "Score clamped to 100." : "No clamping applied.",
  ];

  return {
    counts,
    scores: {
      pitch: { value: clampScore(pitchValue), reasons: pitchReasons },
      timing: { value: clampScore(timingValue), reasons: timingReasons },
      duration: { value: clampScore(durationValue), reasons: durationReasons },
      correctNotes: { value: clampScore(correctNoteValue), reasons: correctNoteReasons },
      overall: { value: overallValue, reasons: overallReasons },
    },
    performedNotes,
    expectedNotes,
  };
}

/** One-shot evaluation of a complete performance (used by tests and simple callers). */
export function scorePerformance(
  events: ScoreNoteEvent[],
  performed: PerformedNote[],
  config: PracticeConfig,
  opts: { endTime?: number } = {},
): ScoreResult {
  const { performedNotes, expectedNotes } = matchNotes(events, performed, config, opts);
  return computeScores(performedNotes, expectedNotes, config);
}
