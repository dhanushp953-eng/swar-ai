// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FullSongAnalysisPanel } from "./FullSongAnalysisPanel";
import { getAnalyzedSheet, setAnalyzedSheet } from "@/lib/song-sheet/analyzed-sheet-store";
import type { Fs1Result } from "@/lib/fs1-api";

function makeAudioFile(name: string, type: string, size: number) {
  return new File([new Uint8Array(size)], name, { type });
}

function makeResult(): Fs1Result {
  return {
    analysis_version: "fs1.0.0",
    duration: 60,
    language: "en",
    language_confidence: 0.9,
    bpm: 120,
    beat_source: "percussive",
    lyric_words: [],
    lyric_lines: [],
    chord_events: [],
    chord_anchors: [],
    song_sheet: {
      id: "fs1-test",
      metadata: {
        title: "Test Song",
        composer: "Detected (unverified)",
        periodOrOrigin: "Automatic full-song detection",
        attribution: "AI-detected — verify before publication",
        difficulty: "Beginner",
        key: "C major",
        originalKey: "C major",
        timeSignature: "4/4",
        tuning: "E A D G B E",
        defaultCapo: 0,
        description: "Description",
        isPublicDomain: false,
      },
      chordsUsed: ["C", "G"],
      sections: [
        {
          id: "s1",
          title: "Verse",
          type: "verse",
          lines: [{ id: "l1", segments: [{ chord: "C", text: "Hello" }] }],
        },
      ],
    },
    warnings: [],
    model_info: {
      demucs: { name: "demucs", available: true },
      whisper: { name: "whisper", available: true },
      ffmpeg: { name: "ffmpeg", available: true },
    },
    processing_time_seconds: 5,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  cleanup();
  setAnalyzedSheet(null);
  vi.unstubAllGlobals();
});

describe("FullSongAnalysisPanel", () => {
  it("renders a real visible file input and requires authorisation before analysing", () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ capabilities: [] })));
    const { container } = render(<FullSongAnalysisPanel />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.accept).toBe("audio/*,.wav,.mp3,.m4a,.ogg");
    fireEvent.change(input, { target: { files: [makeAudioFile("a.wav", "audio/wav", 1024)] } });
    const analyse = screen.getByRole("button", { name: /analyse full song/i }) as HTMLButtonElement;
    expect(analyse.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/i own this audio/i));
    expect((screen.getByRole("button", { name: /analyse full song/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a validation error for an unsupported file", () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ capabilities: [] })));
    const { container } = render(<FullSongAnalysisPanel />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeAudioFile("a.flac", "audio/flac", 10)] } });
    expect(screen.getByText(/Unsupported format/i)).toBeTruthy();
    expect(screen.queryByText("a.flac")).toBeNull();
  });

  it("creates a job, polls to completion, and publishes the analyzed sheet", async () => {
    const result = makeResult();
    const complete = { job_id: "job-1", status: "complete", progress: 100, result, error: null };
    let postCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/capabilities")) return jsonResponse({ capabilities: [] });
        if (url.includes("/jobs") && init?.method === "POST") {
          postCalls += 1;
          return jsonResponse({ job_id: "job-1", status: "queued", progress: 0, result: null, error: null });
        }
        if (url.includes("/jobs/job-1")) return jsonResponse(complete);
        return jsonResponse({ job_id: "job-1", status: "queued", progress: 0, result: null, error: null });
      }),
    );

    const { container } = render(<FullSongAnalysisPanel />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeAudioFile("song.wav", "audio/wav", 2048)] } });
    fireEvent.click(screen.getByLabelText(/i own this audio/i));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /analyse full song/i }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(postCalls).toBeGreaterThan(0);
    expect(getAnalyzedSheet()?.metadata.title).toBe("Test Song");
    expect(getAnalyzedSheet()?.chordsUsed).toEqual(["C", "G"]);
    expect(screen.getByText(/your song sheet is ready/i)).toBeTruthy();
  });

  it("shows the worker capability warning when models are unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ capabilities: [{ name: "demucs", available: false, reason: "missing" }, { name: "whisper", available: true }] }),
      ),
    );
    render(<FullSongAnalysisPanel />);
    expect(await screen.findByText(/models are unavailable locally/i)).toBeTruthy();
  });
});