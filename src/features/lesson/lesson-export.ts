import { serializeLessonExport } from "./lesson-transfer";
import type { LessonExercise } from "../../types/lesson";

/**
 * The two export variants offered in the workspace. "original" always refers
 * to a pristine detected analysis; "current" refers to whatever lesson is
 * loaded right now (detected, corrected, or imported).
 */
export type LessonExportKind = "original" | "current";

export type LessonExportState =
  | { status: "idle"; kind: null }
  | { status: "loading"; kind: LessonExportKind }
  | { status: "success"; kind: LessonExportKind; fileName: string }
  | { status: "error"; kind: LessonExportKind; message: string };

export type LessonExportProviders = {
  original: () => LessonExercise | null;
  current: () => LessonExercise | null;
};

const BLOB_URL_REVOKE_DELAY_MS = 0;

/**
 * Turns a lesson title into a safe download filename. Path separators, control
 * characters, reserved filename characters and leading/trailing dots or spaces
 * are stripped, runs are collapsed and the result is capped at a reasonable
 * length so the browser never receives a path-like or oversized name.
 */
export function sanitizeExportFilename(title: string): string {
  const cleaned = String(title ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^\p{L}\p{M}\p{N} _.-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .replace(/\.json$/i, "")
    .slice(0, 80)
    .replace(/[.\s]+$/, "");
  return `${cleaned || "lesson"}.json`;
}

/**
 * Downloads a text payload under the given filename using a temporary Blob
 * URL. The URL is revoked exactly once, shortly after the download has been
 * triggered, so no object URL is left behind.
 */
export function triggerFileDownload(fileName: string, content: string, mimeType = "application/json"): void {
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
  }, BLOB_URL_REVOKE_DELAY_MS);
}

/**
 * Serializes a lesson to the transfer JSON format. Throws the same validation
 * error `serializeLessonExport` does when the lesson cannot round-trip, and
 * only ever writes the whitelisted fields, never audio, URLs, paths or state.
 */
export function createLessonExportJson(lesson: LessonExercise): string {
  return serializeLessonExport(lesson);
}

/**
 * Runs a single export and returns the resulting state. Kept framework-agnostic
 * so the loading/success/error transitions can be unit tested without React.
 * The downloader is injected so tests can observe the payload without touching
 * the DOM.
 */
export function runLessonExport(
  kind: LessonExportKind,
  providers: LessonExportProviders,
  download: (fileName: string, content: string, mimeType: string) => void = triggerFileDownload,
): LessonExportState {
  const lesson = providers[kind]();
  if (!lesson) {
    return { status: "error", kind, message: "There is no lesson to export." };
  }
  try {
    const json = createLessonExportJson(lesson);
    const fileName = sanitizeExportFilename(lesson.title);
    download(fileName, json, "application/json");
    return { status: "success", kind, fileName };
  } catch (error) {
    return { status: "error", kind, message: error instanceof Error ? error.message : "The lesson could not be exported." };
  }
}
