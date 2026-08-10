"use client";

import { AlertTriangle, ArrowRight, Check, FileAudio, LoaderCircle, RefreshCw, ShieldCheck, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  AudioApiError,
  type AnalysisJob,
  formatBytes,
  formatDuration,
  getMaxUploadBytes,
  mapJobStatus,
  pollAnalysisJob,
  SUPPORTED_AUDIO_LABEL,
  uploadAudio,
  validateAudioFile,
  type MelodyNoteEvent,
} from "@/lib/audio-api";

type UploadStatus = "ready" | "uploading" | "validating" | "processing" | "completed" | "failed" | "cancelled";

const STATUS_LABELS: Record<UploadStatus, string> = {
  ready: "Ready",
  uploading: "Uploading",
  validating: "Validating",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_STAGES: UploadStatus[] = ["ready", "uploading", "validating", "processing", "completed"];
const ACCEPTED_AUDIO = ".wav,.mp3,.m4a,.ogg,audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/ogg";

type AudioAnalysisPanelProps = {
  detectedLessonLoaded?: boolean;
  lessonLoadError?: string | null;
  onAnalysisReset?: () => void;
  onLoadDetectedLesson?: (file: File, job: AnalysisJob) => string | null;
};

function getStatusFromJob(job: AnalysisJob): UploadStatus {
  return mapJobStatus(job.status);
}

function statusIndex(status: UploadStatus): number {
  return STATUS_STAGES.indexOf(status);
}

function describeBackendError(error: AnalysisJob["error"]): string | null {
  return error?.message || null;
}

export function AudioAnalysisPanel({ detectedLessonLoaded = false, lessonLoadError = null, onAnalysisReset, onLoadDetectedLesson }: AudioAnalysisPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<UploadStatus>("ready");
  const [progress, setProgress] = useState(0);
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [noteEvents, setNoteEvents] = useState<MelodyNoteEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
    mountedRef.current = false;
    requestRef.current?.abort();
    };
  }, []);

  const applyJob = (nextJob: AnalysisJob) => {
    if (!mountedRef.current) return;
    setJob(nextJob);
    setNoteEvents(nextJob.note_events);
    setProgress(Math.max(0, Math.min(100, nextJob.progress)));
    setStatus(getStatusFromJob(nextJob));
    if (nextJob.status === "failed") setError(describeBackendError(nextJob.error) ?? "The audio could not be analysed.");
  };

  const selectFile = (nextFile: File | null) => {
    onAnalysisReset?.();
    const validationError = validateAudioFile(nextFile);
    setFileError(validationError);
    setError(null);
    setJob(null);
    setNoteEvents([]);
    setProgress(0);
    setStatus("ready");
    if (validationError) {
      setFile(null);
      return;
    }
    setFile(nextFile);
  };

  const beginUpload = async () => {
    if (!file || !authorized || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setError(null);
    setJob(null);
    setNoteEvents([]);
    setProgress(0);
    setStatus("uploading");
    try {
      const initialJob = await uploadAudio(file, controller.signal, (nextProgress) => {
        if (mountedRef.current) setProgress(nextProgress);
      });
      applyJob(initialJob);
      if (initialJob.status !== "completed" && initialJob.status !== "failed") {
        await pollAnalysisJob(initialJob.job_id, controller.signal, applyJob);
      }
    } catch (requestError) {
      if (!mountedRef.current) return;
      if (requestError instanceof AudioApiError && requestError.cancelled) {
        setStatus("cancelled");
      } else if (requestError instanceof AudioApiError) {
        setError(requestError.message);
        setStatus("failed");
      } else {
        setError("The analysis service could not be reached. Check that FastAPI is running and try again.");
        setStatus("failed");
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const cancelUpload = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    if (mountedRef.current) setStatus("cancelled");
  };

  const removeFile = () => {
    onAnalysisReset?.();
    cancelUpload();
    setFile(null);
    setFileError(null);
    setError(null);
    setJob(null);
    setNoteEvents([]);
    setProgress(0);
    setStatus("ready");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const retryUpload = () => {
    setError(null);
    void beginUpload();
  };

  const isBusy = status === "uploading" || status === "validating" || status === "processing";
  const canUpload = Boolean(file && authorized && !isBusy);

  return <section className="audio-analysis-panel" aria-labelledby="audio-analysis-title">
    <div className="audio-analysis-heading">
      <div>
        <p className="eyebrow">Bring your sound / 01A</p>
        <h2 id="audio-analysis-title">Listen closer.</h2>
      </div>
      <p className="audio-analysis-intro">Upload audio you own or are authorised to analyse. SwarAI keeps this pass local and returns rhythm plus monophonic melody detail.</p>
    </div>

    <div className="audio-analysis-grid">
      <div>
        <div
          className={`audio-dropzone ${dragging ? "is-dragging" : ""} ${fileError ? "has-error" : ""}`}
          role="button"
          tabIndex={0}
          aria-label="Choose an audio file"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            selectFile(event.dataTransfer.files[0] ?? null);
          }}
        >
          <input ref={fileInputRef} className="audio-file-input" type="file" accept={ACCEPTED_AUDIO} onChange={(event) => selectFile(event.currentTarget.files?.[0] ?? null)} />
          <span className="audio-dropzone-icon"><UploadCloud size={20} /></span>
          <strong>{dragging ? "Drop it here" : "Drop an audio file here"}</strong>
          <span>or choose one from your device</span>
          <small>{SUPPORTED_AUDIO_LABEL} / up to {formatBytes(getMaxUploadBytes())}</small>
        </div>
        {fileError && <p className="audio-form-error" role="alert"><AlertTriangle size={14} />{fileError}</p>}
      </div>

      <div className="audio-analysis-side">
        {file && <div className="audio-file-card">
          <span className="audio-file-icon"><FileAudio size={18} /></span>
          <div className="audio-file-details"><strong>{file.name}</strong><span>{formatBytes(file.size)} / {file.name.split(".").pop()?.toUpperCase()} / ready to analyse</span></div>
          <button type="button" className="audio-icon-button" onClick={removeFile} aria-label="Remove selected file" disabled={isBusy}><X size={16} /></button>
        </div>}
        <label className="audio-consent"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /><span><ShieldCheck size={16} />I own this audio or have permission to analyse it.</span></label>
        <div className="audio-action-row">
          <button type="button" className="primary-button audio-submit-button" disabled={!canUpload} onClick={() => void beginUpload()}><span>{isBusy ? "Analysing" : "Analyse audio"}</span>{isBusy ? <LoaderCircle className="audio-spin" size={16} /> : <ArrowRight size={16} />}</button>
          {isBusy && <button type="button" className="audio-secondary-button" onClick={cancelUpload}><X size={14} /> Cancel</button>}
          {status === "failed" && <button type="button" className="audio-secondary-button" disabled={!file || !authorized} onClick={retryUpload}><RefreshCw size={14} /> Retry</button>}
          {status === "cancelled" && <button type="button" className="audio-secondary-button" disabled={!file || !authorized} onClick={retryUpload}><RefreshCw size={14} /> Retry</button>}
        </div>
      </div>
    </div>

    <div className="audio-status-region" aria-live="polite">
      <div className="audio-status-header"><span className={`audio-status-dot status-${status}`} /> <strong>{STATUS_LABELS[status]}</strong><span>{status === "uploading" ? `${progress}% uploaded` : status === "completed" ? "Your local analysis is ready" : status === "failed" ? "Nothing was added to your lesson" : status === "cancelled" ? "Upload stopped" : ""}</span></div>
      <div className="audio-status-rail" aria-label={`Analysis status: ${STATUS_LABELS[status]}`}>
        {STATUS_STAGES.map((stage, index) => <div key={stage} className={`audio-status-step ${status === stage ? "is-current" : ""} ${statusIndex(status) > index ? "is-done" : ""}`}><span>{statusIndex(status) > index ? <Check size={11} /> : index + 1}</span>{STATUS_LABELS[stage]}</div>)}
      </div>
      {isBusy && <div className="audio-progress-track"><span style={{ width: `${Math.max(progress, status === "processing" ? 100 : 0)}%` }} /></div>}
      {error && <p className="audio-form-error" role="alert"><AlertTriangle size={14} />{error}</p>}
      {lessonLoadError && <p className="audio-form-error" role="alert"><AlertTriangle size={14} />{lessonLoadError}</p>}
    </div>

    {job?.status === "completed" && <div className="audio-analysis-results" aria-labelledby="audio-results-title">
      <div className="audio-results-heading"><div><p className="eyebrow">Readout / local pass</p><h3 id="audio-results-title">What your sound revealed.</h3></div><span className="audio-results-badge"><Check size={13} /> Complete</span></div>
      <div className="audio-metrics-grid">
        <div><span>Duration</span><strong>{formatDuration(job.duration)}</strong></div>
        <div><span>Estimated BPM</span><strong>{job.estimated_bpm === null ? "Unknown" : Math.round(job.estimated_bpm)}</strong></div>
        <div><span>Rhythm confidence</span><strong>{job.rhythm_confidence === null ? "Unknown" : `${Math.round(job.rhythm_confidence * 100)}%`}</strong></div>
        <div><span>Detected notes</span><strong>{noteEvents.length}</strong></div>
        <div><span>Melody confidence</span><strong>{job.melody_confidence === null ? "Unknown" : `${Math.round(job.melody_confidence * 100)}%`}</strong></div>
      </div>
      <div className="audio-results-foot"><div><span>Rhythm engine</span><strong>{job.analysis_engine ?? "Unknown"}</strong></div><div><span>Melody engine</span><strong>{job.melody_engine ?? "Unknown"}</strong></div></div>
      {job.note_events.length > 0 && <button type="button" className="audio-load-lesson-button" disabled={detectedLessonLoaded} onClick={() => { if (file && onLoadDetectedLesson) onLoadDetectedLesson(file, job); }}>{detectedLessonLoaded ? <><Check size={15} /> Loaded into lesson</> : <><ArrowRight size={15} /> Load detected lesson</>}</button>}
      {job.melody_confidence !== null && job.melody_confidence < 0.5 && <p className="audio-low-confidence"><AlertTriangle size={14} /> Melody confidence is low. Playback is available, but note timing and pitch may be unreliable.</p>}
      {job.warnings.length > 0 && <div className="audio-warnings"><span className="audio-warning-label"><AlertTriangle size={14} /> Warnings</span><ul>{job.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}
    </div>}
  </section>;
}
