import { resolveServiceBaseUrl } from "./service-url";

export const SUPPORTED_AUDIO_EXTENSIONS = ["wav", "mp3", "m4a", "ogg"] as const;
export const SUPPORTED_AUDIO_LABEL = "WAV, MP3, M4A or OGG";
export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/**
 * Bounds the entire analysis round-trip (file upload + backend processing + any
 * status polling) in the browser. The backend analyses audio synchronously
 * inside the POST, so a single 345 KB clip can take tens of seconds; 120 s is a
 * safe ceiling that still fails fast if FastAPI is unreachable or wedged.
 */
export const ANALYSIS_TIMEOUT_MS = 120_000;
export const POLL_INTERVAL_MS = 900;

export type SupportedAudioExtension = (typeof SUPPORTED_AUDIO_EXTENSIONS)[number];
export type JobStatus = "queued" | "processing" | "validated" | "pending_analysis" | "completed" | "failed" | "cancelled";

export type MelodyNoteEvent = {
  id: string;
  midi_note: number;
  note_name: string;
  start_time: number;
  duration: number;
  velocity: number;
  confidence: number;
  hand: "left" | "right" | null;
  finger: 1 | 2 | 3 | 4 | 5 | null;
};

export type BackendError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type AnalysisJob = {
  job_id: string;
  status: JobStatus;
  progress: number;
  result: unknown | null;
  error: BackendError | null;
  duration: number | null;
  estimated_bpm: number | null;
  beat_timestamps: number[];
  rhythm_confidence: number | null;
  warnings: string[];
  analysis_engine: string | null;
  analysis_version: string | null;
  note_events: MelodyNoteEvent[];
  melody_confidence: number | null;
  melody_engine: string | null;
  melody_analysis_version: string | null;
};

export type UploadProgressHandler = (progress: number) => void;

export class AudioApiError extends Error {
  readonly code: string;
  readonly statusCode: number | null;
  readonly cancelled: boolean;

  constructor(message: string, options: { code?: string; statusCode?: number | null; cancelled?: boolean } = {}) {
    super(message);
    this.name = "AudioApiError";
    this.code = options.code ?? "audio_api_error";
    this.statusCode = options.statusCode ?? null;
    this.cancelled = options.cancelled ?? false;
  }
}

export function getAudioApiUrl(): string {
  return resolveServiceBaseUrl(process.env.NEXT_PUBLIC_AUDIO_API_URL);
}

export function getMaxUploadBytes(): number {
  const configured = Number(process.env.NEXT_PUBLIC_AUDIO_MAX_UPLOAD_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_UPLOAD_BYTES;
}

export function getFileExtension(fileName: string): string {
  return fileName.trim().toLowerCase().split(".").pop() ?? "";
}

export function validateAudioFile(file: File | null): string | null {
  if (!file) return "Choose an audio file to continue.";
  const extension = getFileExtension(file.name);
  if (!SUPPORTED_AUDIO_EXTENSIONS.includes(extension as SupportedAudioExtension)) {
    return `Unsupported format. Use ${SUPPORTED_AUDIO_LABEL}.`;
  }
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > getMaxUploadBytes()) return `This file is larger than the configured ${formatBytes(getMaxUploadBytes())} limit.`;
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Not available";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isMelodyNoteEvent(value: unknown): value is MelodyNoteEvent {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.midi_note === "number" && typeof value.note_name === "string" && typeof value.start_time === "number" && typeof value.duration === "number" && typeof value.velocity === "number" && typeof value.confidence === "number" && (value.hand === null || value.hand === "left" || value.hand === "right") && (value.finger === null || [1, 2, 3, 4, 5].includes(value.finger as number));
}

export function isAnalysisJob(value: unknown): value is AnalysisJob {
  if (!isRecord(value)) return false;
  const statuses: JobStatus[] = ["queued", "processing", "validated", "pending_analysis", "completed", "failed", "cancelled"];
  return typeof value.job_id === "string" && statuses.includes(value.status as JobStatus) && typeof value.progress === "number" && (value.result === null || "result" in value) && (value.error === null || isRecord(value.error)) && isNullableNumber(value.duration) && isNullableNumber(value.estimated_bpm) && Array.isArray(value.beat_timestamps) && value.beat_timestamps.every((item) => typeof item === "number" && Number.isFinite(item)) && Array.isArray(value.warnings) && value.warnings.every((item) => typeof item === "string") && (value.analysis_engine === null || typeof value.analysis_engine === "string") && (value.analysis_version === null || typeof value.analysis_version === "string") && Array.isArray(value.note_events) && value.note_events.every(isMelodyNoteEvent) && isNullableNumber(value.melody_confidence) && (value.melody_engine === null || typeof value.melody_engine === "string") && (value.melody_analysis_version === null || typeof value.melody_analysis_version === "string");
}

export function mapJobStatus(status: JobStatus): "ready" | "uploading" | "validating" | "processing" | "completed" | "failed" | "cancelled" {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "validated") return "validating";
  if (status === "processing" || status === "pending_analysis" || status === "queued") return "processing";
  return "cancelled";
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") return payload.error.message;
  return fallback;
}

function validateResponse(payload: unknown): AnalysisJob {
  if (!isAnalysisJob(payload)) throw new AudioApiError("The analysis response was invalid.", { code: "invalid_response" });
  return payload;
}

function requestJson(path: string, signal: AbortSignal): Promise<AnalysisJob> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ANALYSIS_TIMEOUT_MS);
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    fetch(`${getAudioApiUrl()}${path}`, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) throw new AudioApiError(getErrorMessage(payload, "The analysis request failed."), { statusCode: response.status, code: isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === "string" ? payload.error.code : "request_failed" });
        resolve(validateResponse(payload));
      })
      .catch((error: unknown) => {
        if (timedOut) reject(new AudioApiError("The analysis request timed out. Try again.", { code: "timeout" }));
        else if (signal.aborted || controller.signal.aborted) reject(new AudioApiError("Analysis cancelled.", { code: "cancelled", cancelled: true }));
        else if (error instanceof AudioApiError) reject(error);
        else reject(new AudioApiError("The analysis service could not be reached.", { code: "network_error" }));
      })
      .finally(() => {
        globalThis.clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      });
  });
}

export function uploadAudio(file: File, signal: AbortSignal, onProgress: UploadProgressHandler): Promise<AnalysisJob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timedOut = false;
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      xhr.abort();
    }, ANALYSIS_TIMEOUT_MS);
    const abort = () => xhr.abort();
    const finish = () => {
      globalThis.clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    };
    xhr.open("POST", `${getAudioApiUrl()}/api/analyze`);
    xhr.responseType = "text";
    xhr.timeout = ANALYSIS_TIMEOUT_MS;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      const payload = xhr.response ? parseJson(xhr.response) : null;
      finish();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new AudioApiError(getErrorMessage(payload, "The audio could not be analysed."), { statusCode: xhr.status, code: isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === "string" ? payload.error.code : "upload_failed" }));
        return;
      }
      try {
        resolve(validateResponse(payload));
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => {
      finish();
      reject(new AudioApiError("The analysis service could not be reached.", { code: "network_error" }));
    };
    xhr.ontimeout = () => {
      finish();
      reject(new AudioApiError("The upload timed out. Try again.", { code: "timeout" }));
    };
    xhr.onabort = () => {
      finish();
      reject(timedOut ? new AudioApiError("The upload timed out. Try again.", { code: "timeout" }) : new AudioApiError("Analysis cancelled.", { code: "cancelled", cancelled: true }));
    };
    signal.addEventListener("abort", abort, { once: true });
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("authorized", "true");
    xhr.send(formData);
  });
}

export async function getAnalysisJob(jobId: string, signal: AbortSignal): Promise<AnalysisJob> {
  return requestJson(`/api/jobs/${encodeURIComponent(jobId)}`, signal);
}

export async function pollAnalysisJob(jobId: string, signal: AbortSignal, onUpdate: (job: AnalysisJob) => void): Promise<AnalysisJob> {
  let job = await getAnalysisJob(jobId, signal);
  onUpdate(job);
  while (job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled") {
    await new Promise<void>((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, POLL_INTERVAL_MS);
      const abort = () => {
        globalThis.clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        reject(new AudioApiError("Analysis cancelled.", { code: "cancelled", cancelled: true }));
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    });
    job = await getAnalysisJob(jobId, signal);
    onUpdate(job);
  }
  return job;
}
