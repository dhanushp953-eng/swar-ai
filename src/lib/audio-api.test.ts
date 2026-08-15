import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AudioApiError,
  type AnalysisJob,
  ANALYSIS_TIMEOUT_MS,
  encodeWav,
  getAudioApiUrl,
  isAnalysisJob,
  mapJobStatus,
  normalizeAudioToWav,
  uploadAudio,
  validateAudioFile,
  waitForBackendReady,
} from "./audio-api";

const validJob: AnalysisJob = {
  job_id: "job-1",
  status: "completed",
  progress: 100,
  result: null,
  error: null,
  duration: 2,
  estimated_bpm: 120,
  beat_timestamps: [0.1, 0.6],
  rhythm_confidence: 0.9,
  warnings: [],
  analysis_engine: "librosa.beat.beat_track",
  analysis_version: "3.0.0",
  note_events: [{ id: "melody-note-0001", midi_note: 69, note_name: "A4", start_time: 0, duration: 1, velocity: 100, confidence: 0.9, hand: null, finger: null }],
  melody_confidence: 0.9,
  melody_engine: "librosa.pyin",
  melody_analysis_version: "3.1.0",
};

class FakeXmlHttpRequest {
  static responsePayload = JSON.stringify(validJob);
  static responseStatus = 201;
  static responseHeaders: Record<string, string> = {};
  static lastHeaders: Record<string, string> | null = null;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  response = FakeXmlHttpRequest.responsePayload;
  responseType = "";
  status = FakeXmlHttpRequest.responseStatus;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  body: FormData | null = null;
  headers: Record<string, string> = {};
  open() {}
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
    FakeXmlHttpRequest.lastHeaders = this.headers;
  }
  getResponseHeader(name: string): string | null {
    return FakeXmlHttpRequest.responseHeaders[name.toLowerCase()] ?? null;
  }
  send(body: FormData) {
    this.body = body;
    this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
    this.onload?.();
  }
  abort() {
    this.onabort?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_AUDIO_MAX_UPLOAD_BYTES;
  delete process.env.NEXT_PUBLIC_AUDIO_API_URL;
  delete process.env.NEXT_PUBLIC_BACKEND_START_MAX_WAIT_MS;
});

describe("audio API validation", () => {
  it("accepts supported audio and rejects unsupported or oversized files", () => {
    const audio = new File([new Uint8Array([1, 2, 3])], "voice.wav", { type: "audio/wav" });
    expect(validateAudioFile(audio)).toBeNull();
    expect(validateAudioFile(new File([new Uint8Array([1])], "voice.txt"))).toContain("Unsupported");
    process.env.NEXT_PUBLIC_AUDIO_MAX_UPLOAD_BYTES = "2";
    expect(validateAudioFile(audio)).toContain("larger");
  });

  it("validates returned job shape before using note events", () => {
    expect(isAnalysisJob(validJob)).toBe(true);
    expect(isAnalysisJob({ ...validJob, note_events: [{ midi_note: 69 }] })).toBe(false);
    expect(isAnalysisJob({ ...validJob, status: "unknown" })).toBe(false);
  });

  it("maps backend states and uses the configured local URL", () => {
    process.env.NEXT_PUBLIC_AUDIO_API_URL = "http://localhost:9000";
    expect(getAudioApiUrl()).toBe("http://localhost:9000");
    expect(mapJobStatus("validated")).toBe("validating");
    expect(mapJobStatus("processing")).toBe("processing");
    expect(mapJobStatus("completed")).toBe("completed");
    expect(mapJobStatus("failed")).toBe("failed");
  });
});

describe("audio upload transport", () => {
  afterEach(() => {
    FakeXmlHttpRequest.responseStatus = 201;
    FakeXmlHttpRequest.responsePayload = JSON.stringify(validJob);
    FakeXmlHttpRequest.responseHeaders = {};
    FakeXmlHttpRequest.lastHeaders = null;
  });

  it("sends multipart data, authorization, a generated X-Request-ID, and upload progress", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
    const progress: number[] = [];
    const controller = new AbortController();
    const result = await uploadAudio(new File([new Uint8Array([1])], "voice.wav"), controller.signal, (value) => progress.push(value));
    expect(result).toEqual(validJob);
    expect(progress).toEqual([50]);
    const sent = FakeXmlHttpRequest.lastHeaders ?? {};
    expect(typeof sent["X-Request-ID"]).toBe("string");
    expect(sent["X-Request-ID"]!.length).toBeGreaterThan(0);
  });

  it("rejects cancellation without exposing a network error", async () => {
    class PendingXmlHttpRequest extends FakeXmlHttpRequest {
      send(body: FormData) {
        this.body = body;
      }
    }
    vi.stubGlobal("XMLHttpRequest", PendingXmlHttpRequest);
    const controller = new AbortController();
    const request = uploadAudio(new File([new Uint8Array([1])], "voice.wav"), controller.signal, () => undefined);
    controller.abort();
    await expect(request).rejects.toMatchObject({ cancelled: true, code: "cancelled" });
    expect(new AudioApiError("x").message).toBe("x");
  });

  it("surfaces safe backend validation errors with status, code, message, and x-vercel-id", async () => {
    FakeXmlHttpRequest.responseStatus = 413;
    FakeXmlHttpRequest.responsePayload = JSON.stringify({ error: { code: "file_too_large", message: "The uploaded audio file exceeds the configured size limit." } });
    FakeXmlHttpRequest.responseHeaders = { "x-vercel-id": "iad1::abc123" };
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
    const request = uploadAudio(new File([new Uint8Array([1])], "voice.wav"), new AbortController().signal, () => undefined);
    await expect(request).rejects.toMatchObject({
      code: "file_too_large",
      statusCode: 413,
      backendCode: "file_too_large",
      backendMessage: "The uploaded audio file exceeds the configured size limit.",
      vercelId: "iad1::abc123",
    });
  });

  it("captures the backend code, message, status, and x-vercel-id on an analysis failure", async () => {
    FakeXmlHttpRequest.responseStatus = 422;
    FakeXmlHttpRequest.responsePayload = JSON.stringify({ error: { code: "analysis_failed", message: "The audio could not be analyzed." } });
    FakeXmlHttpRequest.responseHeaders = { "x-vercel-id": "iad1::fail-1" };
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
    const request = uploadAudio(new File([new Uint8Array([1])], "voice.wav"), new AbortController().signal, () => undefined);
    await expect(request).rejects.toMatchObject({
      code: "analysis_failed",
      statusCode: 422,
      backendCode: "analysis_failed",
      backendMessage: "The audio could not be analyzed.",
      vercelId: "iad1::fail-1",
      statusZero: false,
    });
  });

  it("turns transport failures into a network error distinct from a timeout", async () => {
    class NetworkXmlHttpRequest extends FakeXmlHttpRequest {
      send(body: FormData) {
        this.body = body;
        this.onerror?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", NetworkXmlHttpRequest);
    const request = uploadAudio(new File([new Uint8Array([1])], "voice.wav"), new AbortController().signal, () => undefined);
    await expect(request).rejects.toMatchObject({ code: "network_error", statusZero: true, message: "Couldn't reach the analysis server. Check your connection and retry." });
  });

  it("surfaces a timeout as a retryable timeout error, not a network error", async () => {
    class TimeoutXmlHttpRequest extends FakeXmlHttpRequest {
      send(body: FormData) {
        this.body = body;
        this.ontimeout?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", TimeoutXmlHttpRequest);
    const request = uploadAudio(new File([new Uint8Array([1])], "voice.wav"), new AbortController().signal, () => undefined);
    await expect(request).rejects.toMatchObject({
      code: "timeout",
      message: "The analysis took too long and timed out. Please retry.",
    });
  });

  it("marks XHR status 0 (connection reset) as a network error, never a timeout", async () => {
    class ConnectionResetXmlHttpRequest extends FakeXmlHttpRequest {
      send(body: FormData) {
        this.body = body;
        this.status = 0;
        this.onerror?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", ConnectionResetXmlHttpRequest);
    const request = uploadAudio(new File([new Uint8Array([1])], "voice.wav"), new AbortController().signal, () => undefined);
    await expect(request).rejects.toMatchObject({ code: "network_error", statusZero: true });
  });

  it("does not auto-retry after a failure (caller must retry explicitly)", async () => {
    let sends = 0;
    class OnceXmlHttpRequest extends FakeXmlHttpRequest {
      send(body: FormData) {
        this.body = body;
        sends += 1;
        this.onerror?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", OnceXmlHttpRequest);
    const request = uploadAudio(new File([new Uint8Array([1])], "voice.wav"), new AbortController().signal, () => undefined);
    await expect(request).rejects.toMatchObject({ code: "network_error" });
    expect(sends).toBe(1);
  });
});

describe("analysis timeout budget", () => {
  it("allows the full analysis round-trip up to 240 seconds", () => {
    expect(ANALYSIS_TIMEOUT_MS).toBe(240_000);
  });
});

describe("backend cold-start readiness", () => {
  function jsonResponse(body: unknown, ok = true) {
    return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });
  }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_AUDIO_API_URL = "http://localhost:8000";
  });

  it("resolves immediately when the backend is ready", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ warmup: "ready", status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(waitForBackendReady(new AbortController().signal, { pollMs: 10, maxWaitMs: 1000 })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a failed warm-up as ready (JIT fallback still works)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ warmup: "failed" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(waitForBackendReady(new AbortController().signal, { pollMs: 10, maxWaitMs: 1000 })).resolves.toBeUndefined();
  });

  it("resolves immediately (no polling) when health is status ok while warmup is warming", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok", warmup: "warming" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(waitForBackendReady(new AbortController().signal, { pollMs: 10, maxWaitMs: 1000 })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves immediately (no polling) when health is status ok while warmup is failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok", warmup: "failed" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(waitForBackendReady(new AbortController().signal, { pollMs: 10, maxWaitMs: 1000 })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("polls while warming and resolves once ready", async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls += 1;
      return jsonResponse({ warmup: calls >= 3 ? "ready" : "warming" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(waitForBackendReady(new AbortController().signal, { pollMs: 5, maxWaitMs: 1000 })).resolves.toBeUndefined();
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("rejects with a safe timeout error if the service never starts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ warmup: "warming" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(waitForBackendReady(new AbortController().signal, { pollMs: 5, maxWaitMs: 50 })).rejects.toMatchObject({
      code: "backend_start_timeout",
    });
  });

  it("honors NEXT_PUBLIC_BACKEND_START_MAX_WAIT_MS when set", async () => {
    process.env.NEXT_PUBLIC_BACKEND_START_MAX_WAIT_MS = "60";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ warmup: "warming" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(waitForBackendReady(new AbortController().signal, { pollMs: 5 })).rejects.toMatchObject({
      code: "backend_start_timeout",
    });
  });

  it("aborts without hanging when the caller cancels", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ warmup: "warming" }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = waitForBackendReady(controller.signal, { pollMs: 20, maxWaitMs: 5000 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("audio normalization before upload", () => {
  class FakeAudioBuffer {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
    private channels: Float32Array[];
    constructor(channels: number, length: number, sampleRate: number, fill?: (channel: number, index: number) => number) {
      this.numberOfChannels = channels;
      this.length = length;
      this.sampleRate = sampleRate;
      this.channels = Array.from({ length: channels }, () => new Float32Array(length));
      if (fill) for (let c = 0; c < channels; c++) for (let i = 0; i < length; i++) this.channels[c][i] = fill(c, i);
    }
    getChannelData(channel: number): Float32Array {
      return this.channels[channel];
    }
  }

  class FakeAudioContext {
    async decodeAudioData(): Promise<FakeAudioBuffer> {
      return new FakeAudioBuffer(2, 4, 44100, (channel) => (channel === 0 ? 1 : 0));
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
  }

  function readWavHeader(buffer: ArrayBuffer) {
    const view = new DataView(buffer);
    const string = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(buffer.slice(offset, offset + length)));
    return {
      riff: string(0, 4),
      wave: string(8, 4),
      fmt: string(12, 4),
      audioFormat: view.getUint16(20, true),
      channels: view.getUint16(22, true),
      sampleRate: view.getUint32(24, true),
      bitsPerSample: view.getUint16(34, true),
      data: string(36, 4),
      dataSize: view.getUint32(40, true),
    };
  }

  it("encodeWav writes a standard 16-bit PCM mono WAV", () => {
    const samples = new Float32Array([0.5, -0.5, 0, 1]);
    const buffer = encodeWav(samples, 22050);
    const header = readWavHeader(buffer);
    expect(header.riff).toBe("RIFF");
    expect(header.wave).toBe("WAVE");
    expect(header.fmt).toBe("fmt ");
    expect(header.data).toBe("data");
    expect(header.audioFormat).toBe(1);
    expect(header.channels).toBe(1);
    expect(header.sampleRate).toBe(22050);
    expect(header.bitsPerSample).toBe(16);
    expect(header.dataSize).toBe(samples.length * 2);
  });

  it("normalizeAudioToWav re-encodes to a canonical WAV the server accepts", async () => {
    vi.stubGlobal("window", { AudioContext: FakeAudioContext });
    const file = new File([new Uint8Array([1, 2, 3])], "song.mp3", { type: "audio/mpeg" });
    vi.spyOn(file, "arrayBuffer").mockResolvedValue(new ArrayBuffer(8));
    const normalized = await normalizeAudioToWav(file);
    expect(normalized.type).toBe("audio/wav");
    expect(normalized.name).toBe("song.wav");
    const header = readWavHeader(await normalized.arrayBuffer());
    expect(header.audioFormat).toBe(1);
    expect(header.channels).toBe(1);
  });

  it("normalizeAudioToWav downmixes multi-channel audio to mono", async () => {
    vi.stubGlobal("window", { AudioContext: FakeAudioContext });
    const file = new File([new Uint8Array([1])], "clip.wav", { type: "audio/wav" });
    vi.spyOn(file, "arrayBuffer").mockResolvedValue(new ArrayBuffer(8));
    const normalized = await normalizeAudioToWav(file);
    const view = new DataView(await normalized.arrayBuffer());
    // First mono sample is the (ch0 + ch1) / 2 average of the source: (1 + 0) / 2 = 0.5.
    // Assert within rounding tolerance rather than an exact integer.
    const firstSample = view.getInt16(44, true);
    expect(firstSample).toBeGreaterThan(16000);
    expect(firstSample).toBeLessThan(16800);
  });

  it("normalizeAudioToWav reports a clear error when the browser cannot decode", async () => {
    class RejectingAudioContext {
      async decodeAudioData(): Promise<FakeAudioBuffer> {
        throw new Error("nope");
      }
      close(): Promise<void> {
        return Promise.resolve();
      }
    }
    vi.stubGlobal("window", { AudioContext: RejectingAudioContext });
    const file = new File([new Uint8Array([1])], "clip.wav", { type: "audio/wav" });
    vi.spyOn(file, "arrayBuffer").mockResolvedValue(new ArrayBuffer(8));
    await expect(normalizeAudioToWav(file)).rejects.toMatchObject({ code: "decode_failed" });
  });

  it("normalizeAudioToWav errors when Web Audio is unavailable", async () => {
    vi.stubGlobal("window", {});
    const file = new File([new Uint8Array([1])], "clip.wav", { type: "audio/wav" });
    vi.spyOn(file, "arrayBuffer").mockResolvedValue(new ArrayBuffer(8));
    await expect(normalizeAudioToWav(file)).rejects.toMatchObject({ code: "audio_unsupported" });
  });
});
