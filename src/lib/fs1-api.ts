import { resolveServiceBaseUrl } from "./service-url";

export const FS1_DEFAULT_UPLOAD_BYTES = 25 * 1024 * 1024;
export const FS1_SUPPORTED_AUDIO_EXTENSIONS = ["wav", "mp3", "m4a", "ogg"] as const;
export const FS1_SUPPORTED_AUDIO_LABEL = "WAV, MP3, M4A or OGG";
/** Whole round-trip ceiling (upload + heavy Demucs/Whisper separation + poll). */
export const FS1_JOB_TIMEOUT_MS = 7 * 60 * 1000;
export const FS1_POLL_INTERVAL_MS = 1500;

export type SupportedAudioExtension = (typeof FS1_SUPPORTED_AUDIO_EXTENSIONS)[number];

export type Fs1JobStatus =
  | "queued"
  | "validating"
  | "separating"
  | "transcribing"
  | "detecting_chords"
  | "aligning"
  | "complete"
  | "failed"
  | "cancelled";

export type Fs1Capability = {
  name: string;
  available: boolean;
  model?: string | null;
  reason?: string | null;
};

export type Fs1LyricWord = {
  text: string;
  start: number;
  end: number;
  confidence: number;
  uncertain: boolean;
};

export type Fs1LyricLine = {
  text: string;
  start: number;
  end: number;
  confidence: number;
  uncertain: boolean;
  words: Fs1LyricWord[];
};

export type Fs1ChordEvent = {
  chord: string;
  start: number;
  end: number;
  confidence: number;
  beat_index: number;
};

export type Fs1LyricSegment = {
  chord?: string | null;
  text: string;
};

export type Fs1Line = {
  id?: string | null;
  segments: Fs1LyricSegment[];
};

export type Fs1Section = {
  id: string;
  title: string;
  type: "intro" | "verse" | "chorus" | "bridge" | "outro";
  lines: Fs1Line[];
};

/** Mirror of the worker's SongSheetCompat; structurally compatible with the frontend SongSheet. */
export type Fs1SongSheet = {
  id: string;
  metadata: Record<string, unknown>;
  chordsUsed: string[];
  sections: Fs1Section[];
};

export type Fs1Result = {
  analysis_version: string;
  duration: number;
  language: string;
  language_confidence: number;
  bpm: number | null;
  beat_source: string | null;
  lyric_words: Fs1LyricWord[];
  lyric_lines: Fs1LyricLine[];
  chord_events: Fs1ChordEvent[];
  chord_anchors: { chord: string; time: number; confidence: number }[];
  song_sheet: Fs1SongSheet;
  warnings: string[];
  model_info: { demucs: Fs1Capability; whisper: Fs1Capability; ffmpeg: Fs1Capability };
  processing_time_seconds: number;
};

export type Fs1BackendError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type Fs1Job = {
  job_id: string;
  status: Fs1JobStatus;
  progress: number;
  result: Fs1Result | null;
  error: Fs1BackendError | null;
};

export class Fs1ApiError extends Error {
  readonly code: string;
  readonly statusCode: number | null;
  readonly cancelled: boolean;
  readonly backendCode?: string;
  readonly backendMessage?: string;

  constructor(
    message: string,
    options: {
      code?: string;
      statusCode?: number | null;
      cancelled?: boolean;
      backendCode?: string;
      backendMessage?: string;
    } = {},
  ) {
    super(message);
    this.name = "Fs1ApiError";
    this.code = options.code ?? "fs1_api_error";
    this.statusCode = options.statusCode ?? null;
    this.cancelled = options.cancelled ?? false;
    this.backendCode = options.backendCode;
    this.backendMessage = options.backendMessage;
  }
}

export function getFs1ApiUrl(): string {
  return resolveServiceBaseUrl(process.env.NEXT_PUBLIC_FS1_API_URL, "http://localhost:8088");
}

export function getFs1MaxUploadBytes(): number {
  const configured = Number(process.env.NEXT_PUBLIC_FS1_MAX_UPLOAD_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : FS1_DEFAULT_UPLOAD_BYTES;
}

export function validateFs1AudioFile(file: File | null): string | null {
  if (!file) return "Choose an audio file to continue.";
  const extension = file.name.trim().toLowerCase().split(".").pop() ?? "";
  if (!FS1_SUPPORTED_AUDIO_EXTENSIONS.includes(extension as SupportedAudioExtension)) {
    return `Unsupported format. Use ${FS1_SUPPORTED_AUDIO_LABEL}.`;
  }
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > getFs1MaxUploadBytes()) return "This file is larger than the full-song limit.";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCapability(value: unknown): value is Fs1Capability {
  return isRecord(value) && typeof value.name === "string" && typeof value.available === "boolean";
}

function isSegment(value: unknown): value is Fs1LyricSegment {
  return isRecord(value) && typeof value.text === "string" && (value.chord === null || value.chord === undefined || typeof value.chord === "string");
}

function isSection(value: unknown): value is Fs1Section {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string" || !Array.isArray(value.lines)) return false;
  return value.lines.every(
    (line) =>
      isRecord(line) &&
      (line.id === null || line.id === undefined || typeof line.id === "string") &&
      Array.isArray(line.segments) &&
      line.segments.every(isSegment),
  );
}

function isLyricLine(value: unknown): value is Fs1LyricLine {
  return (
    isRecord(value) &&
    typeof value.text === "string" &&
    typeof value.start === "number" &&
    typeof value.end === "number" &&
    typeof value.confidence === "number" &&
    typeof value.uncertain === "boolean" &&
    Array.isArray(value.words)
  );
}

function isFs1Result(value: unknown): value is Fs1Result {
  if (
    !isRecord(value) ||
    typeof value.analysis_version !== "string" ||
    typeof value.duration !== "number" ||
    !Array.isArray(value.lyric_lines) ||
    !value.lyric_lines.every(isLyricLine) ||
    !Array.isArray(value.chord_events) ||
    !Array.isArray(value.warnings) ||
    !isRecord(value.song_sheet) ||
    typeof value.song_sheet.id !== "string" ||
    !Array.isArray(value.song_sheet.chordsUsed) ||
    !Array.isArray(value.song_sheet.sections) ||
    !value.song_sheet.sections.every(isSection)
  ) {
    return false;
  }
  return isRecord(value.model_info) && isCapability(value.model_info.demucs) && isCapability(value.model_info.whisper) && isCapability(value.model_info.ffmpeg);
}

export function isFs1Job(value: unknown): value is Fs1Job {
  if (!isRecord(value) || typeof value.job_id !== "string" || typeof value.progress !== "number") return false;
  const statuses: Fs1JobStatus[] = ["queued", "validating", "separating", "transcribing", "detecting_chords", "aligning", "complete", "failed", "cancelled"];
  if (!statuses.includes(value.status as Fs1JobStatus)) return false;
  if (!(value.result === null || isFs1Result(value.result))) return false;
  if (!(value.error === null || (isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string"))) return false;
  return true;
}

const FS1_TERMINAL = new Set<Fs1JobStatus>(["complete", "failed", "cancelled"]);

export function isFs1Terminal(status: Fs1JobStatus): boolean {
  return FS1_TERMINAL.has(status);
}

export async function getFs1Capabilities(signal?: AbortSignal): Promise<Fs1Capability[]> {
  let response: Response;
  try {
    response = await fetch(`${getFs1ApiUrl()}/capabilities`, { signal, headers: { Accept: "application/json" } });
  } catch {
    if (signal?.aborted) throw new Fs1ApiError("Full-song analysis cancelled.", { code: "cancelled", cancelled: true });
    throw new Fs1ApiError("Couldn't reach the full-song worker. Is it running?", { code: "network_error" });
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Fs1ApiError("The full-song worker did not answer.", { code: "capabilities_failed", statusCode: response.status });
  if (!isRecord(payload) || !Array.isArray(payload.capabilities) || !payload.capabilities.every(isCapability)) {
    throw new Fs1ApiError("The worker capabilities response was invalid.", { code: "invalid_response" });
  }
  return payload.capabilities;
}

/**
 * Creates a full-song job. The worker requires `authorised=true` — the app only
 * sends it after the user confirms the audio is theirs / they may process it.
 */
export async function createFullSongJob(
  file: File,
  authorised: boolean,
  title: string | null,
  signal?: AbortSignal,
): Promise<Fs1Job> {
  const form = new FormData();
  form.append("authorised", authorised ? "true" : "false");
  if (title) form.append("title", title);
  form.append("file", file, file.name);
  let response: Response;
  try {
    response = await fetch(`${getFs1ApiUrl()}/v1/full-song/jobs`, {
      method: "POST",
      body: form,
      signal,
      headers: { Accept: "application/json" },
    });
  } catch {
    if (signal?.aborted) throw new Fs1ApiError("Full-song analysis cancelled.", { code: "cancelled", cancelled: true });
    throw new Fs1ApiError("Couldn't reach the full-song worker. Is it running?", { code: "network_error" });
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Fs1ApiError(
      isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string" ? payload.error.message : "The upload was rejected.",
      {
        code: isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === "string" ? payload.error.code : "request_failed",
        statusCode: response.status,
        backendCode: isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === "string" ? payload.error.code : undefined,
        backendMessage: isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string" ? payload.error.message : undefined,
      },
    );
  }
  if (!isFs1Job(payload)) throw new Fs1ApiError("The full-song worker returned an invalid job.", { code: "invalid_response" });
  return payload;
}

export async function getFullSongJob(jobId: string, signal?: AbortSignal): Promise<Fs1Job> {
  let response: Response;
  try {
    response = await fetch(`${getFs1ApiUrl()}/v1/full-song/jobs/${encodeURIComponent(jobId)}`, { signal, headers: { Accept: "application/json" } });
  } catch {
    if (signal?.aborted) throw new Fs1ApiError("Full-song analysis cancelled.", { code: "cancelled", cancelled: true });
    throw new Fs1ApiError("Couldn't reach the full-song worker.", { code: "network_error" });
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new Fs1ApiError("The full-song job status could not be fetched.", { code: "job_fetch_failed", statusCode: response.status });
  if (!isFs1Job(payload)) throw new Fs1ApiError("The full-song job status was invalid.", { code: "invalid_response" });
  return payload;
}

export async function cancelFullSongJob(jobId: string, signal?: AbortSignal): Promise<void> {
  try {
    await fetch(`${getFs1ApiUrl()}/v1/full-song/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", signal, headers: { Accept: "application/json" } });
  } catch (error) {
    if (signal?.aborted) throw new Fs1ApiError("Full-song analysis cancelled.", { code: "cancelled", cancelled: true });
    // Swallow network errors during best-effort cancellation; polling will surface terminal state.
    void error;
  }
}

/**
 * Polls a full-song job until it reaches a terminal state or the given timeout.
 * Resolves with the final job. Rejects with {@link Fs1ApiError} on timeout or cancel.
 */
export function pollFullSongJob(jobId: string, signal?: AbortSignal, timeoutMs: number = FS1_JOB_TIMEOUT_MS): Promise<Fs1Job> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const started = Date.now();
    let timer: ReturnType<typeof setInterval> | null = null;

    const finish = (job?: Fs1Job, error?: Fs1ApiError) => {
      if (timer !== null) clearInterval(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else if (job) resolve(job);
    };

    const onAbort = () => {
      finish(undefined, new Fs1ApiError("Full-song analysis cancelled.", { code: "cancelled", cancelled: true }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const tick = async () => {
      if (Date.now() - started >= timeoutMs && !timedOut) {
        timedOut = true;
        finish(undefined, new Fs1ApiError("The full-song analysis took too long and timed out.", { code: "timeout" }));
        return;
      }
      try {
        const job = await getFullSongJob(jobId, signal);
        if (isFs1Terminal(job.status)) {
          finish(job);
        }
      } catch (error) {
        if (error instanceof Fs1ApiError && error.cancelled) finish(undefined, error);
        // Other fetch errors are transient: keep polling until the timeout.
        void error;
      }
    };

    timer = setInterval(() => {
      void tick();
    }, FS1_POLL_INTERVAL_MS);
    void tick();
  });
}

export function fs1StageLabel(status: Fs1JobStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "validating":
      return "Decoding audio";
    case "separating":
      return "Separating vocals";
    case "transcribing":
      return "Transcribing lyrics";
    case "detecting_chords":
      return "Detecting chords";
    case "aligning":
      return "Aligning chords";
    case "complete":
      return "Complete";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Working";
  }
}