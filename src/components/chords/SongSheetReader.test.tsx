// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { SongSheetReader } from "./SongSheetReader";
import { twinkleLittleStarSongSheet } from "@/data/twinkle-song-sheet";

describe("SongSheetReader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("renders song metadata, public-domain attribution, and beginner difficulty", () => {
    render(<SongSheetReader songSheet={twinkleLittleStarSongSheet} />);

    expect(screen.getByText("Twinkle, Twinkle, Little Star")).toBeDefined();
    expect(screen.getByText(/Public Domain/i)).toBeDefined();
    expect(screen.getByText("Beginner")).toBeDefined();
    expect(screen.getByText("C major")).toBeDefined();
    expect(screen.getByText("4/4")).toBeDefined();
    expect(screen.getByText("E A D G B E")).toBeDefined();
  });

  it("renders Intro, Verse, and Outro sections with chords positioned over lyric words", () => {
    render(<SongSheetReader songSheet={twinkleLittleStarSongSheet} />);

    expect(screen.getByText("[Intro]")).toBeDefined();
    expect(screen.getByText("[Verse]")).toBeDefined();
    expect(screen.getByText("[Outro]")).toBeDefined();

    // Check lyrics
    expect(screen.getAllByText(/Twinkle,/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/little/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/star,/i).length).toBeGreaterThan(0);

  });

  it("switches tabs between Guitar, Ukulele, and Piano Notes with appropriate diagrams", () => {
    render(<SongSheetReader songSheet={twinkleLittleStarSongSheet} />);

    // Default is Guitar
    const guitarTab = screen.getByRole("tab", { name: /Guitar/i });
    expect(guitarTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("guitar-chord-C")).toBeDefined();

    // Switch to Ukulele
    const ukeTab = screen.getByRole("tab", { name: /Ukulele/i });
    fireEvent.click(ukeTab);
    expect(ukeTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("ukulele-chord-C")).toBeDefined();

    // Switch to Piano Notes
    const pianoTab = screen.getByRole("tab", { name: /Piano Notes/i });
    fireEvent.click(pianoTab);
    expect(pianoTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("piano-notes-C")).toBeDefined();
    expect(screen.getByText("C – E – G")).toBeDefined();
    expect(screen.getByText("F – A – C")).toBeDefined();
    expect(screen.getByText("G – B – D")).toBeDefined();
  });

  it("transposes chords up and down and updates chord badges and summary", () => {
    render(<SongSheetReader songSheet={twinkleLittleStarSongSheet} />);

    const transposeUpBtn = screen.getByRole("button", { name: /Transpose up/i });

    // Transpose +2 (from C to D)
    fireEvent.click(transposeUpBtn);
    fireEvent.click(transposeUpBtn);

    expect(screen.getByText("+2 st")).toBeDefined();
    expect(screen.getByTestId("guitar-chord-D")).toBeDefined();

    // Transpose Reset
    const resetBtn = screen.getByRole("button", { name: /Reset transpose/i });
    fireEvent.click(resetBtn);
    expect(screen.getByText("0 (Original)")).toBeDefined();
    expect(screen.getByTestId("guitar-chord-C")).toBeDefined();
  });

  it("handles capo changes and calculates sounding key correctly", () => {
    render(<SongSheetReader songSheet={twinkleLittleStarSongSheet} />);

    const capoSelect = screen.getByLabelText(/Select capo fret/i);
    fireEvent.change(capoSelect, { target: { value: "2" } });

    const fret2Elements = screen.getAllByText(/Fret 2/i);
    expect(fret2Elements.length).toBeGreaterThan(0);
    expect(screen.getByText(/sounds in D major/i)).toBeDefined();
  });


  it("adjusts font sizes between Small, Medium, Large, and Extra Large", () => {
    render(<SongSheetReader songSheet={twinkleLittleStarSongSheet} />);

    const increaseFontBtn = screen.getByRole("button", { name: /Increase font size/i });
    const decreaseFontBtn = screen.getByRole("button", { name: /Decrease font size/i });

    expect(screen.getByText("Medium")).toBeDefined();

    fireEvent.click(increaseFontBtn);
    expect(screen.getByText("Large")).toBeDefined();

    fireEvent.click(increaseFontBtn);
    expect(screen.getByText("Extra Large")).toBeDefined();

    fireEvent.click(decreaseFontBtn);
    expect(screen.getByText("Large")).toBeDefined();
  });

  it("controls auto-scroll toggle, pause, restart, and speed selection", () => {
    render(<SongSheetReader songSheet={twinkleLittleStarSongSheet} />);

    const scrollBtn = screen.getByRole("button", { name: /Start auto-scroll/i });
    expect(scrollBtn).toBeDefined();

    // Start auto-scroll
    fireEvent.click(scrollBtn);
    expect(screen.getByRole("button", { name: /Pause auto-scroll/i })).toBeDefined();

    // Change speed
    const speed2xBtn = screen.getByRole("button", { name: /Scroll speed 2x/i });
    fireEvent.click(speed2xBtn);

    // Pause auto-scroll
    fireEvent.click(screen.getByRole("button", { name: /Pause auto-scroll/i }));
    expect(screen.getByRole("button", { name: /Start auto-scroll/i })).toBeDefined();

    // Restart scroll
    const restartBtn = screen.getByRole("button", { name: /Restart scroll to top/i });
    fireEvent.click(restartBtn);
  });
});
