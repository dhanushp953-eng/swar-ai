"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Tone from "tone";
import { ChevronDown, Square, Volume2 } from "lucide-react";
import { usePiano } from "@/hooks/use-piano";
import { useMidiHeldNotes } from "@/hooks/useWebMidi";
import type { InstrumentType } from "@/types/music";
import { createPianoKeys } from "@/utils/music";
import { isEditableTarget } from "@/utils/dom";
import { PianoKey } from "@/components/piano-key";

const instruments: { id: InstrumentType; label: string }[] = [{ id: "piano", label: "Studio piano" }, { id: "warm", label: "Warm keys" }, { id: "bright", label: "Bright FM" }, { id: "bell", label: "Bell tone" }];

type PianoProps = { lessonActiveMidi?: ReadonlySet<number>; lessonRoll?: ReactNode; midiHeldNotes?: ReadonlySet<number> };

export function Piano({ lessonActiveMidi, lessonRoll, midiHeldNotes }: PianoProps) {
  const keys = useMemo(() => createPianoKeys(), []);
  const [instrument, setInstrument] = useState<InstrumentType>("piano");
  const [volume, setVolume] = useState(-8);
  const [sustain, setSustain] = useState(false);
  const { activeNotes, press, release, releaseAllNotes, audioState, unlock, getRawContext, testSound } = usePiano(instrument, volume, sustain);
  const [audioBlocked, setAudioBlocked] = useState(false);

  // ---- TEMPORARY DIAGNOSTIC: native WebAudio path that bypasses Tone entirely. ----
  // Goal: on a silent phone, tell apart a Tone routing bug from a system/OS audio
  // block. Plays a raw 440 Hz OscillatorNode through the SAME underlying AudioContext.
  type NativeDiag = {
    protocol: string;
    secureContext: boolean;
    stateBefore?: AudioContextState;
    stateAfter?: AudioContextState;
    sampleRate?: number;
    toneMute?: boolean;
    toneVolume?: number;
    oscStarted?: boolean;
    error?: string;
    resumeError?: string;
    toneError?: string;
  };
  const nativeRef = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null);
  const [nativeDiag, setNativeDiag] = useState<NativeDiag | null>(null);

  const runNativeAudioTest = useCallback(async () => {
    const result: NativeDiag = {
      protocol: location.protocol,
      secureContext: window.isSecureContext,
    };
    try {
      const raw = (Tone.getContext() as unknown as { rawContext: AudioContext | null }).rawContext;
      if (!raw) {
        result.error = "Tone.getContext().rawContext is null (no underlying AudioContext)";
        setNativeDiag(result);
        return;
      }
      result.stateBefore = raw.state;
      result.sampleRate = raw.sampleRate;
      try {
        const dest = Tone.getDestination() as unknown as { mute: boolean; volume: { value: number } };
        result.toneMute = dest.mute;
        result.toneVolume = dest.volume?.value;
      } catch (e) {
        result.toneError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
      try {
        await raw.resume();
      } catch (e) {
        result.resumeError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
      result.stateAfter = raw.state;
      const osc = raw.createOscillator();
      const gain = raw.createGain();
      gain.gain.value = 0.2;
      osc.type = "sine";
      osc.frequency.value = 440;
      osc.onended = () => {
        try { gain.disconnect(); } catch {}
        try { osc.disconnect(); } catch {}
        if (nativeRef.current?.osc === osc) nativeRef.current = null;
      };
      osc.connect(gain);
      gain.connect(raw.destination);
      nativeRef.current = { osc, gain };
      osc.start();
      result.oscStarted = true;
      window.setTimeout(() => {
        try { osc.stop(); } catch {}
      }, 250);
      setNativeDiag(result);
    } catch (e) {
      result.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      setNativeDiag(result);
    }
  }, []);

  const enableAudio = useCallback(async () => {
    // Resume the exact Tone.js AudioContext directly from the pointer gesture.
    const raw = getRawContext();
    if (raw && raw.state !== "running") {
      try {
        await raw.resume();
      } catch {
        // ignore — unlock() below reports the resulting state
      }
    }
    const result = await unlock();
    setAudioBlocked(result !== "running");
  }, [getRawContext, unlock]);
  const subscribedMidiNotes = useMidiHeldNotes();
  const midiHeld = midiHeldNotes ?? subscribedMidiNotes;
  useEffect(() => {
    const keyMap = new Map(keys.filter((key) => key.keyboard).map((key) => [key.keyboard, key]));
    const onDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (!event.repeat) { const key = keyMap.get(event.key.toLowerCase()); if (key) { event.preventDefault(); void press(key); } }
    };
    const onUp = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const key = keyMap.get(event.key.toLowerCase());
      if (key) release(key);
    };
    window.addEventListener("keydown", onDown); window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, [keys, press, release]);

  return <section className="instrument-panel" aria-label="Virtual piano"><div className="instrument-toolbar"><div><p className="eyebrow">Virtual instrument</p><h2>61-key piano</h2></div><div className="instrument-controls"><label className="select-control">{instruments.find((item) => item.id === instrument)?.label}<ChevronDown size={14} /><select aria-label="Instrument sound" value={instrument} onChange={(event) => setInstrument(event.target.value as InstrumentType)}>{instruments.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label className="volume-control"><Volume2 size={16} /><input aria-label="Volume" type="range" min="-30" max="0" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label><button className={`toggle ${sustain ? "selected" : ""}`} type="button" aria-pressed={sustain} onClick={() => setSustain(!sustain)}>Sustain <span /></button><button className="piano-release" type="button" aria-label="Release all notes" onClick={releaseAllNotes}><Square size={12} /> Release all</button></div></div><div className="audio-actions">{audioState !== "running" && <button type="button" className="audio-enable" onPointerDown={() => void enableAudio()}><Volume2 size={14} aria-hidden="true" /> Enable sound</button>}<button type="button" className="audio-test" onPointerDown={() => testSound()} aria-label="Play a test tone">Test sound</button><button type="button" className="audio-native" onPointerDown={() => void runNativeAudioTest()} aria-label="Run native audio diagnostic">Native audio test</button>{audioBlocked && <span className="audio-blocked" role="status">Audio is still blocked. Tap Enable sound again.</span>}</div>{nativeDiag && <div className="audio-diag" role="status"><p className="audio-diag-title">Native audio diagnostic (temporary)</p><dl><div><dt>location.protocol</dt><dd>{nativeDiag.protocol}</dd></div><div><dt>window.isSecureContext</dt><dd>{String(nativeDiag.secureContext)}</dd></div><div><dt>state before resume</dt><dd>{nativeDiag.stateBefore ?? "—"}</dd></div><div><dt>state after resume</dt><dd>{nativeDiag.stateAfter ?? "—"}</dd></div><div><dt>sampleRate</dt><dd>{nativeDiag.sampleRate != null ? `${nativeDiag.sampleRate} Hz` : "—"}</dd></div><div><dt>Tone.Destination.mute</dt><dd>{nativeDiag.toneMute != null ? String(nativeDiag.toneMute) : "—"}</dd></div><div><dt>Tone.Destination.volume</dt><dd>{nativeDiag.toneVolume != null ? `${nativeDiag.toneVolume} dB` : "—"}</dd></div><div><dt>native osc started</dt><dd>{nativeDiag.oscStarted ? "yes" : "no"}</dd></div>{nativeDiag.resumeError && <div><dt>resume error</dt><dd>{nativeDiag.resumeError}</dd></div>}{nativeDiag.toneError && <div><dt>Tone.Destination error</dt><dd>{nativeDiag.toneError}</dd></div>}{nativeDiag.error && <div><dt>error</dt><dd>{nativeDiag.error}</dd></div>}</dl></div>}<div className="piano-scroll">{lessonRoll}<div className="piano-keys">{keys.map((key) => <PianoKey key={key.midi} pianoKey={key} active={activeNotes.has(key.note)} lessonActive={Boolean(lessonActiveMidi?.has(key.midi))} midiActive={midiHeld.has(key.midi)} onPress={() => press(key)} onRelease={() => release(key)} />)}</div></div><div className="piano-foot"><span>Click or tap a key to play</span><span><kbd>A</kbd>–<kbd>J</kbd> white keys <kbd>W</kbd>–<kbd>U</kbd> black keys</span></div></section>;
}
