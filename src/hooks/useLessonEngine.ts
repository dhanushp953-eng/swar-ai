"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import * as Tone from "tone";
import type { HandMode, LessonExercise, LessonStatus } from "@/types/lesson";
import { filterEventsByHand } from "@/utils/lesson-notes";
import { clampLessonTime, getBeatDuration, getCountInDuration, getLessonTimeFromClock, type PlaybackSpeed } from "@/utils/lesson-timing";
import { getAudioSeekTime, getScheduledNoteKey, getScheduledNoteWindow, getSyncedLessonTime } from "@/utils/detected-lesson-timing";

export type OutputMode = "original" | "piano" | "both";

export type LessonEngineOptions = {
  audioFile?: File | null;
  audioRef?: RefObject<HTMLAudioElement | null>;
  objectUrl?: string | null;
};

type LessonEngine = {
  currentTime: number;
  status: LessonStatus;
  countInBeat: number;
  speed: PlaybackSpeed;
  handMode: HandMode;
  metronome: boolean;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  play: () => void;
  pause: () => void;
  restart: () => void;
  seek: (time: number) => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  setHandMode: (mode: HandMode) => void;
  setMetronome: (enabled: boolean) => void;
  setLoopEnabled: (enabled: boolean) => void;
  setLoopRange: (start: number, end: number) => void;
  isAudioMaster: boolean;
  audioRef: RefObject<HTMLAudioElement | null>;
  preservesPitchSupported: boolean;
  audioError: string | null;
  outputMode: OutputMode;
  setOutputMode: (mode: OutputMode) => void;
  originalVolume: number;
  setOriginalVolume: (volume: number) => void;
  generatedVolume: number;
  setGeneratedVolume: (volume: number) => void;
  syncOffsetMs: number;
  setSyncOffsetMs: (offsetMs: number) => void;
};

const RENDER_INTERVAL = 1000 / 30;
const getTransport = () => Tone.getTransport();
const readAudioElement = (ref: RefObject<HTMLAudioElement | null>) => ref.current;

export function useLessonEngine(exercise: LessonExercise, options: LessonEngineOptions = {}): LessonEngine {
  const internalAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioRef = options.audioRef ?? internalAudioRef;
  const audioFile = options.audioFile ?? null;
  const objectUrl = options.objectUrl ?? null;
  const isAudioMaster = Boolean(audioFile && options.audioRef);
  const [currentTime, setCurrentTime] = useState(0);
  const [status, setStatus] = useState<LessonStatus>("idle");
  const [countInBeat, setCountInBeat] = useState(0);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1);
  const [handMode, setHandModeState] = useState<HandMode>("both");
  const [metronome, setMetronomeState] = useState(false);
  const [loopEnabled, setLoopEnabledState] = useState(false);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(exercise.duration);
  const [outputMode, setOutputModeState] = useState<OutputMode>("both");
  const [originalVolume, setOriginalVolumeState] = useState(1);
  const [generatedVolume, setGeneratedVolumeState] = useState(-8);
  const [syncOffsetMs, setSyncOffsetMsState] = useState(0);
  const [preservesPitchSupported, setPreservesPitchSupported] = useState(true);
  const [audioError, setAudioError] = useState<string | null>(null);

  const statusRef = useRef<LessonStatus>("idle");
  const phaseRef = useRef<"count-in" | "playing" | null>(null);
  const currentTimeRef = useRef(0);
  const speedRef = useRef<PlaybackSpeed>(1);
  const handModeRef = useRef<HandMode>("both");
  const metronomeRef = useRef(false);
  const loopEnabledRef = useRef(false);
  const loopStartRef = useRef(0);
  const loopEndRef = useRef(exercise.duration);
  const lessonStartRef = useRef(0);
  const transportStartRef = useRef(0);
  const countInRef = useRef(false);
  const scheduledIdsRef = useRef<number[]>([]);
  const scheduledAudioTimeoutsRef = useRef<number[]>([]);
  const scheduledNoteKeysRef = useRef<Set<string>>(new Set());
  const generationRef = useRef(0);
  const tickerRef = useRef<number | null>(null);
  const lastRenderRef = useRef(0);
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const metronomeSynthRef = useRef<Tone.MembraneSynth | null>(null);
  const outputModeRef = useRef<OutputMode>("both");
  const originalVolumeRef = useRef(1);
  const generatedVolumeRef = useRef(-8);
  const syncOffsetRef = useRef(0);
  const scheduleExternalPlaybackRef = useRef<() => void>(() => undefined);
  const schedulePlaybackRef = useRef<(includeCountIn: boolean) => void>(() => undefined);
  const tickRef = useRef<(timestamp: number) => void>(() => undefined);

  const setEngineStatus = useCallback((next: LessonStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const setEngineTime = useCallback((next: number) => {
    const clamped = clampLessonTime(next, exercise.duration);
    currentTimeRef.current = clamped;
    setCurrentTime(clamped);
  }, [exercise.duration]);

  const getAudioLessonTime = useCallback(() => {
    const audio = readAudioElement(audioRef);
    if (!audio) return currentTimeRef.current;
    return getSyncedLessonTime(audio.currentTime, syncOffsetRef.current, exercise.duration);
  }, [audioRef, exercise.duration]);

  const stopTicker = useCallback(() => {
    if (tickerRef.current !== null) window.cancelAnimationFrame(tickerRef.current);
    tickerRef.current = null;
  }, []);

  const getRunningTime = useCallback(() => {
    if (isAudioMaster) return getAudioLessonTime();
    if (phaseRef.current === "count-in") return 0;
    if (phaseRef.current !== "playing") return currentTimeRef.current;
    return getLessonTimeFromClock(getTransport().seconds - transportStartRef.current, lessonStartRef.current, speedRef.current, countInRef.current ? getCountInDuration(exercise.bpm, speedRef.current) : 0, exercise.duration);
  }, [exercise.bpm, exercise.duration, getAudioLessonTime, isAudioMaster]);

  const clearScheduled = useCallback(() => {
    generationRef.current += 1;
    scheduledIdsRef.current.forEach((id) => getTransport().clear(id));
    scheduledIdsRef.current = [];
    scheduledAudioTimeoutsRef.current.forEach((id) => Tone.getContext().clearTimeout(id));
    scheduledAudioTimeoutsRef.current = [];
    scheduledNoteKeysRef.current.clear();
  }, []);

  const ensureAudio = useCallback(async () => {
    if (isAudioMaster && outputModeRef.current === "original" && !metronomeRef.current) return;
    await Tone.start();
    if ((!isAudioMaster || outputModeRef.current !== "original") && !synthRef.current) {
      synthRef.current = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.008, decay: 0.32, sustain: 0.28, release: 0.75 } }).toDestination();
      synthRef.current.volume.value = generatedVolumeRef.current;
    }
    if (metronomeRef.current && !metronomeSynthRef.current) {
      metronomeSynthRef.current = new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 2, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.08 } }).toDestination();
      metronomeSynthRef.current.volume.value = -15;
    }
  }, [isAudioMaster]);

  const scheduleExternalPlayback = useCallback(() => {
    if (!isAudioMaster || phaseRef.current !== "playing") return;
    const current = getAudioLessonTime();
    const rangeStart = loopEnabledRef.current ? loopStartRef.current : 0;
    const rangeEnd = loopEnabledRef.current ? loopEndRef.current : exercise.duration;
    const generation = generationRef.current;
    if (outputModeRef.current !== "original" && synthRef.current) {
      const selectedEvents = filterEventsByHand(exercise.events, handModeRef.current).filter((event) => event.start < rangeEnd && event.start + event.duration > Math.max(current, rangeStart));
      selectedEvents.forEach((event) => {
        const eventKey = getScheduledNoteKey(generation, event.id);
        if (scheduledNoteKeysRef.current.has(eventKey)) return;
        const eventWindow = getScheduledNoteWindow(event, current, rangeStart, rangeEnd);
        if (eventWindow.duration <= 0) return;
        scheduledNoteKeysRef.current.add(eventKey);
        const timeoutId = Tone.getContext().setTimeout(() => {
          scheduledNoteKeysRef.current.delete(eventKey);
          scheduledAudioTimeoutsRef.current = scheduledAudioTimeoutsRef.current.filter((id) => id !== timeoutId);
          if (generationRef.current !== generation || phaseRef.current !== "playing" || outputModeRef.current === "original") return;
          synthRef.current?.triggerAttackRelease(event.name, eventWindow.duration / speedRef.current, Tone.now(), event.velocity / 127);
        }, Math.max(0, (eventWindow.start - current) / speedRef.current));
        scheduledAudioTimeoutsRef.current.push(timeoutId);
      });
    }

    const beatDuration = getBeatDuration(exercise.bpm, 1);
    if (metronomeRef.current && metronomeSynthRef.current && beatDuration > 0) {
      const firstBeat = current <= 0 ? 0 : Math.ceil((current + 0.001) / beatDuration) * beatDuration;
      for (let beatTime = firstBeat; beatTime <= rangeEnd; beatTime += beatDuration) {
        const beatIndex = Math.round(beatTime / beatDuration);
        const eventKey = getScheduledNoteKey(generation, `metronome-${beatIndex}`);
        if (scheduledNoteKeysRef.current.has(eventKey)) continue;
        scheduledNoteKeysRef.current.add(eventKey);
        const timeoutId = Tone.getContext().setTimeout(() => {
          scheduledNoteKeysRef.current.delete(eventKey);
          scheduledAudioTimeoutsRef.current = scheduledAudioTimeoutsRef.current.filter((id) => id !== timeoutId);
          if (generationRef.current !== generation || phaseRef.current !== "playing" || !metronomeRef.current) return;
          metronomeSynthRef.current?.triggerAttackRelease("C6", 0.06, Tone.now(), beatIndex % 4 === 0 ? 0.9 : 0.55);
        }, Math.max(0, (beatTime - current) / speedRef.current));
        scheduledAudioTimeoutsRef.current.push(timeoutId);
      }
    }
  }, [exercise.bpm, exercise.duration, exercise.events, getAudioLessonTime, isAudioMaster]);

  useEffect(() => {
    scheduleExternalPlaybackRef.current = scheduleExternalPlayback;
  }, [scheduleExternalPlayback]);

  const schedulePlayback = useCallback((includeCountIn: boolean) => {
    if (isAudioMaster) {
      scheduleExternalPlaybackRef.current();
      return;
    }
    clearScheduled();
    const generation = generationRef.current;
    const now = getTransport().seconds;
    const current = currentTimeRef.current;
    const countInSeconds = includeCountIn ? getCountInDuration(exercise.bpm, speedRef.current) : 0;
    const rangeStart = loopEnabledRef.current ? loopStartRef.current : 0;
    const rangeEnd = loopEnabledRef.current ? loopEndRef.current : exercise.duration;
    const selectedEvents = filterEventsByHand(exercise.events, handModeRef.current).filter((event) => event.start < rangeEnd && event.start + event.duration > Math.max(current, rangeStart));

    selectedEvents.forEach((event) => {
      const eventStart = Math.max(event.start, current, rangeStart);
      const delay = countInSeconds + Math.max(0, eventStart - current) / speedRef.current;
      const remainingDuration = Math.min(event.start + event.duration, rangeEnd) - eventStart;
      if (remainingDuration <= 0) return;
      const id = getTransport().scheduleOnce((audioTime) => {
        if (generationRef.current !== generation) return;
        synthRef.current?.triggerAttackRelease(event.name, remainingDuration / speedRef.current, audioTime, event.velocity / 127);
      }, now + Math.max(delay, 0.005));
      scheduledIdsRef.current.push(id);
    });

    if (metronomeRef.current) {
      const beat = getBeatDuration(exercise.bpm, speedRef.current);
      for (let index = 0; index < (includeCountIn ? 4 : 0); index += 1) {
        const id = getTransport().scheduleOnce((audioTime) => {
          if (generationRef.current === generation) metronomeSynthRef.current?.triggerAttackRelease("C6", 0.06, audioTime, index === 0 ? 0.9 : 0.55);
        }, now + Math.max(index * beat, 0.005));
        scheduledIdsRef.current.push(id);
      }
      const firstBeat = current <= 0 ? 0 : Math.ceil((current + 0.001) / beat) * beat;
      for (let beatTime = firstBeat; beatTime <= rangeEnd; beatTime += beat) {
        const id = getTransport().scheduleOnce((audioTime) => {
          if (generationRef.current === generation) metronomeSynthRef.current?.triggerAttackRelease("C6", 0.06, audioTime, 0.45);
        }, now + countInSeconds + Math.max(0, beatTime - current) / speedRef.current);
        scheduledIdsRef.current.push(id);
      }
    }

    const endDelay = countInSeconds + Math.max(0, rangeEnd - current) / speedRef.current;
    const endId = getTransport().scheduleOnce(() => {
      if (generationRef.current !== generation || statusRef.current !== "playing" && statusRef.current !== "count-in") return;
      if (loopEnabledRef.current && loopEndRef.current > loopStartRef.current) {
        synthRef.current?.releaseAll();
        getTransport().stop();
        getTransport().position = 0;
        currentTimeRef.current = loopStartRef.current;
        lessonStartRef.current = loopStartRef.current;
        transportStartRef.current = 0;
        countInRef.current = false;
        phaseRef.current = "playing";
        setEngineTime(loopStartRef.current);
        schedulePlaybackRef.current(false);
        getTransport().start();
      } else {
        synthRef.current?.releaseAll();
        getTransport().stop();
        clearScheduled();
        phaseRef.current = null;
        countInRef.current = false;
        setEngineTime(exercise.duration);
        setEngineStatus("complete");
        stopTicker();
      }
    }, now + Math.max(endDelay, 0.01));
    scheduledIdsRef.current.push(endId);
  }, [clearScheduled, exercise, isAudioMaster, setEngineStatus, setEngineTime, stopTicker]);

  const tick = useCallback((timestamp: number) => {
    if (phaseRef.current === null) return;
    if (timestamp - lastRenderRef.current >= RENDER_INTERVAL) {
      lastRenderRef.current = timestamp;
      if (isAudioMaster) {
        const audio = readAudioElement(audioRef);
        const audioTime = getAudioLessonTime();
        if (audio && loopEnabledRef.current && audioTime >= loopEndRef.current - 0.02 && loopEndRef.current > loopStartRef.current) {
          clearScheduled();
          audio.currentTime = getAudioSeekTime(loopStartRef.current, syncOffsetRef.current, exercise.duration);
          setEngineTime(loopStartRef.current);
          scheduleExternalPlaybackRef.current();
        } else if (audio?.ended) {
          clearScheduled();
          phaseRef.current = null;
          setEngineTime(exercise.duration);
          setEngineStatus("complete");
          stopTicker();
        } else {
          setEngineTime(audioTime);
          scheduleExternalPlaybackRef.current();
        }
        tickerRef.current = window.requestAnimationFrame(tickRef.current);
        return;
      }
      if (phaseRef.current === "count-in") {
        const beat = getBeatDuration(exercise.bpm, speedRef.current);
        const elapsed = getTransport().seconds - transportStartRef.current;
        if (elapsed >= getCountInDuration(exercise.bpm, speedRef.current)) {
          countInRef.current = false;
          phaseRef.current = "playing";
          setEngineStatus("playing");
          setCountInBeat(0);
        } else {
          setCountInBeat(Math.min(4, Math.floor(elapsed / beat) + 1));
        }
      }
      setEngineTime(getRunningTime());
    }
    tickerRef.current = window.requestAnimationFrame(tickRef.current);
  }, [audioRef, clearScheduled, exercise.bpm, exercise.duration, getAudioLessonTime, getRunningTime, isAudioMaster, setEngineStatus, setEngineTime, stopTicker]);

  useEffect(() => {
    schedulePlaybackRef.current = schedulePlayback;
    tickRef.current = tick;
  }, [schedulePlayback, tick]);

  const startTicker = useCallback(() => {
    stopTicker();
    lastRenderRef.current = 0;
    tickerRef.current = window.requestAnimationFrame(tickRef.current);
  }, [stopTicker]);

  const play = useCallback(() => {
    if (isAudioMaster) {
      const audio = readAudioElement(audioRef);
      if (!audio) {
        setAudioError("The uploaded audio player is not available.");
        return;
      }
      if (statusRef.current === "idle" || statusRef.current === "complete") {
        audio.currentTime = getAudioSeekTime(0, syncOffsetRef.current, exercise.duration);
        setEngineTime(0);
      }
      void ensureAudio().then(() => audio.play()).then(() => {
        setAudioError(null);
        phaseRef.current = "playing";
        setEngineStatus("playing");
        scheduleExternalPlaybackRef.current();
        startTicker();
      }).catch(() => {
        setAudioError("Audio playback needs a browser gesture. Press Play again to start it.");
      });
      return;
    }
    void ensureAudio().then(() => {
      const isFresh = statusRef.current === "idle" || statusRef.current === "complete";
      if (isFresh) {
        clearScheduled();
        getTransport().stop();
        getTransport().position = 0;
        currentTimeRef.current = 0;
        setEngineTime(0);
      }
      const includeCountIn = isFresh && currentTimeRef.current === 0;
      countInRef.current = includeCountIn;
      phaseRef.current = includeCountIn ? "count-in" : "playing";
      lessonStartRef.current = currentTimeRef.current;
      transportStartRef.current = getTransport().seconds;
      schedulePlayback(includeCountIn);
      getTransport().start();
      setEngineStatus(includeCountIn ? "count-in" : "playing");
      startTicker();
    });
  }, [audioRef, clearScheduled, ensureAudio, exercise.duration, isAudioMaster, schedulePlayback, setEngineStatus, setEngineTime, startTicker]);

  const pause = useCallback(() => {
    if (phaseRef.current === null) return;
    if (isAudioMaster) {
      const nextTime = getAudioLessonTime();
      readAudioElement(audioRef)?.pause();
      setEngineTime(nextTime);
      clearScheduled();
      synthRef.current?.releaseAll();
      phaseRef.current = null;
      setEngineStatus("paused");
      stopTicker();
      return;
    }
    const nextTime = getRunningTime();
    setEngineTime(nextTime);
    getTransport().pause();
    clearScheduled();
    synthRef.current?.releaseAll();
    phaseRef.current = null;
    countInRef.current = false;
    setEngineStatus("paused");
    stopTicker();
  }, [audioRef, clearScheduled, getAudioLessonTime, getRunningTime, isAudioMaster, setEngineStatus, setEngineTime, stopTicker]);

  const restart = useCallback(() => {
    if (isAudioMaster) {
      const audio = readAudioElement(audioRef);
      audio?.pause();
      if (audio) audio.currentTime = getAudioSeekTime(0, syncOffsetRef.current, exercise.duration);
      clearScheduled();
      synthRef.current?.releaseAll();
      phaseRef.current = null;
      countInRef.current = false;
      setCountInBeat(0);
      setEngineTime(0);
      setEngineStatus("idle");
      stopTicker();
      return;
    }
    getTransport().stop();
    getTransport().position = 0;
    clearScheduled();
    synthRef.current?.releaseAll();
    phaseRef.current = null;
    countInRef.current = false;
    setCountInBeat(0);
    setEngineTime(0);
    setEngineStatus("idle");
    stopTicker();
  }, [audioRef, clearScheduled, exercise.duration, isAudioMaster, setEngineStatus, setEngineTime, stopTicker]);

  const seek = useCallback((time: number) => {
    const nextTime = clampLessonTime(time, exercise.duration);
    if (isAudioMaster) {
      const wasPlaying = phaseRef.current === "playing";
      clearScheduled();
      const audio = readAudioElement(audioRef);
      if (audio) audio.currentTime = getAudioSeekTime(nextTime, syncOffsetRef.current, exercise.duration);
      setEngineTime(nextTime);
      if (wasPlaying) scheduleExternalPlaybackRef.current();
      else if (nextTime < exercise.duration) setEngineStatus(nextTime === 0 ? "idle" : "paused");
      return;
    }
    const wasPlaying = phaseRef.current === "playing";
    if (phaseRef.current === "count-in") pause();
    setEngineTime(nextTime);
    if (wasPlaying) {
      currentTimeRef.current = nextTime;
      lessonStartRef.current = nextTime;
      transportStartRef.current = getTransport().seconds;
      schedulePlayback(false);
    } else if (nextTime < exercise.duration) {
      setEngineStatus(nextTime === 0 ? "idle" : "paused");
    }
  }, [audioRef, clearScheduled, exercise.duration, isAudioMaster, pause, setEngineStatus, setEngineTime, schedulePlayback]);

  const setSpeed = useCallback((next: PlaybackSpeed) => {
    speedRef.current = next;
    setSpeedState(next);
    if (isAudioMaster) {
      const audio = readAudioElement(audioRef);
      if (audio) audio.playbackRate = next;
      if (phaseRef.current !== null) {
        clearScheduled();
        scheduleExternalPlaybackRef.current();
      }
      return;
    }
    if (phaseRef.current !== null) {
      if (phaseRef.current === "count-in") {
        transportStartRef.current = getTransport().seconds;
        setCountInBeat(1);
        schedulePlayback(true);
        return;
      }
      const nextTime = getRunningTime();
      currentTimeRef.current = nextTime;
      lessonStartRef.current = nextTime;
      transportStartRef.current = getTransport().seconds;
      schedulePlayback(false);
    }
  }, [audioRef, clearScheduled, getRunningTime, isAudioMaster, schedulePlayback]);

  const setHandMode = useCallback((next: HandMode) => {
    handModeRef.current = next;
    setHandModeState(next);
    if (isAudioMaster) {
      if (phaseRef.current !== null) {
        clearScheduled();
        scheduleExternalPlaybackRef.current();
      }
      return;
    }
    if (phaseRef.current !== null) {
      if (phaseRef.current === "count-in") {
        transportStartRef.current = getTransport().seconds;
        schedulePlayback(true);
        return;
      }
      currentTimeRef.current = getRunningTime();
      lessonStartRef.current = currentTimeRef.current;
      transportStartRef.current = getTransport().seconds;
      schedulePlayback(false);
    }
  }, [clearScheduled, getRunningTime, isAudioMaster, schedulePlayback]);

  const setMetronome = useCallback((next: boolean) => {
    metronomeRef.current = next;
    setMetronomeState(next);
    if (isAudioMaster) {
      if (phaseRef.current !== null) {
        clearScheduled();
        if (next) void ensureAudio().then(() => scheduleExternalPlaybackRef.current());
        else {
          metronomeSynthRef.current?.triggerRelease();
          scheduleExternalPlaybackRef.current();
        }
      }
      return;
    }
    if (phaseRef.current !== null) {
      if (phaseRef.current === "count-in") {
        transportStartRef.current = getTransport().seconds;
        schedulePlayback(true);
        return;
      }
      currentTimeRef.current = getRunningTime();
      lessonStartRef.current = currentTimeRef.current;
      transportStartRef.current = getTransport().seconds;
      schedulePlayback(false);
    }
  }, [clearScheduled, ensureAudio, getRunningTime, isAudioMaster, schedulePlayback]);

  const setLoopEnabled = useCallback((next: boolean) => {
    loopEnabledRef.current = next;
    setLoopEnabledState(next);
    if (isAudioMaster) {
      if (phaseRef.current !== null) {
        clearScheduled();
        scheduleExternalPlaybackRef.current();
      }
      return;
    }
    if (phaseRef.current !== null) {
      if (phaseRef.current === "count-in") {
        transportStartRef.current = getTransport().seconds;
        schedulePlayback(true);
        return;
      }
      currentTimeRef.current = getRunningTime();
      lessonStartRef.current = currentTimeRef.current;
      transportStartRef.current = getTransport().seconds;
      schedulePlayback(false);
    }
  }, [clearScheduled, getRunningTime, isAudioMaster, schedulePlayback]);

  const setLoopRange = useCallback((start: number, end: number) => {
    const safeStart = clampLessonTime(Math.min(start, end - 0.1), exercise.duration);
    const safeEnd = clampLessonTime(Math.max(end, safeStart + 0.1), exercise.duration);
    loopStartRef.current = safeStart;
    loopEndRef.current = safeEnd;
    setLoopStart(safeStart);
    setLoopEnd(safeEnd);
    if (isAudioMaster) {
      if (phaseRef.current !== null) {
        clearScheduled();
        scheduleExternalPlaybackRef.current();
      }
      return;
    }
    if (phaseRef.current !== null) {
      if (phaseRef.current === "count-in") {
        transportStartRef.current = getTransport().seconds;
        schedulePlayback(true);
        return;
      }
      currentTimeRef.current = getRunningTime();
      lessonStartRef.current = currentTimeRef.current;
      transportStartRef.current = getTransport().seconds;
      schedulePlayback(false);
    }
  }, [clearScheduled, exercise.duration, getRunningTime, isAudioMaster, schedulePlayback]);

  const setOutputMode = useCallback((next: OutputMode) => {
    outputModeRef.current = next;
    setOutputModeState(next);
    const audio = readAudioElement(audioRef);
    if (audio) audio.volume = next === "piano" ? 0 : originalVolumeRef.current;
    if (isAudioMaster && phaseRef.current !== null) {
      clearScheduled();
      if (next === "original") {
        synthRef.current?.releaseAll();
      }
      void ensureAudio().then(() => scheduleExternalPlaybackRef.current());
    }
  }, [audioRef, clearScheduled, ensureAudio, isAudioMaster]);

  const setOriginalVolume = useCallback((next: number) => {
    const safe = Math.max(0, Math.min(1, next));
    originalVolumeRef.current = safe;
    setOriginalVolumeState(safe);
    const audio = readAudioElement(audioRef);
    if (audio && outputModeRef.current !== "piano") audio.volume = safe;
  }, [audioRef]);

  const setGeneratedVolume = useCallback((next: number) => {
    const safe = Math.max(-30, Math.min(0, next));
    generatedVolumeRef.current = safe;
    setGeneratedVolumeState(safe);
    if (synthRef.current) synthRef.current.volume.value = safe;
  }, []);

  const setSyncOffsetMs = useCallback((next: number) => {
    const safe = Math.max(-1000, Math.min(1000, Math.round(next)));
    syncOffsetRef.current = safe;
    setSyncOffsetMsState(safe);
    if (isAudioMaster) {
      setEngineTime(getAudioLessonTime());
      if (phaseRef.current !== null) {
        clearScheduled();
        scheduleExternalPlaybackRef.current();
      }
    }
  }, [clearScheduled, getAudioLessonTime, isAudioMaster, setEngineTime]);

  useEffect(() => {
    if (!isAudioMaster || !audioFile || !audioRef.current) return;
    const audio = audioRef.current;
    setAudioError(null);
    const ownsUrl = !objectUrl;
    const url = objectUrl ?? URL.createObjectURL(audioFile);
    audio.src = url;
    audio.preload = "auto";
    const pitchAudio = audio as HTMLAudioElement & { mozPreservesPitch?: boolean; preservesPitch?: boolean; webkitPreservesPitch?: boolean };
    const supportsPitchPreservation = "preservesPitch" in pitchAudio || "mozPreservesPitch" in pitchAudio || "webkitPreservesPitch" in pitchAudio;
    setPreservesPitchSupported(supportsPitchPreservation);
    if ("preservesPitch" in pitchAudio) pitchAudio.preservesPitch = true;
    if ("mozPreservesPitch" in pitchAudio) pitchAudio.mozPreservesPitch = true;
    if ("webkitPreservesPitch" in pitchAudio) pitchAudio.webkitPreservesPitch = true;
    const onPlay = () => setEngineStatus("playing");
    const onPause = () => {
      if (phaseRef.current === "playing") {
        phaseRef.current = null;
        setEngineStatus("paused");
        stopTicker();
      }
    };
    const onEnded = () => {
      if (loopEnabledRef.current) return;
      clearScheduled();
      phaseRef.current = null;
      setEngineTime(exercise.duration);
      setEngineStatus("complete");
      stopTicker();
    };
    const onError = () => setAudioError("The uploaded audio could not be loaded in this browser.");
    const onTimeUpdate = () => {
      if (phaseRef.current !== null) setEngineTime(getAudioLessonTime());
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.playbackRate = speedRef.current;
    audio.volume = outputModeRef.current === "piano" ? 0 : originalVolumeRef.current;
    audio.load();
    return () => {
      audio.pause();
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeAttribute("src");
      audio.load();
      if (ownsUrl) URL.revokeObjectURL(url);
    };
  }, [audioFile, audioRef, clearScheduled, exercise.duration, getAudioLessonTime, isAudioMaster, objectUrl, setEngineStatus, setEngineTime, stopTicker]);

  useEffect(() => {
    if (!isAudioMaster || !audioRef.current) return;
    audioRef.current.playbackRate = speed;
    audioRef.current.volume = outputMode === "piano" ? 0 : originalVolume;
  }, [audioRef, isAudioMaster, originalVolume, outputMode, speed]);

  useEffect(() => {
    getTransport().stop();
    clearScheduled();
    const audio = audioRef.current;
    return () => {
      stopTicker();
      clearScheduled();
      getTransport().stop();
      audio?.pause();
      synthRef.current?.releaseAll();
      synthRef.current?.dispose();
      metronomeSynthRef.current?.dispose();
      synthRef.current = null;
      metronomeSynthRef.current = null;
    };
  }, [audioRef, clearScheduled, stopTicker]);

  return { currentTime, status, countInBeat, speed, handMode, metronome, loopEnabled, loopStart, loopEnd, play, pause, restart, seek, setSpeed, setHandMode, setMetronome, setLoopEnabled, setLoopRange, isAudioMaster, audioRef, preservesPitchSupported, audioError, outputMode, setOutputMode, originalVolume, setOriginalVolume, generatedVolume, setGeneratedVolume, syncOffsetMs, setSyncOffsetMs };
}
