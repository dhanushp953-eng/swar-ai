"use client";

import type { PianoKey as PianoKeyType } from "@/types/music";
import { formatNote } from "@/utils/music";

type Props = { pianoKey: PianoKeyType; active?: boolean; lessonActive?: boolean; midiActive?: boolean; onPress: () => void; onRelease: () => void };

export function PianoKey({ pianoKey, active = false, lessonActive = false, midiActive = false, onPress, onRelease }: Props) {
  const className = [
    "piano-key",
    pianoKey.isBlack ? "black-key" : "white-key",
    active || lessonActive ? "is-active" : "",
    midiActive ? "is-midi" : "",
  ].filter(Boolean).join(" ");
  return <button type="button" className={className} data-keyboard={pianoKey.keyboard} aria-label={`${pianoKey.note} piano key`} aria-pressed={active || lessonActive || midiActive} onPointerDown={(event) => { event.preventDefault(); onPress(); }} onPointerUp={onRelease} onPointerLeave={onRelease} onPointerCancel={onRelease}><span className="key-labels"><span className="key-note">{formatNote(pianoKey.note)}</span>{pianoKey.keyboard && <span className="key-shortcut">{pianoKey.keyboard}</span>}</span></button>;
}
