"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import type { InstrumentName } from "@/types/music";
import { PianoVoiceController } from "@/lib/audio/piano-voices";
import { useToneAudioUnlock } from "@/lib/audio/audio-unlock";

function configureSynth(synth: Tone.PolySynth, instrument: InstrumentName): void {
  const envelope = instrument === "bell" ? { attack: 0.01, decay: 1.4, sustain: 0.1, release: 1.5 } : instrument === "warm-pad" ? { attack: 0.25, decay: 0.2, sustain: 0.85, release: 1.5 } : { attack: 0.005, decay: 0.3, sustain: 0.35, release: 0.8 };
  synth.set({ oscillator: { type: instrument === "bell" ? "triangle" : instrument === "warm-pad" ? "sine" : "triangle8" }, envelope });
}

export function usePianoAudio() {
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const voicesRef = useRef<PianoVoiceController | null>(null);
  const [volume, setVolumeState] = useState(-8);
  const [instrument, setInstrumentState] = useState<InstrumentName>("piano");
  const [sustain, setSustainState] = useState(false);

  const instrumentRef = useRef(instrument);
  const volumeRef = useRef(volume);
  const sustainRef = useRef(sustain);
  useEffect(() => { instrumentRef.current = instrument; }, [instrument]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { sustainRef.current = sustain; }, [sustain]);

  // One engine per hook instance, created on first use and re-configured via
  // set() on later instrument/volume changes — never recreated per render.
  const ensureVoices = useCallback((): PianoVoiceController => {
    if (!voicesRef.current) {
      if (!synthRef.current) {
        synthRef.current = new Tone.PolySynth(Tone.Synth).toDestination();
        configureSynth(synthRef.current, instrumentRef.current);
        synthRef.current.volume.value = volumeRef.current;
      }
      voicesRef.current = new PianoVoiceController(synthRef.current, { sustain: sustainRef.current });
    }
    return voicesRef.current;
  }, []);

  useEffect(() => {
    if (!synthRef.current) return;
    configureSynth(synthRef.current, instrument);
    synthRef.current.volume.value = volume;
  }, [instrument, volume]);

  const { state: audioState, unlock, getRawContext } = useToneAudioUnlock();

  const playNote = useCallback((note: string) => {
    const voices = ensureVoices();
    // Register the press synchronously so a key-up during unlock() still
    // cancels the pending attack (no stuck voices from the async race).
    if (!voices.press(note)) return;
    void unlock().then(
      () => voices.attack(note),
      () => voices.release(note),
    );
  }, [ensureVoices, unlock]);

  const stopNote = useCallback((note: string) => {
    voicesRef.current?.release(note);
  }, []);

  const stopAllNotes = useCallback(() => {
    voicesRef.current?.releaseAll();
  }, []);

  const releaseAllNotes = useCallback(() => {
    voicesRef.current?.releaseAll();
  }, []);

  const ensureReady = useCallback(async () => {
    await unlock();
    ensureVoices();
  }, [ensureVoices, unlock]);

  // Diagnostic: play A4 for 250ms through the SAME synth + Tone destination so
  // a silent phone can tell context-unlock failure apart from routing failure.
  const testSound = useCallback(() => {
    void unlock().then(() => {
      playNote("A4");
      window.setTimeout(() => stopNote("A4"), 250);
    });
  }, [unlock, playNote, stopNote]);

  const setVolume = useCallback((next: number) => {
    setVolumeState(next);
    if (synthRef.current) synthRef.current.volume.value = next;
  }, []);

  const setInstrument = useCallback((next: InstrumentName) => {
    setInstrumentState(next);
    if (synthRef.current) configureSynth(synthRef.current, next);
  }, []);

  const setSustain = useCallback((next: boolean) => {
    setSustainState(next);
    voicesRef.current?.setSustain(next);
  }, []);

  // Release every active voice on window blur or page hide, and tear the
  // engine down on unmount so no voice can outlive the component.
  useEffect(() => {
    const onBlur = () => voicesRef.current?.releaseAll();
    const onVisibility = () => { if (document.hidden) voicesRef.current?.releaseAll(); };
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
  }, []);

  return { playNote, stopNote, stopAllNotes, releaseAllNotes, ensureReady, volume, setVolume, instrument, setInstrument, sustain, setSustain, audioState, unlock, getRawContext, testSound };
}
