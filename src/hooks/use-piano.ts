"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InstrumentType, PianoKey } from "@/types/music";
import { PianoVoiceController } from "@/lib/audio/piano-voices";
import { NativePianoSynth } from "@/lib/audio/native-piano-synth";
import { useToneAudioUnlock } from "@/lib/audio/audio-unlock";

// usePiano speaks in InstrumentType; map to the native timbre names.
const INSTRUMENT_TO_TIMBRE: Record<InstrumentType, string> = {
  piano: "piano",
  warm: "warm",
  bright: "bright",
  bell: "bell",
};

export function usePiano(instrument: InstrumentType, volume: number, sustain: boolean) {
  const engineRef = useRef<NativePianoSynth | null>(null);
  const voicesRef = useRef<PianoVoiceController | null>(null);
  const connectedRawRef = useRef<AudioContext | null>(null);
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

  const { state: audioState, unlock, getRawContext } = useToneAudioUnlock();

  // Build the native engine bound to the live raw AudioContext. The native
  // graph does not silently die the way the Tone output chain did, so a single
  // engine survives for the component's lifetime (instrument/volume mutate it
  // in place). It is only rebuilt if the OS swaps the AudioContext underneath.
  const ensureEngine = useCallback((): PianoVoiceController | null => {
    const raw = getRawContext();
    if (!raw || !raw.destination) return voicesRef.current;
    if (connectedRawRef.current !== raw || !engineRef.current) {
      engineRef.current?.dispose();
      const engine = new NativePianoSynth(raw, raw.destination, {
        instrument: INSTRUMENT_TO_TIMBRE[instrumentRef.current],
        volumeDb: volumeRef.current,
      });
      engineRef.current = engine;
      connectedRawRef.current = raw;
      if (voicesRef.current) voicesRef.current.setSynth(engine);
      else voicesRef.current = new PianoVoiceController(engine, { sustain: sustainRef.current });
    }
    return voicesRef.current;
  }, [getRawContext]);

  useEffect(() => {
    ensureEngine();
    if (engineRef.current) engineRef.current.setInstrument(INSTRUMENT_TO_TIMBRE[instrumentRef.current]);
    syncActiveNotes();
  }, [instrument, ensureEngine, syncActiveNotes]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    const voices = voicesRef.current;
    if (!voices || voices.isSustainEnabled === sustain) return;
    voices.setSustain(sustain);
    syncActiveNotes();
  }, [sustain, syncActiveNotes]);

  const press = useCallback(async (key: PianoKey) => {
    const voices = ensureEngine();
    if (!voices) return;
    // Register the press synchronously so a key-up during unlock() still
    // cancels the pending attack instead of leaving a stuck voice.
    if (!voices.press(key.note)) {
      syncActiveNotes();
      return;
    }
    syncActiveNotes();
    try {
      await unlock();
    } catch {
      voices.release(key.note);
      syncActiveNotes();
      return;
    }
    // Rebind to the (possibly new) context after the unlock gesture.
    ensureEngine();
    voicesRef.current?.attack(key.note);
    syncActiveNotes();
  }, [ensureEngine, syncActiveNotes, unlock]);

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

  // Diagnostic: play A4 for 250ms through the SAME native engine so a silent
  // phone can tell context-unlock failure apart from routing failure.
  const testSound = useCallback(() => {
    const voices = ensureEngine();
    if (!voices) return;
    void unlock().then(() => {
      ensureEngine();
      if (voices.press("A4")) {
        voices.attack("A4");
        window.setTimeout(() => voices.release("A4"), 250);
      }
    });
  }, [unlock, ensureEngine]);

  // Release every active voice on window blur or page hide, and dispose the
  // engine on unmount so nothing can keep ringing.
  useEffect(() => {
    const onBlur = () => releaseAllNotes();
    const onVisibility = () => {
      if (document.hidden) releaseAllNotes();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      voicesRef.current?.releaseAll();
      engineRef.current?.dispose();
      engineRef.current = null;
      voicesRef.current = null;
      connectedRawRef.current = null;
    };
  }, [releaseAllNotes]);

  return { activeNotes, press, release, releaseAllNotes, audioState, unlock, getRawContext, testSound };
}
