"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { convertAnalysisJobToDetectedLesson, type DetectedLesson } from "@/features/lesson/detected-lesson";
import { createLessonImportId } from "@/features/lesson/lesson-transfer";
import type { AnalysisJob } from "@/lib/audio-api";
import type { LessonExercise } from "@/types/lesson";

// Heavy, below-the-fold panels are loaded on demand so the initial bundle stays
// small (Tone.js / Web MIDI are only fetched once the user scrolls to them).
// ssr:false keeps browser-only audio/MIDI code out of server rendering.
function PanelSkeleton({ label }: { label: string }) {
  return (
    <div className="panel-skeleton" aria-busy="true" aria-label={label}>
      <span className="skeleton-bar" />
    </div>
  );
}

const AudioAnalysisPanel = dynamic(
  () => import("@/features/studio/AudioAnalysisPanel").then((module) => ({ default: module.AudioAnalysisPanel })),
  { ssr: false, loading: () => <PanelSkeleton label="Audio analysis" /> },
);
const LessonFilePanel = dynamic(
  () => import("@/features/studio/LessonFilePanel").then((module) => ({ default: module.LessonFilePanel })),
  { ssr: false, loading: () => <PanelSkeleton label="Lesson file" /> },
);
const MidiKeyboardPanel = dynamic(
  () => import("@/features/midi/MidiKeyboardPanel").then((module) => ({ default: module.MidiKeyboardPanel })),
  { ssr: false, loading: () => <PanelSkeleton label="MIDI keyboard" /> },
);
const LessonWorkspace = dynamic(
  () => import("@/features/lesson/LessonWorkspace").then((module) => ({ default: module.LessonWorkspace })),
  { ssr: false, loading: () => <PanelSkeleton label="Practice workspace" /> },
);

export function Studio() {
  const [detectedLesson, setDetectedLesson] = useState<DetectedLesson | null>(null);
  const [lessonLoadError, setLessonLoadError] = useState<string | null>(null);
  const [detectedObjectUrl, setDetectedObjectUrl] = useState<string | null>(null);
  const detectedObjectUrlRef = useRef<string | null>(null);
  const detectedAudioRef = useRef<HTMLAudioElement | null>(null);
  const [importedLesson, setImportedLesson] = useState<LessonExercise | null>(null);
  const [importedLessonKey, setImportedLessonKey] = useState<string | null>(null);
  const setDetectedAudioUrl = useCallback((next: string | null) => {
    detectedObjectUrlRef.current = next;
    setDetectedObjectUrl(next);
  }, []);
  const stopDetectedAudio = useCallback(() => {
    const audio = detectedAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  }, []);
  const loadDetectedLesson = useCallback((file: File, job: AnalysisJob) => {
    const converted = convertAnalysisJobToDetectedLesson(file, job);
    setLessonLoadError(converted.error);
    if (converted.lesson) {
      setDetectedLesson(converted.lesson);
      if (detectedObjectUrlRef.current) URL.revokeObjectURL(detectedObjectUrlRef.current);
      setDetectedAudioUrl(URL.createObjectURL(file));
      stopDetectedAudio();
    }
    return converted.error;
  }, [setDetectedAudioUrl, stopDetectedAudio]);
  const resetDetectedLesson = useCallback(() => {
    if (detectedObjectUrlRef.current) URL.revokeObjectURL(detectedObjectUrlRef.current);
    setDetectedAudioUrl(null);
    stopDetectedAudio();
    setDetectedLesson(null);
    setLessonLoadError(null);
  }, [setDetectedAudioUrl, stopDetectedAudio]);
  const loadImportedLesson = useCallback((lesson: LessonExercise) => {
    setImportedLesson(lesson);
    setImportedLessonKey(createLessonImportId());
  }, []);
  const removeImportedLesson = useCallback(() => {
    setImportedLesson(null);
    setImportedLessonKey(null);
  }, []);
  useEffect(() => () => {
    const url = detectedObjectUrlRef.current;
    if (url) URL.revokeObjectURL(url);
  }, []);
  return <section id="studio" className="studio-section"><div className="section-heading"><div><p className="eyebrow">Practice room / 01</p><h1>Make a little room<br /><em>for your sound.</em></h1></div><p className="heading-copy">A quiet place to build your ear and your hands. Bring your own authorised audio when you&apos;re ready, or load a lesson file to begin.</p></div><AudioAnalysisPanel detectedLessonLoaded={Boolean(detectedLesson)} lessonLoadError={lessonLoadError} onAnalysisReset={resetDetectedLesson} onLoadDetectedLesson={loadDetectedLesson} /><LessonFilePanel importedLesson={importedLesson} onLoadImportedLesson={loadImportedLesson} onRemoveImportedLesson={removeImportedLesson} /><MidiKeyboardPanel /><LessonWorkspace key={detectedLesson?.exercise.id ?? "demo"} detectedLesson={detectedLesson} detectedObjectUrl={detectedObjectUrl} detectedAudioRef={detectedAudioRef} importedLesson={importedLesson} importedLessonKey={importedLessonKey} /><p className="legal-note">Only analyse audio you own or are authorised to use. Please respect the rights of music creators.</p></section>;
}
