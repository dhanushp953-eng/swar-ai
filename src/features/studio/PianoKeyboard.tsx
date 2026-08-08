"use client";

import { useEffect, useState } from "react";
import { createPianoNotes } from "@/utils/music";
import { usePianoAudio } from "@/hooks/usePianoAudio";
import type { InstrumentName } from "@/types/music";

const notes = createPianoNotes();
const keyboardMap = new Map(notes.map((note) => [note.keyboardKey, note]));

export function PianoKeyboard() {
  const audio = usePianoAudio();
  const [active, setActive] = useState<number[]>([]);
  const [lastNote, setLastNote] = useState("—");
  const press = (midi: number, name: string) => { setActive((items) => items.includes(midi) ? items : [...items, midi]); setLastNote(name); void audio.playNote(name); };
  const release = (midi: number, name: string) => { setActive((items) => items.filter((item) => item !== midi)); audio.stopNote(name); };

  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.repeat) return; const note = keyboardMap.get(event.key.toLowerCase()); if (note) { event.preventDefault(); press(note.midi, note.name); } };
    const up = (event: KeyboardEvent) => { const note = keyboardMap.get(event.key.toLowerCase()); if (note) release(note.midi, note.name); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  });

  const whiteNotes = notes.filter((note) => !note.isBlack);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#29252c] pb-4"><div><p className="mb-1 text-xs uppercase tracking-[0.18em] text-[#857c87]">Live instrument</p><p className="display text-lg font-semibold">{lastNote === "—" ? "Play a note" : lastNote} <span className="ml-2 text-sm font-normal text-[#746c76]">{lastNote !== "—" ? "· sounding" : "· click or use your keyboard"}</span></p></div><div className="flex items-center gap-2 text-xs text-[#857c87]"><span className="h-2 w-2 rounded-full bg-[#77b78c]" /> Audio ready in browser</div></div>
    <div className="piano-scroll overflow-x-auto pb-3"><div className="relative h-52 min-w-[1060px] rounded-b-lg border border-[#302b31] bg-[#231f25] px-2 pt-2">
      <div className="flex h-full">{whiteNotes.map((note) => <button key={note.midi} aria-label={`Play ${note.name}`} onPointerDown={() => press(note.midi, note.name)} onPointerUp={() => release(note.midi, note.name)} onPointerLeave={() => active.includes(note.midi) && release(note.midi, note.name)} className={`key-white relative h-full min-w-[52px] flex-1 rounded-b-md border-r border-[#aaa29a] text-left transition-transform ${active.includes(note.midi) ? "active" : ""}`}><span className="absolute bottom-2 left-2 text-[10px] font-semibold text-[#777178]">{note.name}</span>{note.keyboardKey && <span className="absolute bottom-7 left-2 text-[9px] uppercase text-[#a29ba0]">{note.keyboardKey}</span>}</button>)}</div>
      <div className="pointer-events-none absolute left-2 right-2 top-2 h-[128px]">{notes.filter((note) => note.isBlack).map((note) => { const whiteBefore = whiteNotes.filter((white) => white.midi < note.midi).length; return <button key={note.midi} aria-label={`Play ${note.name}`} onPointerDown={(event) => { event.stopPropagation(); press(note.midi, note.name); }} onPointerUp={(event) => { event.stopPropagation(); release(note.midi, note.name); }} className={`pointer-events-auto key-black absolute z-10 h-full w-8 -translate-x-1/2 rounded-b-md transition-transform ${active.includes(note.midi) ? "active" : ""}`} style={{ left: `${(whiteBefore + 0.5) * (100 / whiteNotes.length)}%` }}><span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[9px] text-[#b8adb9]">{note.keyboardKey}</span></button>; })}</div>
    </div></div>
    <div className="grid gap-3 sm:grid-cols-3"><label className="flex items-center justify-between rounded-md border border-[#302b31] px-3 py-2.5 text-sm text-[#bdb5bd]">Sound<select value={audio.instrument} onChange={(event) => audio.setInstrument(event.target.value as InstrumentName)} className="bg-transparent text-right text-[#f5f1ea] outline-none"><option className="bg-[#211d23]" value="piano">Soft piano</option><option className="bg-[#211d23]" value="warm-pad">Warm pad</option><option className="bg-[#211d23]" value="bell">Soft bell</option></select></label><label className="flex items-center gap-3 rounded-md border border-[#302b31] px-3 py-2.5 text-sm text-[#bdb5bd]">Volume<input aria-label="Volume" type="range" min="-30" max="0" value={audio.volume} onChange={(event) => audio.setVolume(Number(event.target.value))} className="min-w-0 accent-[#e3aa61]" /></label><button onClick={() => audio.setSustain(!audio.sustain)} className={`rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${audio.sustain ? "border-[#a878c1] bg-[#302438] text-[#e2c9ef]" : "border-[#302b31] text-[#bdb5bd] hover:border-[#5b4a5f]"}`}><span className="mr-2 inline-block h-2 w-2 rounded-full bg-current" />Sustain {audio.sustain ? "on" : "off"}</button></div>
  </div>;
}
