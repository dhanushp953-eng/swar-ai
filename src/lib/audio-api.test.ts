import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AudioApiError,
  type AnalysisJob,
  getAudioApiUrl,
  isAnalysisJob,
  mapJobStatus,
  uploadAudio,
  validateAudioFile,
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
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  response = FakeXmlHttpRequest.responsePayload;
  responseType = "";
  status = FakeXmlHttpRequest.responseStatus;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  body: FormData | null = null;
  open() {}
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
  it("sends multipart data, authorization, and upload progress", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
    const progress: number[] = [];
    const controller = new AbortController();
    const result = await uploadAudio(new File([new Uint8Array([1])], "voice.wav"), controller.signal, (value) => progress.push(value));
    expect(result).toEqual(validJob);
    expect(progress).toEqual([50]);
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

  it("surfaces safe backend validation errors", async () => {
    FakeXmlHttpRequest.responseStatus = 413;
    FakeXmlHttpRequest.responsePayload = JSON.stringify({ error: { code: "file_too_large", message: "The uploaded audio file exceeds the configured size limit." } });
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
    const request = uploadAudio(new File([new Uint8Array([1])], "voice.wav"), new AbortController().signal, () => undefined);
    await expect(request).rejects.toMatchObject({ code: "file_too_large", statusCode: 413 });
    FakeXmlHttpRequest.responseStatus = 201;
    FakeXmlHttpRequest.responsePayload = JSON.stringify(validJob);
  });

  it("turns transport failures into a safe network error", async () => {
    class NetworkXmlHttpRequest extends FakeXmlHttpRequest {
      send(body: FormData) {
        this.body = body;
        this.onerror?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", NetworkXmlHttpRequest);
    const request = uploadAudio(new File([new Uint8Array([1])], "voice.wav"), new AbortController().signal, () => undefined);
    await expect(request).rejects.toMatchObject({ code: "network_error" });
  });
});
