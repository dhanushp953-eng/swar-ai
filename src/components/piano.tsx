"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Square, Volume2 } from "lucide-react";
import { usePiano } from "@/hooks/use-piano";
import { useMidiHeldNotes } from "@/hooks/useWebMidi";
import type { InstrumentType } from "@/types/music";
import { createPianoKeys } from "@/utils/music";
import { PianoKey } from "@/components/piano-key";

const instruments: { id: InstrumentType; label: string }[] = [{ id: "piano", label: "Studio piano" }, { id: "warm", label: "Warm keys" }, { id: "bright", label: "Bright FM" }, { id: "bell", label: "Bell tone" }];

type PianoProps = { lessonActiveMidi?: ReadonlySet<number>; lessonRoll?: ReactNode; midiHeldNotes?: ReadonlySet<number> };

export function Piano({ lessonActiveMidi, lessonRoll, midiHeldNotes }: PianoProps) {
  const keys = useMemo(() => createPianoKeys(), []);
  const [instrument, setInstrument] = useState<InstrumentType>("piano");
  const [volume, setVolume] = useState(-8);
  const [sustain, setSustain] = useState(false);
  const { activeNotes, press, release, releaseAllNotes } = usePiano(instrument, volume, sustain);
  const subscribedMidiNotes = useMidiHeldNotes();
  const midiHeld = midiHeldNotes ?? subscribedMidiNotes;
  useEffect(() => {
    const keyMap = new Map(keys.filter((key) => key.keyboard).map((key) => [key.keyboard, key]));
    const onDown = (event: KeyboardEvent) => { if (!event.repeat) { const key = keyMap.get(event.key.toLowerCase()); if (key) { event.preventDefault(); void press(key); } } };
    const onUp = (event: KeyboardEvent) => { const key = keyMap.get(event.key.toLowerCase()); if (key) release(key); };
    window.addEventListener("keydown", onDown); window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, [keys, press, release]);

  return <section className="instrument-panel" aria-label="Virtual piano"><div className="instrument-toolbar"><div><p className="eyebrow">Virtual instrument</p><h2>61-key piano</h2></div><div className="instrument-controls"><label className="select-control">{instruments.find((item) => item.id === instrument)?.label}<ChevronDown size={14} /><select aria-label="Instrument sound" value={instrument} onChange={(event) => setInstrument(event.target.value as InstrumentType)}>{instruments.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label className="volume-control"><Volume2 size={16} /><input aria-label="Volume" type="range" min="-30" max="0" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label><button className={`toggle ${sustain ? "selected" : ""}`} type="button" aria-pressed={sustain} onClick={() => setSustain(!sustain)}>Sustain <span /></button><button className="piano-release" type="button" aria-label="Release all notes" onClick={releaseAllNotes}><Square size={12} /> Release all</button></div></div><div className="piano-scroll">{lessonRoll}<div className="piano-keys">{keys.map((key) => <PianoKey key={key.midi} pianoKey={key} active={activeNotes.has(key.note)} lessonActive={Boolean(lessonActiveMidi?.has(key.midi))} midiActive={midiHeld.has(key.midi)} onPress={() => press(key)} onRelease={() => release(key)} />)}</div></div><div className="piano-foot"><span>Click or tap a key to play</span><span><kbd>A</kbd>–<kbd>J</kbd> white keys <kbd>W</kbd>–<kbd>U</kbd> black keys</span></div></section>;
}
