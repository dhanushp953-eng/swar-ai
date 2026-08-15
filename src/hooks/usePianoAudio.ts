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
  const needsRecoveryRef = useRef(false);
  const attachedRawRef = useRef<AudioContext | null>(null);
  useEffect(() => { instrumentRef.current = instrument; }, [instrument]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { sustainRef.current = sustain;   }, [sustain]);

  const { state: audioState, unlock, getRawContext } = useToneAudioUnlock();

  const markNeedsRecovery = useCallback(() => {
    needsRecoveryRef.current = true;
  }, []);

  const onRawStateChange = useCallback(() => {
    const raw = getRawContext();
    if (raw && raw.state !== "running") needsRecoveryRef.current = true;
  }, [getRawContext]);

  // Flag the recovery on OS audio-route teardown (mobile ~1 min inactivity,
  // screen lock, call, route change). We also re-check connectivity on every
  // press in recoverIfNeeded().
  const attachRawRecoveryListeners = useCallback(() => {
    if (attachedRawRef.current) return;
    const raw = getRawContext();
    if (!raw) return;
    attachedRawRef.current = raw;
    const target = raw as EventTarget;
    target.addEventListener("interruption", markNeedsRecovery);
    target.addEventListener("statechange", onRawStateChange);
  }, [markNeedsRecovery, onRawStateChange, getRawContext]);

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
    attachRawRecoveryListeners();
    return voicesRef.current;
  }, [attachRawRecoveryListeners]);

  // Rebuild the Tone synth + output graph from scratch and reconnect it to the
  // live Tone destination. Fixes "piano goes silent after ~1 min": the audio
  // context is resumed by the unlock step, but the PolySynth graph tied to it
  // has gone stale/disconnected and must be recreated.
  const recreateSynth = useCallback(() => {
    const previous = synthRef.current;
    const fresh = new Tone.PolySynth(Tone.Synth).toDestination();
    configureSynth(fresh, instrumentRef.current);
    fresh.volume.value = volumeRef.current;
    if (voicesRef.current) {
      // Preserves the notes already pressed so the pending attack replays.
      voicesRef.current.rebuildEngine(fresh);
    } else {
      voicesRef.current = new PianoVoiceController(fresh, { sustain: sustainRef.current });
    }
    synthRef.current = fresh;
    if (previous && !previous.disposed) {
      previous.disconnect();
      previous.dispose();
    }
    needsRecoveryRef.current = false;
  }, []);

  // Decide whether the current synth must be rebuilt before playing. We verify
  // it is connected to the current Tone destination/context, not merely that
  // the context resumed.
  const recoverIfNeeded = useCallback(() => {
    const synth = synthRef.current;
    const raw = getRawContext();
    const synthRaw = (synth as { context?: { rawContext?: AudioContext } } | null)?.context?.rawContext;
    const contextMismatch = Boolean(synth && raw && synthRaw && synthRaw !== raw);
    const synthDead = !synth || synth.disposed;
    if (needsRecoveryRef.current || synthDead || contextMismatch) {
      recreateSynth();
    }
  }, [recreateSynth, getRawContext]);

  useEffect(() => {
    if (!synthRef.current) return;
    configureSynth(synthRef.current, instrument);
    synthRef.current.volume.value = volume;
  }, [instrument, volume]);

  const playNote = useCallback((note: string) => {
    const voices = ensureVoices();
    // Register the press synchronously so a key-up during unlock() still
    // cancels the pending attack (no stuck voices from the async race).
    if (!voices.press(note)) return;
    void unlock().then(
      () => {
        recoverIfNeeded();
        voicesRef.current?.attack(note);
      },
      () => voices.release(note),
    );
  }, [ensureVoices, unlock, recoverIfNeeded]);

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

  // Mark the engine for recovery when the tab regains focus/visibility or is
  // re-shown (both common after mobile inactivity), and keep a watch on the
  // raw AudioContext so an OS interruption triggers a rebuild on the next press.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) voicesRef.current?.releaseAll();
      else needsRecoveryRef.current = true;
    };
    window.addEventListener("pageshow", markNeedsRecovery);
    window.addEventListener("focus", markNeedsRecovery);
    document.addEventListener("visibilitychange", onVisibility);
    attachRawRecoveryListeners();
    return () => {
      window.removeEventListener("pageshow", markNeedsRecovery);
      window.removeEventListener("focus", markNeedsRecovery);
      document.removeEventListener("visibilitychange", onVisibility);
      const raw = attachedRawRef.current;
      if (raw) {
        const target = raw as EventTarget;
        target.removeEventListener("interruption", markNeedsRecovery);
        target.removeEventListener("statechange", onRawStateChange);
        attachedRawRef.current = null;
      }
    };
  }, [markNeedsRecovery, onRawStateChange, attachRawRecoveryListeners]);

  return { playNote, stopNote, stopAllNotes, releaseAllNotes, ensureReady, volume, setVolume, instrument, setInstrument, sustain, setSustain, audioState, unlock, getRawContext, testSound };
}
