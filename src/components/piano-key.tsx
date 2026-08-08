"use client";

import type { PianoKey as PianoKeyType } from "@/types/music";
import { formatNote } from "@/utils/music";

type Props = { pianoKey: PianoKeyType; active: boolean; onPress: () => void; onRelease: () => void };

export function PianoKey({ pianoKey, active, onPress, onRelease }: Props) {
  return <button type="button" className={`piano-key ${pianoKey.isBlack ? "black-key" : "white-key"} ${active ? "is-active" : ""}`} data-keyboard={pianoKey.keyboard} aria-label={`${pianoKey.note} piano key`} onPointerDown={(event) => { event.preventDefault(); onPress(); }} onPointerUp={onRelease} onPointerLeave={onRelease} onPointerCancel={onRelease}><span className="key-note">{pianoKey.note.endsWith("0") || pianoKey.note.endsWith("3") || pianoKey.note.endsWith("5") ? formatNote(pianoKey.note) : ""}</span>{pianoKey.keyboard && <span className="key-shortcut">{pianoKey.keyboard}</span>}</button>;
}
