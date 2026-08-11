import { describe, expect, it } from "vitest";
import { demoExercises } from "../../data/demo-exercises";
import type { LessonExercise } from "../../types/lesson";
import {
  buildLessonTransferDocument,
  createLessonImportId,
  LESSON_TRANSFER_SCHEMA,
  LESSON_TRANSFER_VERSION,
  LessonTransferError,
  MAX_IMPORTED_EVENTS,
  MAX_LESSON_JSON_BYTES,
  MAX_LESSON_JSON_DEPTH,
  parseLessonImport,
  serializeLessonExport,
  validateLessonTransferDocument,
  type LessonExportInput,
  type LessonExportNote,
} from "./lesson-transfer";

function makeNote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "n1", midi: 60, name: "C4", start: 0, duration: 0.5, velocity: 100, hand: null, ...overrides };
}

function makeLesson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "test-lesson", title: "Test Lesson", description: "A test description", bpm: 80, beatsPerMeasure: 4, duration: 3, events: [makeNote()], ...overrides };
}

function makeDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema: LESSON_TRANSFER_SCHEMA, version: LESSON_TRANSFER_VERSION, exportedAt: "2026-08-11T00:00:00.000Z", lesson: makeLesson(), ...overrides };
}

function json(doc: unknown): string {
  return JSON.stringify(doc);
}

function asExercise(doc: Record<string, unknown>): LessonExercise {
  const result = parseLessonImport(json(doc));
  if (result.error !== null) throw new Error(result.error);
  return result.lesson;
}

describe("buildLessonTransferDocument", () => {
  it("emits the versioned schema envelope", () => {
    const exercise: LessonExportInput = { ...asExercise(makeDoc()), events: [asExercise(makeDoc()).events[0]] };
    const doc = buildLessonTransferDocument(exercise);
    expect(doc.schema).toBe(LESSON_TRANSFER_SCHEMA);
    expect(doc.version).toBe(LESSON_TRANSFER_VERSION);
    expect(typeof doc.exportedAt).toBe("string");
    expect(doc.lesson.id).toBe("test-lesson");
    expect(doc.lesson.title).toBe("Test Lesson");
    expect(doc.lesson.events).toHaveLength(1);
  });

  it("keeps confidence and finger values when present", () => {
    const exercise: LessonExportInput = { ...asExercise(makeDoc({ lesson: makeLesson({ events: [makeNote({ confidence: 0.87, finger: 3 })] }) })), events: [{ id: "n1", midi: 60, name: "C4", start: 0, duration: 0.5, velocity: 100, hand: null, confidence: 0.87, finger: 3 }] };
    const doc = buildLessonTransferDocument(exercise);
    expect(doc.lesson.events[0]).toMatchObject({ confidence: 0.87, finger: 3 });
  });

  it("omits null confidence and null finger from the export", () => {
    const exercise: LessonExportInput = { ...asExercise(makeDoc()), events: [{ id: "n1", midi: 60, name: "C4", start: 0, duration: 0.5, velocity: 100, hand: null, confidence: null, finger: null }] };
    const serialized = serializeLessonExport(exercise);
    expect(serialized).not.toContain("confidence");
    expect(serialized).not.toContain("finger");
  });
});

describe("serializeLessonExport", () => {
  it("produces JSON that round-trips back to the same lesson", () => {
    const exercise = demoExercises[0];
    const serialized = serializeLessonExport(exercise);
    const result = parseLessonImport(serialized);
    expect(result.error).toBeNull();
    expect(result.lesson).toEqual(exercise);
  });

  it("round-trips a detected-style lesson with unknown BPM and confidence", () => {
    const exercise: LessonExercise = {
      id: "detected-abc",
      title: "Detected melody",
      description: "Detected from your audio.",
      bpm: 0,
      beatsPerMeasure: 4,
      duration: 1.5,
      events: [{ id: "n1", midi: 60, name: "C4", start: 0, duration: 0.5, velocity: 100, hand: null, confidence: 0.9 } as LessonExportNote],
    };
    const result = parseLessonImport(serializeLessonExport(exercise));
    expect(result.error).toBeNull();
    expect(result.lesson).toEqual(exercise);
    expect((result.lesson?.events[0] as LessonExportNote | undefined)?.confidence).toBe(0.9);
  });

  it("round-trips a corrected lesson preserving confidence for the next edit session", () => {
    const base = asExercise(makeDoc({ lesson: makeLesson({ events: [makeNote({ confidence: 0.9 })] }) }));
    const corrected: LessonExercise = { ...base, events: [{ ...base.events[0], midi: 62, name: "D4", confidence: 0.9 } as LessonExportNote] };
    const result = parseLessonImport(serializeLessonExport(corrected));
    expect(result.error).toBeNull();
    expect(result.lesson).not.toBeNull();
    expect(result.lesson?.events[0]).toMatchObject({ midi: 62, name: "D4", confidence: 0.9 });
  });

  it("never leaks audio, blob URLs, paths, secrets or undo history", () => {
    const exercise = asExercise(makeDoc());
    const tainted = {
      ...exercise,
      events: exercise.events.map((event) => ({ ...event })),
    } as LessonExportInput;
    const serialized = serializeLessonExport(tainted);
    expect(serialized).not.toContain("blob:");
    expect(serialized).not.toContain("audioFile");
    expect(serialized).not.toContain("objectUrl");
    expect(serialized).not.toContain("C:\\\\");
    expect(serialized).not.toContain("/home/");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("past");
    expect(serialized).not.toContain("future");
    expect(serialized).not.toContain("undo");
  });

  it("drops arbitrary extra properties attached to the lesson object", () => {
    const exercise = asExercise(makeDoc());
    const tainted = {
      ...exercise,
      audioFile: new File([new Uint8Array([1, 2, 3])], "secret.wav", { type: "audio/wav" }),
      blobUrl: "blob:http://localhost/1234",
      fullPath: "C:\\Users\\secret\\file.wav",
      undoHistory: [{ events: exercise.events }],
    } as unknown as LessonExportInput;
    const doc = JSON.parse(serializeLessonExport(tainted)) as { lesson: Record<string, unknown> };
    expect(Object.keys(doc.lesson)).toEqual(["id", "title", "description", "bpm", "beatsPerMeasure", "duration", "events"]);
  });

  it("throws when the lesson cannot pass its own import validation", () => {
    const exercise = asExercise(makeDoc());
    expect(() => serializeLessonExport({ ...exercise, bpm: 1000 })).toThrow(LessonTransferError);
    expect(() => serializeLessonExport({ ...exercise, events: [{ ...exercise.events[0], midi: 10 }] })).toThrow(/MIDI/);
  });
});

describe("parseLessonImport basic rejection", () => {
  it("rejects non-string input", () => {
    expect(parseLessonImport(null).error).toContain("could not be read");
    expect(parseLessonImport(42).error).toContain("could not be read");
  });

  it("rejects empty and whitespace-only files", () => {
    expect(parseLessonImport("").error).toContain("empty");
    expect(parseLessonImport("   ").error).toContain("empty");
    expect(parseLessonImport("\uFEFF  \n").error).toContain("empty");
  });

  it("rejects malformed JSON", () => {
    expect(parseLessonImport("{ not json").error).toContain("not valid JSON");
    expect(parseLessonImport("[1, 2,]").error).toContain("not valid JSON");
  });

  it("rejects an array or primitive root", () => {
    expect(parseLessonImport("[1, 2, 3]").error).toContain("single JSON object");
    expect(parseLessonImport('"hello"').error).toContain("single JSON object");
    expect(parseLessonImport("null").error).toContain("single JSON object");
  });

  it("rejects payloads larger than the byte limit", () => {
    const padded = json(makeDoc({ lesson: makeLesson({ description: "x".repeat(MAX_LESSON_JSON_BYTES) }) }));
    const result = parseLessonImport(padded);
    expect(result.error).toContain("larger than");
  });

  it("rejects deeply nested payloads before parsing", () => {
    const nested = `${"[".repeat(MAX_LESSON_JSON_DEPTH + 1)}1${"]".repeat(MAX_LESSON_JSON_DEPTH + 1)}`;
    expect(parseLessonImport(nested).error).toContain("too deeply");
  });

  it("rejects payloads with dangerous property names anywhere", () => {
    const doc = makeDoc();
    const withProtoKey = `{${JSON.stringify(doc).slice(1, -1)},"__proto__":{"polluted":true}}`;
    expect(parseLessonImport(withProtoKey).error).toContain("unsafe properties");
    expect(parseLessonImport(json({ ...makeDoc(), lesson: { ...makeLesson(), events: [makeNote({ constructor: "x" })] } })).error).toContain("unsafe properties");
    expect(parseLessonImport(json({ ...makeDoc(), lesson: { ...makeLesson({ events: [makeNote()] }), nested: { prototype: 1 } } })).error).toContain("unsafe properties");
  });
});

describe("parseLessonImport schema and version", () => {
  it("rejects an unknown schema", () => {
    expect(parseLessonImport(json(makeDoc({ schema: "some-other-schema" }))).error).toContain("schema");
  });

  it("rejects an unsupported version", () => {
    expect(parseLessonImport(json(makeDoc({ version: 2 }))).error).toContain("version");
  });

  it("rejects unknown top-level fields", () => {
    expect(parseLessonImport(json(makeDoc({ undoHistory: [] }))).error).toContain("unrecognized fields");
    expect(parseLessonImport(json(makeDoc({ audioFile: "secret" }))).error).toContain("unrecognized fields");
  });

  it("accepts a document without an exportedAt timestamp", () => {
    const doc = makeDoc();
    delete doc.exportedAt;
    const result = parseLessonImport(json(doc));
    expect(result.error).toBeNull();
  });

  it("rejects an invalid exportedAt timestamp", () => {
    const result = parseLessonImport(json(makeDoc({ exportedAt: 12345 })));
    expect(result.error).toContain("timestamp");
  });
});

describe("parseLessonImport lesson-level validation", () => {
  it("rejects a missing or non-object lesson", () => {
    expect(parseLessonImport(json(makeDoc({ lesson: null }))).error).toContain("Lesson must be an object");
    expect(parseLessonImport(json(makeDoc({ lesson: [] }))).error).toContain("Lesson must be an object");
  });

  it("rejects unknown lesson fields", () => {
    expect(parseLessonImport(json(makeDoc({ lesson: makeLesson({ originalAudio: "x" }) }))).error).toContain("unrecognized fields");
  });

  it.each([
    ["missing id", makeLesson({ id: undefined })],
    ["unsafe id characters", makeLesson({ id: "has space" })],
    ["id with slashes", makeLesson({ id: "a/b" })],
    ["id too long", makeLesson({ id: "x".repeat(129) })],
    ["empty title", makeLesson({ title: "  " })],
    ["title too long", makeLesson({ title: "x".repeat(201) })],
    ["description too long", makeLesson({ description: "x".repeat(1001) })],
    ["bpm negative", makeLesson({ bpm: -1 })],
    ["bpm too high", makeLesson({ bpm: 301 })],
    ["bpm fractional", makeLesson({ bpm: 80.5 })],
    ["beats too low", makeLesson({ beatsPerMeasure: 0 })],
    ["beats too high", makeLesson({ beatsPerMeasure: 17 })],
    ["beats fractional", makeLesson({ beatsPerMeasure: 4.5 })],
    ["duration zero", makeLesson({ duration: 0 })],
    ["duration negative", makeLesson({ duration: -1 })],
    ["duration too long", makeLesson({ duration: 3_601 })],
    ["events not an array", makeLesson({ events: "nope" })],
    ["events empty", makeLesson({ events: [] })],
    ["too many events", makeLesson({ events: Array.from({ length: MAX_IMPORTED_EVENTS + 1 }, (_, index) => makeNote({ id: `n${index}` })) })],
  ])("rejects %s", (_label, lesson) => {
    const result = parseLessonImport(json(makeDoc({ lesson })));
    expect(result.error).toBeTruthy();
  });
});

describe("parseLessonImport note-event validation", () => {
  it("accepts every supported optional field form", () => {
    const events = [
      makeNote({ id: "a", confidence: null, finger: null }),
      makeNote({ id: "b", confidence: 1, finger: 5, hand: "right" }),
      makeNote({ id: "c", hand: "left" }),
      makeNote({ id: "d", start: 86_400, duration: 86_400, velocity: 127, midi: 96, name: "C7" }),
    ];
    const result = parseLessonImport(json(makeDoc({ lesson: makeLesson({ events }) })));
    expect(result.error).toBeNull();
    expect(result.lesson?.events).toHaveLength(4);
  });

  it("rejects duplicate note ids", () => {
    const result = parseLessonImport(json(makeDoc({ lesson: makeLesson({ events: [makeNote(), makeNote({ start: 1 })] }) })));
    expect(result.error).toContain("repeats the note id");
  });

  it.each([
    ["id with spaces", makeNote({ id: "n 1" })],
    ["empty id", makeNote({ id: "" })],
    ["midi too low", makeNote({ midi: 35 })],
    ["midi too high", makeNote({ midi: 97 })],
    ["midi fractional", makeNote({ midi: 60.5 })],
    ["name mismatch", makeNote({ name: "D4" })],
    ["start negative", makeNote({ start: -0.1 })],
    ["start too long", makeNote({ start: 86_401 })],
    ["duration zero", makeNote({ duration: 0 })],
    ["duration negative", makeNote({ duration: -0.5 })],
    ["velocity zero", makeNote({ velocity: 0 })],
    ["velocity too high", makeNote({ velocity: 128 })],
    ["velocity fractional", makeNote({ velocity: 88.5 })],
    ["bad hand", makeNote({ hand: "middle" })],
    ["finger too high", makeNote({ finger: 6 })],
    ["finger fractional", makeNote({ finger: 2.5 })],
    ["confidence too high", makeNote({ confidence: 1.1 })],
    ["confidence negative", makeNote({ confidence: -0.1 })],
  ])("rejects a note with %s", (_label, event) => {
    const result = parseLessonImport(json(makeDoc({ lesson: makeLesson({ events: [event] }) })));
    expect(result.error).toBeTruthy();
  });

  it("rejects unknown note fields so undo history or audio cannot be smuggled in", () => {
    const result = parseLessonImport(json(makeDoc({ lesson: makeLesson({ events: [makeNote({ audioFile: "blob:x" })] }) })));
    expect(result.error).toContain("unrecognized fields");
  });

  it("rejects non-object notes", () => {
    const result = parseLessonImport(json(makeDoc({ lesson: makeLesson({ events: ["C4"] }) })));
    expect(result.error).toContain("must be an object");
  });

  it("reports the offending note index in the error", () => {
    const events = [makeNote(), makeNote({ id: "n2", start: 1 }), makeNote({ id: "n3", start: 2, velocity: 200 })];
    const result = parseLessonImport(json(makeDoc({ lesson: makeLesson({ events }) })));
    expect(result.error).toContain("Note 3");
  });
});

describe("parseLessonImport successful imports", () => {
  it("loads a valid exported lesson unchanged", () => {
    const serialized = serializeLessonExport(demoExercises[1]);
    const result = parseLessonImport(serialized);
    expect(result.error).toBeNull();
    expect(result.lesson).toEqual(demoExercises[1]);
  });

  it("returns a clean lesson without extra transfer fields", () => {
    const lesson = asExercise(makeDoc());
    expect(Object.keys(lesson)).toEqual(["id", "title", "description", "bpm", "beatsPerMeasure", "duration", "events"]);
    expect(lesson.events[0]).toMatchObject({ id: "n1", midi: 60, name: "C4", start: 0, duration: 0.5, velocity: 100, hand: null });
  });

  it("strips BOM and surrounding whitespace", () => {
    const serialized = serializeLessonExport(demoExercises[0]);
    const result = parseLessonImport(`\uFEFF \n ${serialized} \n`);
    expect(result.error).toBeNull();
    expect(result.lesson).toEqual(demoExercises[0]);
  });
});

describe("validateLessonTransferDocument", () => {
  it("returns no errors for a valid document", () => {
    expect(validateLessonTransferDocument(makeDoc())).toEqual([]);
  });

  it("returns a single-object error for non-record roots", () => {
    expect(validateLessonTransferDocument(null)).toHaveLength(1);
    expect(validateLessonTransferDocument([])).toHaveLength(1);
  });

  it("returns errors instead of throwing for malformed shapes", () => {
    expect(validateLessonTransferDocument({ schema: "x" })).not.toEqual([]);
  });
});

describe("createLessonImportId", () => {
  it("returns a unique non-empty identity", () => {
    const first = createLessonImportId();
    const second = createLessonImportId();
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });
});
