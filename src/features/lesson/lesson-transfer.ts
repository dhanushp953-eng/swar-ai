import type { LessonExercise, LessonHand, NoteEvent } from "../../types/lesson";
import { CORRECTION_MIDI_MAX, CORRECTION_MIDI_MIN, CORRECTION_VELOCITY_MAX, CORRECTION_VELOCITY_MIN } from "../correction/correction-engine";
import { midiToNote } from "../../utils/music";

export const LESSON_TRANSFER_SCHEMA = "swarai-lesson";
export const LESSON_TRANSFER_VERSION = 1;

export const MAX_LESSON_JSON_BYTES = 1024 * 1024;
export const MAX_LESSON_JSON_DEPTH = 32;
export const MAX_IMPORTED_EVENTS = 4000;
export const MAX_LESSON_ID_LENGTH = 128;
export const MAX_NOTE_ID_LENGTH = 128;
export const MAX_LESSON_TITLE_LENGTH = 200;
export const MAX_LESSON_DESCRIPTION_LENGTH = 1000;
export const MIN_LESSON_BPM = 20;
export const MAX_LESSON_BPM = 300;
export const MAX_LESSON_DURATION = 3_600;
export const MAX_NOTE_TIME = 86_400;

/**
 * A note as it can appear in an exported lesson. Mirrors NoteEvent but may
 * optionally carry the detection confidence that the correction engine keeps
 * on its events. Everything else (audio, object URLs, paths, secrets, undo
 * history) is deliberately not part of the transfer format.
 */
export type LessonExportNote = NoteEvent & {
  confidence?: number | null;
};

export type LessonExportInput = {
  id: string;
  title: string;
  description: string;
  bpm: number;
  beatsPerMeasure: number;
  duration: number;
  events: readonly LessonExportNote[];
};

export type LessonTransferDocument = {
  schema: typeof LESSON_TRANSFER_SCHEMA;
  version: typeof LESSON_TRANSFER_VERSION;
  exportedAt: string;
  lesson: {
    id: string;
    title: string;
    description: string;
    bpm: number;
    beatsPerMeasure: number;
    duration: number;
    events: LessonExportNote[];
  };
};

export type LessonImportResult =
  | { lesson: LessonExercise; error: null }
  | { lesson: null; error: string };

export class LessonTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LessonTransferError";
  }
}

type UnknownRecord = Record<string, unknown>;

const DOC_ALLOWED_KEYS = new Set(["schema", "version", "exportedAt", "lesson"]);
const LESSON_ALLOWED_KEYS = new Set(["id", "title", "description", "bpm", "beatsPerMeasure", "duration", "events"]);
const EVENT_ALLOWED_KEYS = new Set(["id", "midi", "name", "start", "duration", "velocity", "hand", "finger", "confidence"]);
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._-]+$/;
const ALLOWED_FINGERS = new Set([1, 2, 3, 4, 5]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${bytes / (1024 * 1024)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Scans the raw JSON text for nesting depth without parsing it, so deeply
 * nested ("billion laughs" style) payloads are rejected before JSON.parse is
 * ever asked to handle them.
 */
function scanJsonDepth(text: string): number {
  let depth = 0;
  let maxDepth = 0;
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth += 1;
      if (depth > maxDepth) maxDepth = depth;
    } else if (char === "}" || char === "]") {
      depth -= 1;
    }
  }
  return maxDepth;
}

/**
 * Rejects payloads carrying property names that could be abused for prototype
 * pollution if they were ever spread or assigned onto objects.
 */
function containsDangerousKeys(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (isRecord(current)) {
      for (const key of Object.keys(current)) {
        if (DANGEROUS_KEYS.has(key)) return true;
        stack.push(current[key]);
      }
    }
  }
  return false;
}

function validateNoteEvent(event: unknown, index: number, seenIds: Set<string>): string[] {
  const errors: string[] = [];
  const label = `Note ${index + 1}`;
  if (!isRecord(event)) return [`${label} must be an object.`];
  const unknownKeys = Object.keys(event).filter((key) => !EVENT_ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) errors.push(`${label} contains unrecognized fields: ${unknownKeys.slice(0, 5).join(", ")}.`);

  const id = event.id;
  const idOk = typeof id === "string" && SAFE_IDENTIFIER.test(id) && id.length > 0 && id.length <= MAX_NOTE_ID_LENGTH;
  if (!idOk) errors.push(`${label} id must be a string up to ${MAX_NOTE_ID_LENGTH} characters using only letters, numbers, dots, underscores or hyphens.`);
  else if (seenIds.has(id)) errors.push(`${label} repeats the note id "${id}".`);
  else seenIds.add(id);

  const midi = event.midi;
  const midiOk = typeof midi === "number" && Number.isInteger(midi) && midi >= CORRECTION_MIDI_MIN && midi <= CORRECTION_MIDI_MAX;
  if (!midiOk) errors.push(`${label} MIDI value must be an integer between ${CORRECTION_MIDI_MIN} and ${CORRECTION_MIDI_MAX}.`);
  if (midiOk && (typeof event.name !== "string" || event.name !== midiToNote(midi).name)) errors.push(`${label} note name does not match its MIDI value.`);

  if (typeof event.start !== "number" || !Number.isFinite(event.start) || event.start < 0 || event.start > MAX_NOTE_TIME) errors.push(`${label} start time must be a number between 0 and ${MAX_NOTE_TIME} seconds.`);
  if (typeof event.duration !== "number" || !Number.isFinite(event.duration) || event.duration <= 0 || event.duration > MAX_NOTE_TIME) errors.push(`${label} duration must be a positive number up to ${MAX_NOTE_TIME} seconds.`);
  if (typeof event.velocity !== "number" || !Number.isInteger(event.velocity) || event.velocity < CORRECTION_VELOCITY_MIN || event.velocity > CORRECTION_VELOCITY_MAX) errors.push(`${label} velocity must be an integer between ${CORRECTION_VELOCITY_MIN} and ${CORRECTION_VELOCITY_MAX}.`);
  if (event.hand !== null && event.hand !== "left" && event.hand !== "right") errors.push(`${label} hand must be "left", "right" or null.`);
  if (event.finger !== undefined && event.finger !== null && (typeof event.finger !== "number" || !ALLOWED_FINGERS.has(event.finger))) errors.push(`${label} finger must be an integer between 1 and 5, or null.`);
  if (event.confidence !== undefined && event.confidence !== null && (typeof event.confidence !== "number" || !Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1)) errors.push(`${label} confidence must be between 0 and 1, or null.`);
  return errors;
}

export function validateLessonObject(lesson: unknown): { errors: string[]; exercise: LessonExercise | null } {
  const errors: string[] = [];
  if (!isRecord(lesson)) return { errors: ["Lesson must be an object with id, title, description, bpm, beatsPerMeasure, duration and events."], exercise: null };
  const unknownKeys = Object.keys(lesson).filter((key) => !LESSON_ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) errors.push(`Lesson contains unrecognized fields: ${unknownKeys.slice(0, 5).join(", ")}.`);

  if (typeof lesson.id !== "string" || !SAFE_IDENTIFIER.test(lesson.id) || lesson.id.length > MAX_LESSON_ID_LENGTH) errors.push(`Lesson id must be a string up to ${MAX_LESSON_ID_LENGTH} characters using only letters, numbers, dots, underscores or hyphens.`);
  if (typeof lesson.title !== "string" || lesson.title.trim().length === 0 || lesson.title.length > MAX_LESSON_TITLE_LENGTH) errors.push(`Lesson title must be a non-empty string up to ${MAX_LESSON_TITLE_LENGTH} characters.`);
  if (typeof lesson.description !== "string" || lesson.description.length > MAX_LESSON_DESCRIPTION_LENGTH) errors.push(`Lesson description must be a string up to ${MAX_LESSON_DESCRIPTION_LENGTH} characters.`);

  const bpm = lesson.bpm;
  const bpmOk = typeof bpm === "number" && Number.isInteger(bpm) && (bpm === 0 || (bpm >= MIN_LESSON_BPM && bpm <= MAX_LESSON_BPM));
  if (!bpmOk) errors.push(`Lesson BPM must be an integer between ${MIN_LESSON_BPM} and ${MAX_LESSON_BPM}, or 0 when unknown.`);
  if (typeof lesson.beatsPerMeasure !== "number" || !Number.isInteger(lesson.beatsPerMeasure) || lesson.beatsPerMeasure < 1 || lesson.beatsPerMeasure > 16) errors.push("Lesson beats-per-measure must be an integer between 1 and 16.");
  if (typeof lesson.duration !== "number" || !Number.isFinite(lesson.duration) || lesson.duration <= 0 || lesson.duration > MAX_LESSON_DURATION) errors.push(`Lesson duration must be a positive number up to ${MAX_LESSON_DURATION} seconds.`);
  if (!Array.isArray(lesson.events)) errors.push("Lesson events must be an array.");
  else if (lesson.events.length === 0) errors.push("Lesson events must contain at least one note.");
  else if (lesson.events.length > MAX_IMPORTED_EVENTS) errors.push(`Lesson contains too many notes (the maximum is ${MAX_IMPORTED_EVENTS}).`);

  const seenIds = new Set<string>();
  if (Array.isArray(lesson.events)) {
    lesson.events.forEach((event, index) => {
      errors.push(...validateNoteEvent(event, index, seenIds));
    });
  }

  const exercise: LessonExercise | null = errors.length === 0 ? buildExercise(lesson) : null;
  return { errors, exercise };
}

export function validateLessonTransferDocument(doc: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(doc)) return ["The lesson file must contain a single JSON object."];
  const unknownDocKeys = Object.keys(doc).filter((key) => !DOC_ALLOWED_KEYS.has(key));
  if (unknownDocKeys.length > 0) errors.push(`The lesson file contains unrecognized fields: ${unknownDocKeys.slice(0, 5).join(", ")}.`);
  if (doc.schema !== LESSON_TRANSFER_SCHEMA) errors.push(`Unsupported lesson file schema. Expected "${LESSON_TRANSFER_SCHEMA}".`);
  if (doc.version !== LESSON_TRANSFER_VERSION) errors.push(`Unsupported lesson file version. Expected ${LESSON_TRANSFER_VERSION}.`);
  if (doc.exportedAt !== undefined && (typeof doc.exportedAt !== "string" || doc.exportedAt.trim() === "" || doc.exportedAt.length > 64)) errors.push("The lesson file timestamp is invalid.");
  const lesson = validateLessonObject(doc.lesson);
  errors.push(...lesson.errors);
  return errors;
}

function buildExercise(lesson: UnknownRecord): LessonExercise {
  const events: NoteEvent[] = (lesson.events as UnknownRecord[]).map((event) => {
    const note: NoteEvent = {
      id: event.id as string,
      midi: event.midi as number,
      name: event.name as string,
      start: event.start as number,
      duration: event.duration as number,
      velocity: event.velocity as number,
      hand: event.hand as LessonHand | null,
    };
    if (event.finger !== undefined && event.finger !== null) note.finger = event.finger as NoteEvent["finger"];
    if (event.confidence !== undefined && event.confidence !== null) (note as LessonExportNote).confidence = event.confidence as number;
    return note;
  });
  return {
    id: lesson.id as string,
    title: lesson.title as string,
    description: lesson.description as string,
    bpm: lesson.bpm as number,
    beatsPerMeasure: lesson.beatsPerMeasure as number,
    duration: lesson.duration as number,
    events,
  };
}

/**
 * Builds a versioned transfer document from a lesson, copying only the fields
 * the transfer format supports. Audio files, Blob/object URLs, filesystem
 * paths, secrets and correction undo history can never leak into the export
 * because they are not part of this whitelist.
 */
export function buildLessonTransferDocument(lesson: LessonExportInput): LessonTransferDocument {
  const events: LessonExportNote[] = lesson.events.map((event) => {
    const next: UnknownRecord = {
      id: event.id,
      midi: event.midi,
      name: event.name,
      start: event.start,
      duration: event.duration,
      velocity: event.velocity,
      hand: event.hand,
    };
    if (event.finger !== undefined && event.finger !== null) next.finger = event.finger;
    if (event.confidence !== undefined && event.confidence !== null) next.confidence = event.confidence;
    return next as LessonExportNote;
  });
  return {
    schema: LESSON_TRANSFER_SCHEMA,
    version: LESSON_TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    lesson: {
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      bpm: lesson.bpm,
      beatsPerMeasure: lesson.beatsPerMeasure,
      duration: lesson.duration,
      events,
    },
  };
}

/**
 * Serializes a lesson to the versioned JSON format. Throws when the lesson
 * cannot pass the same validation used on import, guaranteeing that anything
 * this function produces can always be imported again.
 */
export function serializeLessonExport(lesson: LessonExportInput): string {
  const doc = buildLessonTransferDocument(lesson);
  const errors = validateLessonTransferDocument(doc);
  if (errors.length > 0) throw new LessonTransferError(`The lesson could not be exported: ${errors.join(" ")}`);
  return JSON.stringify(doc, null, 2);
}

/**
 * Parses and strictly validates a lesson JSON file. Rejects malformed JSON,
 * oversized payloads, deeply nested payloads, unsafe property names, unknown
 * schemas/versions and any note event that falls outside the supported ranges.
 */
export function parseLessonImport(text: unknown): LessonImportResult {
  if (typeof text !== "string") return { lesson: null, error: "The lesson file could not be read." };
  const cleaned = text.replace(/^\uFEFF/, "");
  const trimmed = cleaned.trim();
  if (trimmed === "") return { lesson: null, error: "The lesson file is empty." };
  if (new TextEncoder().encode(cleaned).length > MAX_LESSON_JSON_BYTES) return { lesson: null, error: `The lesson file is larger than the ${formatLimit(MAX_LESSON_JSON_BYTES)} limit.` };
  if (scanJsonDepth(trimmed) > MAX_LESSON_JSON_DEPTH) return { lesson: null, error: "The lesson file is nested too deeply and was rejected." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { lesson: null, error: "The lesson file is not valid JSON." };
  }

  if (containsDangerousKeys(parsed)) return { lesson: null, error: "The lesson file contains unsafe properties and was rejected." };

  const errors = validateLessonTransferDocument(parsed);
  if (errors.length > 0) return { lesson: null, error: `Rejected lesson file: ${errors.join(" ")}` };

  const record = parsed as UnknownRecord;
  return { lesson: buildExercise(record.lesson as UnknownRecord), error: null };
}

/**
 * Generates a unique identity for a single import so that re-importing the
 * same file starts a fresh correction session instead of reusing the old one.
 */
export function createLessonImportId(): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `import-${random}`;
}
