import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelFullSongJob,
  createFullSongJob,
  fs1StageLabel,
  getFs1ApiUrl,
  getFs1MaxUploadBytes,
  getFullSongJob,
  isFs1Job,
  isFs1Terminal,
  pollFullSongJob,
  validateFs1AudioFile,
  type Fs1Job,
} from "./fs1-api";

function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(handler));
}

const COMPLETE_JOB: Fs1Job = {
  job_id: "job-1",
  status: "complete",
  progress: 100,
  result: {
    analysis_version: "fs1.0.0",
    duration: 16,
    language: "en",
    language_confidence: 0.5,
    bpm: 136,
    beat_source: "percussive",
    lyric_words: [],
    lyric_lines: [],
    chord_events: [],
    chord_anchors: [],
    song_sheet: {
      id: "job-1",
      metadata: { title: "Song" },
      chordsUsed: ["C"],
      sections: [],
    },
    warnings: [],
    model_info: {
      demucs: { name: "demucs", available: true },
      whisper: { name: "whisper", available: true },
      ffmpeg: { name: "ffmpeg", available: true },
    },
    processing_time_seconds: 3.2,
  },
  error: null,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_FS1_API_URL;
  delete process.env.NEXT_PUBLIC_FS1_MAX_UPLOAD_BYTES;
});

describe("fs1-api", () => {
  it("resolves the FS1 worker base URL (default port 8088)", () => {
    expect(getFs1ApiUrl()).toBe("http://localhost:8088");
  });

  it("honours the configured FS1 worker URL", () => {
    process.env.NEXT_PUBLIC_FS1_API_URL = "http://localhost:9000";
    expect(getFs1ApiUrl()).toBe("http://localhost:9000");
  });

  it("honours a configured upload limit", () => {
    process.env.NEXT_PUBLIC_FS1_MAX_UPLOAD_BYTES = "123456";
    expect(getFs1MaxUploadBytes()).toBe(123456);
  });

  it("validates supported audio files", () => {
    const file = new File(["x"], "song.mp3", { type: "audio/mpeg" });
    expect(validateFs1AudioFile(file)).toBeNull();
    const unsupported = new File(["x"], "song.flac", { type: "audio/flac" });
    expect(validateFs1AudioFile(unsupported)).toContain("Unsupported format");
    expect(validateFs1AudioFile(null)).toContain("Choose an audio file");
  });

  it("creates a job with authorised=true and the file", async () => {
    stubFetch(async (input, init) => {
      expect(String(input)).toContain("/v1/full-song/jobs");
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);
      const form = body as FormData;
      expect(form.get("authorised")).toBe("true");
      expect(form.get("title")).toBe("My Song");
      const file = form.get("file") as File;
      expect(file.name).toBe("song.mp3");
      return jsonResponse({ job_id: "job-1", status: "queued", progress: 0, result: null, error: null });
    });
    const job = await createFullSongJob(new File(["x"], "song.mp3"), true, "My Song");
    expect(job.job_id).toBe("job-1");
    expect(job.status).toBe("queued");
  });

  it("maps worker rejection errors into Fs1ApiError", async () => {
    stubFetch(async () =>
      jsonResponse({ error: { code: "authorization_required", message: "Confirm authorisation." } }, 403),
    );
    await expect(createFullSongJob(new File(["x"], "song.mp3"), false, null)).rejects.toMatchObject({
      name: "Fs1ApiError",
      code: "authorization_required",
      statusCode: 403,
    });
  });

  it("throws network_error when the worker is unreachable", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(createFullSongJob(new File(["x"], "song.mp3"), true, null)).rejects.toMatchObject({
      code: "network_error",
    });
  });

  it("fetches a job", async () => {
    stubFetch(async () => jsonResponse(COMPLETE_JOB));
    const job = await getFullSongJob("job-1");
    expect(job.status).toBe("complete");
    expect(job.result?.song_sheet.chordsUsed).toEqual(["C"]);
  });

  it("recognises terminal statuses", () => {
    expect(isFs1Terminal("complete")).toBe(true);
    expect(isFs1Terminal("failed")).toBe(true);
    expect(isFs1Terminal("cancelled")).toBe(true);
    expect(isFs1Terminal("transcribing")).toBe(false);
  });

  it("validates job shape with isFs1Job", () => {
    expect(isFs1Job(COMPLETE_JOB)).toBe(true);
    expect(isFs1Job({ ...COMPLETE_JOB, status: "not-a-status" })).toBe(false);
    expect(isFs1Job(null)).toBe(false);
  });

  it("polls until completion", async () => {
    const responses = [
      { job_id: "job-1", status: "separating", progress: 20, result: null, error: null },
      { job_id: "job-1", status: "transcribing", progress: 50, result: null, error: null },
      COMPLETE_JOB,
    ];
    stubFetch(async () => jsonResponse(responses.shift() ?? COMPLETE_JOB));
    const job = await pollFullSongJob("job-1", undefined, 60000);
    expect(job.status).toBe("complete");
  });

  it("polls until failure", async () => {
    const failed: Fs1Job = { job_id: "job-2", status: "failed", progress: 100, result: null, error: { code: "decode_failed", message: "bad" } };
    stubFetch(async () => jsonResponse(failed));
    const job = await pollFullSongJob("job-2");
    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("decode_failed");
  });

  it("cancels a job via DELETE", async () => {
    const deleteSpy = vi.fn(async () => jsonResponse({ job_id: "job-1", status: "cancelled", progress: 0, result: null, error: null }));
    stubFetch(deleteSpy);
    await cancelFullSongJob("job-1");
    const [input, init] = deleteSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(input)).toContain("/v1/full-song/jobs/job-1");
    expect(init.method).toBe("DELETE");
  });

  it("times out after the configured ceiling", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    stubFetch(async () => jsonResponse({ job_id: "job-1", status: "queued", progress: 0, result: null, error: null }));
    const promise = pollFullSongJob("job-1", controller.signal, 100);
    const assertion = expect(promise).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    vi.useRealTimers();
  });

  it("maps stage labels", () => {
    expect(fs1StageLabel("queued")).toBe("Queued");
    expect(fs1StageLabel("separating")).toBe("Separating vocals");
    expect(fs1StageLabel("complete")).toBe("Complete");
  });

  it("sets cancelled on abort", async () => {
    const controller = new AbortController();
    stubFetch(async () => jsonResponse({ job_id: "job-1", status: "queued", progress: 0, result: null, error: null }));
    const promise = pollFullSongJob("job-1", controller.signal, 60000);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "cancelled", cancelled: true });
  });
});