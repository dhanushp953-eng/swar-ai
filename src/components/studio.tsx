"use client";

import { useEffect, useRef, useState } from "react";
import { LessonWorkspace } from "@/features/lesson/LessonWorkspace";
import { convertAnalysisJobToDetectedLesson, type DetectedLesson } from "@/features/lesson/detected-lesson";
import { AudioAnalysisPanel } from "@/features/studio/AudioAnalysisPanel";
import type { AnalysisJob } from "@/lib/audio-api";

export function Studio() {
  const [detectedLesson, setDetectedLesson] = useState<DetectedLesson | null>(null);
  const [lessonLoadError, setLessonLoadError] = useState<string | null>(null);
  const [detectedObjectUrl, setDetectedObjectUrl] = useState<string | null>(null);
  const detectedObjectUrlRef = useRef<string | null>(null);
  const detectedAudioRef = useRef<HTMLAudioElement | null>(null);
  const setDetectedAudioUrl = (next: string | null) => {
    detectedObjectUrlRef.current = next;
    setDetectedObjectUrl(next);
  };
  const stopDetectedAudio = () => {
    const audio = detectedAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  };
  const loadDetectedLesson = (file: File, job: AnalysisJob) => {
    const converted = convertAnalysisJobToDetectedLesson(file, job);
    setLessonLoadError(converted.error);
    if (converted.lesson) {
      setDetectedLesson(converted.lesson);
      if (detectedObjectUrlRef.current) URL.revokeObjectURL(detectedObjectUrlRef.current);
      setDetectedAudioUrl(URL.createObjectURL(file));
      stopDetectedAudio();
    }
    return converted.error;
  };
  const resetDetectedLesson = () => {
    if (detectedObjectUrlRef.current) URL.revokeObjectURL(detectedObjectUrlRef.current);
    setDetectedAudioUrl(null);
    stopDetectedAudio();
    setDetectedLesson(null);
    setLessonLoadError(null);
  };
  useEffect(() => () => {
    const url = detectedObjectUrlRef.current;
    if (url) URL.revokeObjectURL(url);
  }, []);
  return <section id="studio" className="studio-section"><div className="section-heading"><div><p className="eyebrow">Practice room / 01</p><h1>Make a little room<br /><em>for your sound.</em></h1></div><p className="heading-copy">A quiet place to build your ear and your hands. Start with the instrument below, then bring your own authorised audio when you&apos;re ready.</p></div><AudioAnalysisPanel detectedLessonLoaded={Boolean(detectedLesson)} lessonLoadError={lessonLoadError} onAnalysisReset={resetDetectedLesson} onLoadDetectedLesson={loadDetectedLesson} /><LessonWorkspace key={detectedLesson?.exercise.id ?? "demo"} detectedLesson={detectedLesson} detectedObjectUrl={detectedObjectUrl} detectedAudioRef={detectedAudioRef} /><p className="legal-note">Only analyse audio you own or are authorised to use. Please respect the rights of music creators.</p></section>;
}
