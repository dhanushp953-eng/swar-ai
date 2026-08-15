// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { PianoKeyboard } from "./PianoKeyboard";

const { playNote, stopNote } = vi.hoisted(() => ({ playNote: vi.fn(), stopNote: vi.fn() }));

vi.mock("@/hooks/usePianoAudio", () => ({
  usePianoAudio: () => ({ playNote, stopNote, releaseAllNotes: vi.fn() }),
}));

function keydown(key: string, target: EventTarget) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function keyup(key: string, target: EventTarget) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  });
}

describe("PianoKeyboard keyboard handling", () => {
  afterEach(() => {
    playNote.mockClear();
    stopNote.mockClear();
    cleanup();
  });

  it("does not play notes while typing in a text field", () => {
    const { container } = render(
      <div>
        <input data-testid="chat" />
        <PianoKeyboard />
      </div>,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();
    keydown("z", input);
    keyup("z", input);
    // "z" maps to the first piano note; typing in the field must not trigger it.
    expect(playNote).not.toHaveBeenCalled();
    expect(stopNote).not.toHaveBeenCalled();
  });

  it("plays notes when the keyboard event is not in a text field", () => {
    render(
      <div>
        <input data-testid="chat" />
        <PianoKeyboard />
      </div>,
    );
    keydown("z", window);
    expect(playNote).toHaveBeenCalledTimes(1);
  });
});
