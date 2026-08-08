"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import type { InstrumentType, PianoKey } from "@/types/music";

const synthOptions: Record<InstrumentType, () => Tone.ToneAudioNode> = {
  piano: () => new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.01, decay: 0.4, sustain: 0.18, release: 1.2 } }),
  warm: () => new Tone.PolySynth(Tone.AMSynth, { harmonicity: 1.5, envelope: { attack: 0.01, decay: 0.5, sustain: 0.2, release: 1 } }),
  bright: () => new Tone.PolySynth(Tone.FMSynth, { harmonicity: 2, modulationIndex: 8, envelope: { attack: 0.01, decay: 0.25, sustain: 0.2, release: 0.8 } }),
  bell: () => new Tone.PolySynth(Tone.MembraneSynth, { pitchDecay: 0.03, octaves: 3, envelope: { attack: 0.001, decay: 0.6, sustain: 0.05, release: 0.8 } }),
};

export function usePiano(instrument: InstrumentType, volume: number, sustain: boolean) {
  const synthRef = useRef<Tone.ToneAudioNode | null>(null);
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());

  useEffect(() => {
    const synth = synthOptions[instrument]();
    synth.connect(new Tone.Volume(volume).toDestination());
    synthRef.current = synth;
    return () => { synth.dispose(); synthRef.current = null; };
  }, [instrument, volume]);

  const press = useCallback(async (key: PianoKey) => {
    await Tone.start();
    const synth = synthRef.current as Tone.PolySynth | null;
    if (!synth || activeNotes.has(key.note)) return;
    synth.triggerAttack(key.note);
    setActiveNotes((current) => new Set(current).add(key.note));
  }, [activeNotes]);

  const release = useCallback((key: PianoKey) => {
    const synth = synthRef.current as Tone.PolySynth | null;
    if (!synth) return;
    if (!sustain) synth.triggerRelease(key.note);
    setActiveNotes((current) => { const next = new Set(current); next.delete(key.note); return next; });
  }, [sustain]);

  return { activeNotes, press, release };
}
