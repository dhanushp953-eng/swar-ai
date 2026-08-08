"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import type { HandMode, LessonExercise, LessonStatus } from "@/types/lesson";
import { filterEventsByHand } from "@/utils/lesson-notes";
import { clampLessonTime, getBeatDuration, getCountInDuration, getLessonTimeFromClock, type PlaybackSpeed } from "@/utils/lesson-timing";

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
};

const RENDER_INTERVAL = 1000 / 30;
const getTransport = () => Tone.getTransport();

export function useLessonEngine(exercise: LessonExercise): LessonEngine {
  const [currentTime, setCurrentTime] = useState(0);
  const [status, setStatus] = useState<LessonStatus>("idle");
  const [countInBeat, setCountInBeat] = useState(0);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1);
  const [handMode, setHandModeState] = useState<HandMode>("both");
  const [metronome, setMetronomeState] = useState(false);
  const [loopEnabled, setLoopEnabledState] = useState(false);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(exercise.duration);

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
  const generationRef = useRef(0);
  const tickerRef = useRef<number | null>(null);
  const lastRenderRef = useRef(0);
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const metronomeSynthRef = useRef<Tone.MembraneSynth | null>(null);
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

  const stopTicker = useCallback(() => {
    if (tickerRef.current !== null) window.cancelAnimationFrame(tickerRef.current);
    tickerRef.current = null;
  }, []);

  const getRunningTime = useCallback(() => {
    if (phaseRef.current === "count-in") return 0;
    if (phaseRef.current !== "playing") return currentTimeRef.current;
    return getLessonTimeFromClock(getTransport().seconds - transportStartRef.current, lessonStartRef.current, speedRef.current, countInRef.current ? getCountInDuration(exercise.bpm, speedRef.current) : 0, exercise.duration);
  }, [exercise.bpm, exercise.duration]);

  const clearScheduled = useCallback(() => {
    generationRef.current += 1;
    scheduledIdsRef.current.forEach((id) => getTransport().clear(id));
    scheduledIdsRef.current = [];
  }, []);

  const ensureAudio = useCallback(async () => {
    await Tone.start();
    if (!synthRef.current) {
      synthRef.current = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.008, decay: 0.32, sustain: 0.28, release: 0.75 } }).toDestination();
      synthRef.current.volume.value = -8;
    }
    if (!metronomeSynthRef.current) {
      metronomeSynthRef.current = new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 2, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.08 } }).toDestination();
      metronomeSynthRef.current.volume.value = -15;
    }
  }, []);

  const schedulePlayback = useCallback((includeCountIn: boolean) => {
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
  }, [clearScheduled, exercise, setEngineStatus, setEngineTime, stopTicker]);

  const tick = useCallback((timestamp: number) => {
    if (phaseRef.current === null) return;
    if (timestamp - lastRenderRef.current >= RENDER_INTERVAL) {
      lastRenderRef.current = timestamp;
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
  }, [exercise.bpm, getRunningTime, setEngineStatus, setEngineTime]);

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
  }, [clearScheduled, ensureAudio, schedulePlayback, setEngineStatus, setEngineTime, startTicker]);

  const pause = useCallback(() => {
    if (phaseRef.current === null) return;
    const nextTime = getRunningTime();
    setEngineTime(nextTime);
    getTransport().pause();
    clearScheduled();
    synthRef.current?.releaseAll();
    phaseRef.current = null;
    countInRef.current = false;
    setEngineStatus("paused");
    stopTicker();
  }, [clearScheduled, getRunningTime, setEngineStatus, setEngineTime, stopTicker]);

  const restart = useCallback(() => {
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
  }, [clearScheduled, setEngineStatus, setEngineTime, stopTicker]);

  const seek = useCallback((time: number) => {
    const nextTime = clampLessonTime(time, exercise.duration);
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
  }, [exercise.duration, pause, schedulePlayback, setEngineStatus, setEngineTime]);

  const setSpeed = useCallback((next: PlaybackSpeed) => {
    speedRef.current = next;
    setSpeedState(next);
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
  }, [getRunningTime, schedulePlayback]);

  const setHandMode = useCallback((next: HandMode) => {
    handModeRef.current = next;
    setHandModeState(next);
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
  }, [getRunningTime, schedulePlayback]);

  const setMetronome = useCallback((next: boolean) => {
    metronomeRef.current = next;
    setMetronomeState(next);
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
  }, [getRunningTime, schedulePlayback]);

  const setLoopEnabled = useCallback((next: boolean) => {
    loopEnabledRef.current = next;
    setLoopEnabledState(next);
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
  }, [getRunningTime, schedulePlayback]);

  const setLoopRange = useCallback((start: number, end: number) => {
    const safeStart = clampLessonTime(Math.min(start, end - 0.1), exercise.duration);
    const safeEnd = clampLessonTime(Math.max(end, safeStart + 0.1), exercise.duration);
    loopStartRef.current = safeStart;
    loopEndRef.current = safeEnd;
    setLoopStart(safeStart);
    setLoopEnd(safeEnd);
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
  }, [exercise.duration, getRunningTime, schedulePlayback]);

  useEffect(() => {
    getTransport().stop();
    clearScheduled();
    return () => {
      stopTicker();
      clearScheduled();
      getTransport().stop();
      synthRef.current?.releaseAll();
      synthRef.current?.dispose();
      metronomeSynthRef.current?.dispose();
      synthRef.current = null;
      metronomeSynthRef.current = null;
    };
  }, [clearScheduled, stopTicker]);

  return { currentTime, status, countInBeat, speed, handMode, metronome, loopEnabled, loopStart, loopEnd, play, pause, restart, seek, setSpeed, setHandMode, setMetronome, setLoopEnabled, setLoopRange };
}
