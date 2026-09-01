import { chordProToSongSheet, songSheetToChordPro } from "./chordpro";
import type { SongLine, SongLyricSegment, SongMetadata, SongSection, SongSheet } from "@/types/song-sheet";

export const MAX_SONG_SHEET_IMPORT_BYTES = 200 * 1024;
export const MAX_CHORD_PRO_IMPORT_CHARS = 250 * 1024;
export const MAX_CHORD_SYMBOL_LENGTH = 28;
export const MAX_SEGMENT_TEXT_LENGTH = 2000;
export const MAX_FIELD_LENGTH = 1000;

export type SheetExchangeErrorCode = "malformed" | "oversized" | "unsafe" | "invalid_content" | "read_failed";

export class SheetExchangeError extends Error {
  readonly code: SheetExchangeErrorCode;

  constructor(message: string, code: SheetExchangeErrorCode) {
    super(message);
    this.name = "SheetExchangeError";
    this.code = code;
  }
}

const CONTROL_CHAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
const HTML_FRAGMENT = /<[a-zA-Z/!]/;
const ROOT_NOTE = /^[A-Ga-g][#b]?$/;

/**
 * Whether a value is a safe, plausible chord symbol. Accepts roots with optional
 * accidentals plus a quality/altered suffix (e.g. C, Am, Bb7, F#m7b5, C/G, N,
 * NC). Rejects anything empty, oversized, containing control characters, HTML
 * fragments or whitespace-padded garbage.
 */
export function isChordSymbol(value: string): boolean {
  const chord = String(value ?? "").trim();
  if (chord.length === 0 || chord.length > MAX_CHORD_SYMBOL_LENGTH) return false;
  if (CONTROL_CHAR.test(chord) || HTML_FRAGMENT.test(chord)) return false;
  if (chord === "N" || chord === "NC" || chord.toUpperCase() === "N.C.") return true;

  const parts = chord.split("/");
  if (parts.length > 2) return false;
  if (parts.some((part) => part.trim() === "")) return false;
  if (parts.length === 2 && !ROOT_NOTE.test(parts[1])) return false;
  const main = parts[0];
  return /^[A-Ga-g][#b]?[A-Za-z0-9#+°()\-]*$/.test(main);
}

function isSafeTextField(value: string): boolean {
  if (typeof value !== "string") return false;
  if (value.length > MAX_FIELD_LENGTH) return false;
  if (CONTROL_CHAR.test(value)) return false;
  return !HTML_FRAGMENT.test(value);
}

function isSafeSegmentText(value: string): boolean {
  if (typeof value !== "string") return false;
  if (value.length > MAX_SEGMENT_TEXT_LENGTH) return false;
  if (CONTROL_CHAR.test(value)) return false;
  return !HTML_FRAGMENT.test(value);
}

const SECTION_TYPES = new Set(["intro", "verse", "chorus", "bridge", "outro"]);
const DIFFICULTIES = new Set(["Beginner", "Intermediate", "Advanced"]);

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSegment(value: unknown): SongLyricSegment {
  if (!isRecord(value) || value.chord === undefined) {
    throw new SheetExchangeError("A song-sheet segment is missing text or chord data.", "malformed");
  }
  const rawText = value.text;
  if (!(isString(rawText) && isSafeSegmentText(rawText))) {
    throw new SheetExchangeError("A song-sheet segment is missing text or chord data.", "malformed");
  }
  const rawChord = value.chord;
  if (rawChord !== null && rawChord !== undefined && !(isString(rawChord) && isChordSymbol(rawChord))) {
    throw new SheetExchangeError(`Unrecognised chord symbol "${String(rawChord)}" in an imported segment.`, "invalid_content");
  }
  return { chord: rawChord === null || rawChord === undefined ? null : String(rawChord), text: rawText };
}

function parseLine(value: unknown): SongLine {
  if (!isRecord(value) || !Array.isArray(value.segments) || value.segments.length === 0) {
    throw new SheetExchangeError("A song-sheet line must contain at least one segment.", "malformed");
  }
  const id = value.id;
  if (id !== undefined && !(isString(id) && isSafeTextField(id))) {
    throw new SheetExchangeError("A song-sheet line has an invalid id.", "malformed");
  }
  const segments = value.segments.map(parseSegment);
  return { id: id ?? undefined, segments };
}

function parseSection(value: unknown): SongSection {
  if (
    !isRecord(value) ||
    !isString(value.id) ||
    !isSafeTextField(value.id) ||
    !isString(value.title) ||
    !isSafeTextField(value.title) ||
    !SECTION_TYPES.has(value.type as string) ||
    !Array.isArray(value.lines)
  ) {
    throw new SheetExchangeError("A song-sheet section is malformed.", "malformed");
  }
  return { id: value.id, title: value.title, type: value.type as SongSection["type"], lines: value.lines.map(parseLine) };
}

function clampInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(12, Math.round(value))) : fallback;
}

function parseMetadata(value: unknown): SongMetadata {
  if (!isRecord(value)) throw new SheetExchangeError("Song metadata is missing.", "malformed");
  const required: (keyof SongMetadata)[] = [
    "title",
    "composer",
    "periodOrOrigin",
    "attribution",
    "difficulty",
    "key",
    "originalKey",
    "timeSignature",
    "tuning",
    "defaultCapo",
    "description",
    "isPublicDomain",
  ];
  for (const key of required) {
    if (value[key] === undefined) throw new SheetExchangeError(`Song metadata is missing "${key}".`, "malformed");
  }
  for (const key of ["title", "composer", "periodOrOrigin", "attribution", "key", "originalKey", "timeSignature", "tuning", "description"]) {
    if (!isString(value[key]) || !isSafeTextField(value[key])) {
      throw new SheetExchangeError(`Song metadata "${key}" is not a safe string.`, "malformed");
    }
  }
  if (typeof value.difficulty !== "string" || !DIFFICULTIES.has(value.difficulty)) {
    throw new SheetExchangeError(`Song metadata "difficulty" must be Beginner, Intermediate or Advanced.`, "malformed");
  }
  return {
    title: value.title as string,
    composer: value.composer as string,
    periodOrOrigin: value.periodOrOrigin as string,
    attribution: value.attribution as string,
    difficulty: value.difficulty as SongMetadata["difficulty"],
    key: value.key as string,
    originalKey: value.originalKey as string,
    timeSignature: value.timeSignature as string,
    tuning: value.tuning as string,
    defaultCapo: clampInteger(value.defaultCapo, 0),
    description: value.description as string,
    isPublicDomain: value.isPublicDomain === true,
  };
}

/**
 * Turns a title into a safe download filename for song sheets. Removes path
 * separators, reserved characters, control characters, collapses runs, caps the
 * length and appends the given extension, so a long or hostile title can never
 * produce a path-like or oversized filename.
 */
export function sanitizeSongSheetFilename(title: string, extension: "json" | "cho" | "txt"): string {
  const cleaned = String(title ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^\p{L}\p{M}\p{N} _.-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .replace(/\.(json|cho|txt)$/i, "")
    .slice(0, 80)
    .replace(/[.\s]+$/, "");
  return `${cleaned || "song-sheet"}.${extension}`;
}

/** Serializes a song sheet to pretty JSON, preserving metadata, sections, lyrics, chords and ids. */
export function songSheetToJson(sheet: SongSheet): string {
  return JSON.stringify(sheet, null, 2);
}

/**
 * Downloads a text payload under the given filename. Framework-neutral: the
 * implementation may be swapped in tests via the `download` argument.
 */
export function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/** Exports a sheet as a JSON download and returns the filename used. */
export function exportSongSheetJson(sheet: SongSheet, download: (fileName: string, content: string, mimeType: string) => void = downloadTextFile): string {
  const fileName = sanitizeSongSheetFilename(sheet.metadata.title, "json");
  download(fileName, songSheetToJson(sheet), "application/json");
  return fileName;
}

/** Exports a sheet as a ChordPro download and returns the filename used. */
export function exportSongSheetChordPro(sheet: SongSheet, download: (fileName: string, content: string, mimeType: string) => void = downloadTextFile): string {
  const fileName = sanitizeSongSheetFilename(sheet.metadata.title, "cho");
  download(fileName, songSheetToChordPro(sheet), "text/x-chordpro; charset=utf-8");
  return fileName;
}

/**
 * Parses and strictly validates an imported SongSheet JSON document. Rejects
 * malformed structure, unsafe/oversized fields, invalid chord symbols and
 * non-object JSON. Returns a fresh SongSheet with all fields preserved.
 */
export function parseSongSheetJson(text: string): SongSheet {
  if (typeof text !== "string") throw new SheetExchangeError("The imported file has no text content.", "malformed");
  if (text.length > MAX_SONG_SHEET_IMPORT_BYTES) throw new SheetExchangeError("The imported file is too large.", "oversized");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SheetExchangeError("The imported file is not valid JSON.", "malformed");
  }
  if (!isRecord(parsed) || typeof parsed.id !== "string" || !isSafeTextField(parsed.id) || !Array.isArray(parsed.chordsUsed)) {
    throw new SheetExchangeError("The imported song sheet is missing required fields.", "malformed");
  }
  const metadata = parseMetadata(parsed.metadata);
  const sections = (parsed.sections as Array<unknown>).map(parseSection);
  const chords = parsed.chordsUsed.map((chord) => {
    if (!isString(chord) || !isChordSymbol(chord)) {
      throw new SheetExchangeError(`Unrecognised chord symbol "${String(chord)}" in chordsUsed.`, "invalid_content");
    }
    return chord.trim() === "N" || chord.trim() === "NC" ? chord.trim() : chord;
  });
  return { id: parsed.id, metadata, chordsUsed: Array.from(new Set(chords)), sections };
}

/**
 * Parses and validates an imported ChordPro document into a SongSheet. Chord
 * symbols found in bracket markers are validated and oversized text is refused.
 * Optional `fallback` supplies metadata (title/key from ChordPro directives
 * override it).
 */
export function parseChordProSheet(text: string, fallback?: Pick<SongSheet, "metadata" | "chordsUsed">): SongSheet {
  if (typeof text !== "string") throw new SheetExchangeError("The imported file has no text content.", "malformed");
  if (text.length > MAX_CHORD_PRO_IMPORT_CHARS) throw new SheetExchangeError("The imported ChordPro is too large.", "oversized");
  const defaultFallback: Pick<SongSheet, "metadata" | "chordsUsed"> = {
    metadata: {
      title: "Imported Song",
      composer: "Imported",
      periodOrOrigin: "ChordPro import",
      attribution: "Imported by the user",
      difficulty: "Beginner",
      key: "C",
      originalKey: "C",
      timeSignature: "4/4",
      tuning: "E A D G B E",
      defaultCapo: 0,
      description: "Imported from a ChordPro file.",
      isPublicDomain: false,
    },
    chordsUsed: [],
  };
  const source = fallback ?? defaultFallback;
  const textForParse = text.replace(/^\uFEFF/, "");
  const sheet = chordProToSongSheet(textForParse, source);
  for (const section of sheet.sections) {
    if (!isSafeTextField(section.title)) throw new SheetExchangeError("A ChordPro section label is unsafe.", "unsafe");
    for (const line of section.lines) {
      for (const segment of line.segments) {
        if (!isSafeSegmentText(segment.text)) throw new SheetExchangeError("A ChordPro lyric line is unsafe or oversized.", "unsafe");
        if (segment.chord && !isChordSymbol(segment.chord)) {
          throw new SheetExchangeError(`Unrecognised chord symbol "[${segment.chord}]" in ChordPro.`, "invalid_content");
        }
      }
    }
  }
  for (const chord of sheet.chordsUsed) {
    if (!isChordSymbol(chord)) throw new SheetExchangeError(`Unrecognised chord symbol "${chord}" in the ChordPro.`, "invalid_content");
  }
  return sheet;
}

/**
 * Reads a File object as text with a configurable size ceiling. Rejects absent
 * files, files over the ceiling and files the browser cannot read.
 */
export async function readSheetImportFile(file: File | null, maxBytes: number = MAX_SONG_SHEET_IMPORT_BYTES): Promise<string> {
  if (!file) throw new SheetExchangeError("Choose a file to import.", "malformed");
  if (file.size > maxBytes) {
    throw new SheetExchangeError(`The file is larger than the ${Math.round(maxBytes / 1024)} KB import limit.`, "oversized");
  }
  if (file.size === 0) throw new SheetExchangeError("The file is empty.", "malformed");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new SheetExchangeError("The file could not be read.", "read_failed"));
    reader.readAsText(file);
  });
}