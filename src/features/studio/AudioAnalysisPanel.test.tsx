// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AudioAnalysisPanel } from "./AudioAnalysisPanel";

function makeAudioFile(name: string, type: string, size: number) {
  return new File([new Uint8Array(size)], name, { type });
}

afterEach(cleanup);

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
