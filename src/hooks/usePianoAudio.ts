"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import type { InstrumentName } from "@/types/music";

export function usePianoAudio() {
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const [volume, setVolumeState] = useState(-8);
  const [instrument, setInstrument] = useState<InstrumentName>("piano");
  const [sustain, setSustain] = useState(false);

  useEffect(() => () => { synthRef.current?.dispose(); }, []);

  const ensureSynth = useCallback(async () => {
    await Tone.start();
    if (!synthRef.current) synthRef.current = new Tone.PolySynth(Tone.Synth).toDestination();
    synthRef.current.volume.value = volume;
    const envelope = instrument === "bell" ? { attack: 0.01, decay: 1.4, sustain: 0.1, release: 1.5 } : instrument === "warm-pad" ? { attack: 0.25, decay: 0.2, sustain: 0.85, release: 1.5 } : { attack: 0.005, decay: 0.3, sustain: 0.35, release: 0.8 };
    synthRef.current.set({ oscillator: { type: instrument === "bell" ? "triangle" : instrument === "warm-pad" ? "sine" : "triangle8" }, envelope });
    return synthRef.current;
  }, [instrument, volume]);

  const playNote = useCallback(async (note: string) => { const synth = await ensureSynth(); synth.triggerAttack(note); }, [ensureSynth]);
  const stopNote = useCallback((note: string) => { if (!sustain) synthRef.current?.triggerRelease(note); }, [sustain]);
  const stopAllNotes = useCallback(() => { synthRef.current?.releaseAll(); }, []);
  const ensureReady = useCallback(async () => { await ensureSynth(); }, [ensureSynth]);
  const setVolume = useCallback((next: number) => { setVolumeState(next); if (synthRef.current) synthRef.current.volume.value = next; }, []);
  return { playNote, stopNote, stopAllNotes, ensureReady, volume, setVolume, instrument, setInstrument, sustain, setSustain };
}
