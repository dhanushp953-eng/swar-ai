import { resolveServiceBaseUrl } from "./service-url";

export const SUPPORTED_AUDIO_EXTENSIONS = ["wav", "mp3", "m4a", "ogg"] as const;
export const SUPPORTED_AUDIO_LABEL = "WAV, MP3, M4A or OGG";
export const DEFAULT_MAX_UPLOAD_BYTES = 4_000_000;
/**
 * Bounds the entire analysis round-trip (file upload + backend processing + any
 * status polling) in the browser. The backend analyses audio synchronously
 * inside the POST, so a single clip can take tens of seconds — and on Vercel a
 * cold function start plus librosa warm-up can add more. 240 s is a safe ceiling
 * that still fails fast if FastAPI is unreachable or wedged, while comfortably
 * covering cold-start analysis now that the server function allows up to 300 s.
 */
export const ANALYSIS_TIMEOUT_MS = 240_000;
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

/** Rate used when re-encoding audio to a canonical WAV before upload. */
export const NORMALIZED_SAMPLE_RATE = 22050;

/**
 * Encodes mono float samples into a 16-bit PCM WAV (standard WAVE_FORMAT_PCM,
 * not WAVE_FORMAT_EXTENSIBLE) so the analysis backend's strict `wave`-based
 * validation accepts it. The backend resamples to its own rate regardless.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  for (let offset = 44; offset < buffer.byteLength; offset += 2) {
    const sample = samples[(offset - 44) / 2];
    const clamped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

/**
 * Decodes any browser-supported audio file and re-encodes it to a canonical
 * 16-bit PCM mono WAV. This avoids server-side upload/rejection for WAVs the
 * backend can't validate (e.g. WAVE_FORMAT_EXTENSIBLE, 24-bit, or files sent
 * with a generic MIME type) and for codecs the server lacks (ffmpeg is off on
 * Vercel). Throws an {@link AudioApiError} with a user-facing message if the
 * browser cannot decode the file.
 */
export async function normalizeAudioToWav(file: File, targetRate: number = NORMALIZED_SAMPLE_RATE): Promise<File> {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new AudioApiError("Web Audio is not supported in this browser.", { code: "audio_unsupported" });
  const arrayBuffer = await file.arrayBuffer();
  const context = new AudioCtx();
  try {
    const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    const channels = decoded.numberOfChannels;
    const length = decoded.length;
    const mono = new Float32Array(length);
    for (let channel = 0; channel < channels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
    }
    const wav = encodeWav(mono, targetRate);
    const baseName = (file.name.replace(/\.[^.]+$/, "") || "audio").replace(/[^\w.-]/g, "_");
    return new File([wav], `${baseName}.wav`, { type: "audio/wav" });
  } catch (error) {
    if (error instanceof AudioApiError) throw error;
    throw new AudioApiError("This audio could not be read by your browser. Export it as a standard WAV or MP3 and try again.", { code: "decode_failed" });
  } finally {
    void context.close().catch(() => {});
  }
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
        if (timedOut) reject(new AudioApiError("The analysis server timed out. Please retry once.", { code: "timeout" }));
        else if (signal.aborted || controller.signal.aborted) reject(new AudioApiError("Analysis cancelled.", { code: "cancelled", cancelled: true }));
        else if (error instanceof AudioApiError) reject(error);
        else reject(new AudioApiError("The analysis server timed out. Please retry once.", { code: "network_error" }));
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
      reject(new AudioApiError("The analysis server timed out. Please retry once.", { code: "network_error" }));
    };
    xhr.ontimeout = () => {
      finish();
      reject(new AudioApiError("The analysis server timed out. Please retry once.", { code: "timeout" }));
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

/**
 * Bounded wait for the backend to be reachable before an upload. A health
 * response with HTTP 200 and `status: "ok"` is treated as ready immediately,
 * regardless of the `warmup` field: the warm-up only reflects whether the
 * analysis engine has finished priming, and the actual `/api/analyze` request
 * warms it the rest of the way. Blocking on `warmup` here previously stalled
 * the UI at "Starting analysis service…" for the full `maxWaitMs` while the
 * real upload (which works) was never sent. The wait is capped by `maxWaitMs`
 * so the UI never truly hangs, and the caller cancels it via the signal.
 */
export const BACKEND_START_POLL_MS = 3000;
export const BACKEND_START_MAX_WAIT_MS = 180_000;

/**
 * Deployment-only ceiling for the cold-start wait. Render (and similar PaaS)
 * Free tiers can take well over a minute to spin a spun-down service back up,
 * so the default is generous. It can be tuned per deployment via
 * NEXT_PUBLIC_BACKEND_START_MAX_WAIT_MS (milliseconds) without a code change.
 */
function resolveBackendStartMaxWaitMs(): number {
  const configured = Number(process.env.NEXT_PUBLIC_BACKEND_START_MAX_WAIT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : BACKEND_START_MAX_WAIT_MS;
}

export type BackendReadiness = "ready" | "warming" | "failed" | "unavailable";

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchBackendReadiness(signal: AbortSignal): Promise<BackendReadiness> {
  try {
    const response = await fetch(`${getAudioApiUrl()}/health`, {
      method: "GET",
      signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return "unavailable";
    const payload = (await response.json().catch(() => null)) as {
      status?: string;
      warmup?: string;
    } | null;
    // HTTP 200 + status:"ok" means the backend is serving and can accept the
    // upload right now. Do NOT block on `warmup`: the live /api/analyze request
    // is what finishes warming the engine, so send it immediately.
    if (payload?.status === "ok") return "ready";
    const warmup = payload?.warmup;
    if (warmup === "warming") return "warming";
    if (warmup === "failed") return "failed";
    return "ready";
  } catch (error) {
    if (signal.aborted) throw error;
    return "unavailable";
  }
}

export async function waitForBackendReady(
  signal: AbortSignal,
  options: { pollMs?: number; maxWaitMs?: number } = {},
): Promise<void> {
  const pollMs = options.pollMs ?? BACKEND_START_POLL_MS;
  const maxWaitMs = options.maxWaitMs ?? resolveBackendStartMaxWaitMs();
  const deadline = Date.now() + maxWaitMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    let readiness: BackendReadiness;
    try {
      readiness = await fetchBackendReadiness(signal);
    } catch (error) {
      if (signal.aborted) throw error;
      readiness = "unavailable";
    }
    if (readiness === "ready" || readiness === "failed") return;
    if (Date.now() >= deadline) {
      throw new AudioApiError("The analysis service is still starting. Try again in a moment.", { code: "backend_start_timeout" });
    }
    await abortableDelay(pollMs, signal);
  }
}
