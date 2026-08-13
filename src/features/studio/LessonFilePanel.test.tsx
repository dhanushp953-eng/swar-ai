// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LessonFilePanel } from "./LessonFilePanel";

afterEach(cleanup);

describe("LessonFilePanel mobile file picker", () => {
  it("renders a real, visible file input for lesson JSON", () => {
    render(<LessonFilePanel />);
    const input = screen.getByLabelText("Choose a lesson file") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.type).toBe("file");
    expect(input.disabled).toBe(false);
    expect(input.className).toContain("audio-choose-button");
  });

  it("uses a file input with lesson json accept and keeps a stable key", () => {
    const { container } = render(<LessonFilePanel />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe(".lesson,.json,application/json,text/json");
    const before = input;
    fireEvent.change(input, { target: { files: [new File(['{"exercise":{"id":"x","title":"T","events":[],"bpm":120}}'], "p.lesson", { type: "application/json" })] } });
    expect(container.querySelector('input[type="file"]')).toBe(before);
  });

  it("shows name, size and format after a valid selection", async () => {
    const { container } = render(<LessonFilePanel />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{"exercise":{"id":"x","title":"Test","events":[],"bpm":120}}'], "plan.lesson", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText("plan.lesson");
    expect(screen.getByText(/application\/json/)).toBeTruthy();
    expect(screen.getByText(/1 KB/)).toBeTruthy();
  });

  it("shows the exact validation error when an invalid lesson file is chosen", async () => {
    const { container } = render(<LessonFilePanel />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["not valid json"], "bad.txt", { type: "text/plain" })] } });

    expect(await screen.findByText(/not valid JSON/i)).toBeTruthy();
  });
});
