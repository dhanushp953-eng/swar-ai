"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InstrumentName } from "@/types/music";
import { PianoVoiceController } from "@/lib/audio/piano-voices";
import { NativePianoSynth } from "@/lib/audio/native-piano-synth";
import { useToneAudioUnlock } from "@/lib/audio/audio-unlock";

export function usePianoAudio() {
  const engineRef = useRef<NativePianoSynth | null>(null);
  const voicesRef = useRef<PianoVoiceController | null>(null);
  const [volume, setVolumeState] = useState(-8);
  const [instrument, setInstrumentState] = useState<InstrumentName>("piano");
  const [sustain, setSustainState] = useState(false);

  const instrumentRef = useRef(instrument);
  const volumeRef = useRef(volume);
  const sustainRef = useRef(sustain);
  const connectedRawRef = useRef<AudioContext | null>(null);
  useEffect(() => { instrumentRef.current = instrument; }, [instrument]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { sustainRef.current = sustain; }, [sustain]);

  const { state: audioState, unlock, getRawContext } = useToneAudioUnlock();

  // One engine per hook instance, bound to the live raw AudioContext and
  // re-created only if that context is swapped (an OS audio reset). The native
  // graph does not silently die the way the Tone output chain did, so there is
  // no periodic rebuild — we just keep feeding the proven-good raw destination.
  const ensureEngine = useCallback((): PianoVoiceController | null => {
    if (!voicesRef.current) {
      const raw = getRawContext();
      if (raw && raw.destination && !engineRef.current) {
        const engine = new NativePianoSynth(raw, raw.destination, {
          instrument: instrumentRef.current,
          volumeDb: volumeRef.current,
        });
        engineRef.current = engine;
        connectedRawRef.current = raw;
      }
      if (engineRef.current) {
        voicesRef.current = new PianoVoiceController(engineRef.current, {
          sustain: sustainRef.current,
        });
      }
    }
    return voicesRef.current;
  }, [getRawContext]);

  // If the underlying AudioContext changed while we were away (mobile OS audio
  // reset), tear the stale engine down and bind a fresh one. Pressed notes are
  // kept and replayed on the new engine so the piano never goes silent.
  const reconnectIfNeeded = useCallback((): boolean => {
    const raw = getRawContext();
    if (!raw || !raw.destination) return false;
    if (connectedRawRef.current === raw && engineRef.current) return false;
    engineRef.current?.dispose();
    const engine = new NativePianoSynth(raw, raw.destination, {
      instrument: instrumentRef.current,
      volumeDb: volumeRef.current,
    });
    engineRef.current = engine;
    connectedRawRef.current = raw;
    if (voicesRef.current) {
      // rebuildEngine keeps the pressed notes and swaps in the fresh engine;
      // we then replay them so held notes keep sounding after the reset.
      voicesRef.current.rebuildEngine(engine);
      for (const note of voicesRef.current.getActiveNotes()) {
        voicesRef.current.attack(note);
      }
    } else {
      voicesRef.current = new PianoVoiceController(engine, { sustain: sustainRef.current });
    }
    return true;
  }, [getRawContext]);

  const playNote = useCallback((note: string) => {
    const voices = ensureEngine();
    // Register the press synchronously so a key-up during unlock() still
    // cancels the pending attack (no stuck voices from the async race).
    if (!voices || !voices.press(note)) return;
    void unlock().then(
      () => {
        // A rebuild already replayed every pressed note (including this one)
        // on the fresh engine, so only attack directly when nothing rebuilt.
        if (!reconnectIfNeeded()) {
          voicesRef.current?.attack(note);
        }
      },
      () => voices.release(note),
    );
  }, [ensureEngine, unlock, reconnectIfNeeded]);

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
    ensureEngine();
  }, [ensureEngine, unlock]);

  // Diagnostic: play A4 for 250ms through the SAME native engine so a silent
  // phone can tell context-unlock failure apart from routing failure.
  const testSound = useCallback(() => {
    void unlock().then(() => {
      playNote("A4");
      window.setTimeout(() => stopNote("A4"), 250);
    });
  }, [unlock, playNote, stopNote]);

  const setVolume = useCallback((next: number) => {
    setVolumeState(next);
    engineRef.current?.setVolume(next);
  }, []);

  const setInstrument = useCallback((next: InstrumentName) => {
    setInstrumentState(next);
    engineRef.current?.setInstrument(next);
  }, []);

  const setSustain = useCallback((next: boolean) => {
    setSustainState(next);
    voicesRef.current?.setSustain(next);
  }, []);

  // Apply volume/instrument to the engine whenever they change from outside
  // (covers the initial value set before the engine exists).
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setVolume(volume);
      engineRef.current.setInstrument(instrument);
    }
  }, [instrument, volume]);

  // Release every active voice on window blur or page hide, and tear the
  // engine down on unmount so no voice can outlive the component.
  useEffect(() => {
    const onBlur = () => voicesRef.current?.releaseAll();
    const onVisibility = () => {
      if (document.hidden) voicesRef.current?.releaseAll();
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
  }, []);

  return {
    playNote,
    stopNote,
    stopAllNotes,
    releaseAllNotes,
    ensureReady,
    volume,
    setVolume,
    instrument,
    setInstrument,
    sustain,
    setSustain,
    audioState,
    unlock,
    getRawContext,
    testSound,
  };
}
