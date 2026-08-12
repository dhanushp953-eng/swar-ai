"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import type { InstrumentType, PianoKey } from "@/types/music";
import { PianoVoiceController } from "@/lib/audio/piano-voices";

const synthFactories: Record<InstrumentType, () => Tone.PolySynth> = {
  piano: () => new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.01, decay: 0.4, sustain: 0.18, release: 1.2 } }),
  warm: () => new Tone.PolySynth(Tone.AMSynth, { harmonicity: 1.5, envelope: { attack: 0.01, decay: 0.5, sustain: 0.2, release: 1 } }),
  bright: () => new Tone.PolySynth(Tone.FMSynth, { harmonicity: 2, modulationIndex: 8, envelope: { attack: 0.01, decay: 0.25, sustain: 0.2, release: 0.8 } }),
  bell: () => new Tone.PolySynth(Tone.MembraneSynth, { pitchDecay: 0.03, octaves: 3, envelope: { attack: 0.001, decay: 0.6, sustain: 0.05, release: 0.8 } }),
};

export function usePiano(instrument: InstrumentType, volume: number, sustain: boolean) {
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const voicesRef = useRef<PianoVoiceController | null>(null);
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());

  const instrumentRef = useRef(instrument);
  const volumeRef = useRef(volume);
  const sustainRef = useRef(sustain);
  useEffect(() => { instrumentRef.current = instrument; }, [instrument]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { sustainRef.current = sustain; }, [sustain]);

  const syncActiveNotes = useCallback(() => {
    setActiveNotes(new Set(voicesRef.current?.getActiveNotes() ?? []));
  }, []);

  // A new engine only ever comes from an instrument change (each instrument is
  // a different Voice type). Volume/sustain/re-renders mutate it in place.
  useEffect(() => {
    const previous = instrumentRef.current;
    instrumentRef.current = instrument;
    if (previous === instrument && synthRef.current) return;
    const next = synthFactories[instrument]().toDestination();
    next.volume.value = volumeRef.current;
    if (voicesRef.current) {
      // setSynth releases every voice on the old engine before swapping.
      voicesRef.current.setSynth(next);
    } else {
      voicesRef.current = new PianoVoiceController(next, { sustain: sustainRef.current });
    }
    synthRef.current?.dispose();
    synthRef.current = next;
    syncActiveNotes();
  }, [instrument, syncActiveNotes]);

  useEffect(() => {
    if (synthRef.current) synthRef.current.volume.value = volume;
  }, [volume]);

  useEffect(() => {
    const voices = voicesRef.current;
    if (!voices || voices.isSustainEnabled === sustain) return;
    voices.setSustain(sustain);
    syncActiveNotes();
  }, [sustain, syncActiveNotes]);

  const press = useCallback(async (key: PianoKey) => {
    const voices = voicesRef.current;
    if (!voices) return;
    // Register the press synchronously so a key-up during Tone.start() still
    // cancels the pending attack instead of leaving a stuck voice.
    if (!voices.press(key.note)) return;
    syncActiveNotes();
    try {
      await Tone.start();
    } catch {
      voices.release(key.note);
      syncActiveNotes();
      return;
    }
    voices.attack(key.note);
    syncActiveNotes();
  }, [syncActiveNotes]);

  const release = useCallback((key: PianoKey) => {
    const voices = voicesRef.current;
    if (!voices) return;
    voices.release(key.note);
    syncActiveNotes();
  }, [syncActiveNotes]);

  const releaseAllNotes = useCallback(() => {
    voicesRef.current?.releaseAll();
    syncActiveNotes();
  }, [syncActiveNotes]);

  // Release every active voice on window blur or page hide, and dispose the
  // engine on unmount so nothing can keep ringing.
  useEffect(() => {
    const onBlur = () => releaseAllNotes();
    const onVisibility = () => { if (document.hidden) releaseAllNotes(); };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      voicesRef.current?.releaseAll();
      synthRef.current?.dispose();
      synthRef.current = null;
      voicesRef.current = null;
    };
  }, [releaseAllNotes]);

  return { activeNotes, press, release, releaseAllNotes };
}
