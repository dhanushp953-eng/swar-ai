// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AudioAnalysisPanel } from "./AudioAnalysisPanel";

function makeAudioFile(name: string, type: string, size: number) {
  return new File([new Uint8Array(size)], name, { type });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

describe("AudioAnalysisPanel mobile file picker", () => {
  it("renders a real, visible file input (not a hidden/button-wrapped one)", () => {
    render(<AudioAnalysisPanel />);
    const input = screen.getByLabelText("Choose an audio file") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.type).toBe("file");
    expect(input.disabled).toBe(false);
    expect(input.className).toContain("audio-choose-button");
    expect(input.className).not.toContain("audio-file-input");
  });

  it("uses a visible file input with audio/* accept and keeps a stable key", () => {
    const { container } = render(<AudioAnalysisPanel />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.accept).toBe("audio/*,.wav,.mp3,.m4a,.ogg");
    // selecting a file re-renders; the input must NOT be remounted (stable key)
    const before = input;
    fireEvent.change(input, { target: { files: [makeAudioFile("a.wav", "audio/wav", 1024)] } });
    expect(container.querySelector('input[type="file"]')).toBe(before);
  });

  it("shows name, size and format after a valid selection", () => {
    const { container } = render(<AudioAnalysisPanel />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeAudioFile("my-song.wav", "audio/wav", 2048)] } });

    expect(screen.getByText("my-song.wav")).toBeTruthy();
    expect(screen.getByText(/2 KB/)).toBeTruthy();
    expect(screen.getByText(/audio\/wav/)).toBeTruthy();
  });

  it("shows the exact validation error when a rejected phone file is chosen", () => {
    const { container } = render(<AudioAnalysisPanel />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeAudioFile("notes.txt", "text/plain", 10)] } });

    expect(screen.getByText(/Unsupported format/i)).toBeTruthy();
    // rejected file is not shown as selected
    expect(screen.queryByText("notes.txt")).toBeNull();
  });

  it("requires authorization only before Analyse, not for file selection", () => {
    const { container } = render(<AudioAnalysisPanel />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeAudioFile("a.wav", "audio/wav", 1024)] } });

    const analyse = screen.getByRole("button", { name: /analyse audio/i }) as HTMLButtonElement;
    expect(analyse.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/i own this audio/i));
    expect(analyse.disabled).toBe(false);
  });
});

describe("AudioAnalysisPanel upload flow", () => {
  it("normalizes then POSTs to /api/analyze immediately, with no pre-flight /api/health check", async () => {
    class FakeAudioBuffer {
      numberOfChannels = 1;
      length = 1;
      sampleRate = 44100;
      getChannelData() {
        return new Float32Array([0]);
      }
    }
    class FakeAudioContext {
      async decodeAudioData() {
        return new FakeAudioBuffer();
      }
      close() {
        return Promise.resolve();
      }
    }
    (window as unknown as { AudioContext: typeof FakeAudioContext }).AudioContext = FakeAudioContext;

    const healthCalls: string[] = [];
    const analyzeOpens: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("health")) healthCalls.push(url);
        return { ok: true, status: 200, json: async () => ({ status: "ok", warmup: "ready" }) };
      }),
    );

    class FakeXhr {
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      response = JSON.stringify({
        job_id: "job-1",
        status: "completed",
        progress: 100,
        result: null,
        error: null,
        duration: 1,
        estimated_bpm: 100,
        beat_timestamps: [],
        rhythm_confidence: 0.9,
        warnings: [],
        analysis_engine: "librosa.beat.beat_track",
        analysis_version: "3.0.0",
        note_events: [],
        melody_confidence: 0.9,
        melody_engine: "librosa.pyin",
        melody_analysis_version: "3.1.0",
      });
      responseType = "";
      status = 201;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open(_method: string, url: string) {
        analyzeOpens.push(url);
      }
      send() {
        this.onload?.();
      }
      abort() {
        this.onabort?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);

    const { container } = render(<AudioAnalysisPanel />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeAudioFile("song.wav", "audio/wav", 2048)] } });
    fireEvent.click(screen.getByLabelText(/i own this audio/i));
    const analyse = screen.getByRole("button", { name: /analyse audio/i }) as HTMLButtonElement;
    expect(analyse.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(analyse);
    });

    expect(analyzeOpens.length).toBeGreaterThan(0);
    expect(analyzeOpens[0]).toContain("/api/analyze");
    expect(healthCalls.length).toBe(0);
  });
});
