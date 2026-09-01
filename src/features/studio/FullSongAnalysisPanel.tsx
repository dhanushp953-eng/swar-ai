"use client";

import { AlertTriangle, ArrowRight, Check, FileAudio, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  cancelFullSongJob,
  createFullSongJob,
  getFs1ApiUrl,
  getFs1Capabilities,
  getFs1MaxUploadBytes,
  isFs1Terminal,
  pollFullSongJob,
  validateFs1AudioFile,
  Fs1ApiError,
  type Fs1Capability,
  type Fs1Job,
  type Fs1JobStatus,
} from "@/lib/fs1-api";
import { formatBytes } from "@/lib/audio-api";
import { fs1ResultToSongSheet } from "@/lib/song-sheet/from-fs1";
import { setAnalyzedSheet } from "@/lib/song-sheet/analyzed-sheet-store";

type RowStatus = "ready" | "uploading" | Fs1JobStatus;

const STATUS_LABELS: Record<RowStatus, string> = {
  ready: "Ready",
  uploading: "Uploading",
  queued: "Queued",
  validating: "Decoding audio",
  separating: "Separating vocals",
  transcribing: "Transcribing lyrics",
  detecting_chords: "Detecting chords",
  aligning: "Aligning chords",
  complete: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_STAGES: RowStatus[] = ["ready", "uploading", "validating", "separating", "transcribing", "detecting_chords", "aligning", "complete"];
const BUSY_LABEL = "Detecting full song…";
const ACCEPTED_AUDIO = "audio/*,.wav,.mp3,.m4a,.ogg";

type FullSongAnalysisPanelProps = {
  scrollToSongSheet?: () => void;
};

function describeBackendError(error: Fs1Job["error"]): string | null {
  return error?.message || null;
}

function stageIndex(status: RowStatus): number {
  const index = STATUS_STAGES.indexOf(status);
  return index >= 0 ? index : STATUS_STAGES.indexOf("validating");
}

function scrollToId(id: string): void {
  if (typeof document === "undefined") return;
  const element = document.getElementById(id);
  if (element) element.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function FullSongAnalysisPanel({ scrollToSongSheet }: FullSongAnalysisPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<RowStatus>("ready");
  const [starting, setStarting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [job, setJob] = useState<Fs1Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Fs1Capability[] | null>(null);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    getFs1Capabilities(controller.signal)
      .then((next) => {
        if (mountedRef.current) {
          setCapabilities(next);
          setCapabilityError(null);
        }
      })
      .catch((capabilityFailure: unknown) => {
        if (mountedRef.current && !(capabilityFailure instanceof Fs1ApiError && capabilityFailure.cancelled)) {
          setCapabilityError("The full-song worker is unreachable. Start it and retry the analysis.");
        }
      });
    return () => {
      mountedRef.current = false;
      controller.abort();
      requestRef.current?.abort();
    };
  }, []);

  const applyJob = (nextJob: Fs1Job) => {
    if (!mountedRef.current) return;
    setJob(nextJob);
    setProgress(Math.max(0, Math.min(100, nextJob.progress)));
    const nextStatus = nextJob.status === "queued" ? "uploading" : nextJob.status;
    setStatus(nextStatus);
    if (nextJob.status === "failed") setError(describeBackendError(nextJob.error) ?? "The full song could not be analysed.");
    if (nextJob.status === "complete" && nextJob.result) {
      setAnalyzedSheet(fs1ResultToSongSheet(nextJob.result));
    }
  };

  const selectFile = (nextFile: File | null) => {
    const validationError = validateFs1AudioFile(nextFile);
    setFileError(validationError);
    setError(null);
    setJob(null);
    setProgress(0);
    setStatus("ready");
    if (validationError) {
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
    setProgress(0);
    setStarting(true);
    setStatus("ready");
    try {
      if (!mountedRef.current) return;
      setStarting(false);
      setStatus("uploading");
      const initialJob = await createFullSongJob(file, authorized, file.name.replace(/\.[^.]+$/, ""), controller.signal);
      applyJob(initialJob);
      if (!isFs1Terminal(initialJob.status)) {
        const finalJob = await pollFullSongJob(initialJob.job_id, controller.signal);
        applyJob(finalJob);
      }
    } catch (requestError) {
      setStarting(false);
      if (!mountedRef.current) return;
      const aborted = requestError instanceof Fs1ApiError && requestError.cancelled;
      const abortedBySignal = requestError instanceof DOMException && requestError.name === "AbortError";
      if (aborted || abortedBySignal) {
        setStatus("cancelled");
      } else if (requestError instanceof Fs1ApiError) {
        setError(requestError.message);
        setStatus("failed");
      } else {
        setError("The full-song worker could not be reached. Check that it is running and try again.");
        setStatus("failed");
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const cancelUpload = () => {
    const controller = requestRef.current;
    if (job) void cancelFullSongJob(job.job_id);
    if (controller) controller.abort();
    requestRef.current = null;
    if (mountedRef.current) setStatus("cancelled");
  };

  const removeFile = () => {
    cancelUpload();
    setFile(null);
    setFileError(null);
    setError(null);
    setJob(null);
    setProgress(0);
    setStatus("ready");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const retryUpload = () => {
    setError(null);
    void beginUpload();
  };

  const isBusy = status === "uploading" || status === "validating" || status === "separating" || status === "transcribing" || status === "detecting_chords" || status === "aligning" || status === "queued" || starting;
  const canUpload = Boolean(file && authorized && !isBusy);
  const fileFormat = file ? (file.type || file.name.split(".").pop()?.toUpperCase() || "Unknown") : "";
  const unavailable = (capabilities ?? []).filter((capability) => !capability.available);
  const completed = job?.status === "complete" && job.result;

  return <section className="audio-analysis-panel full-song-analysis-panel" aria-labelledby="full-song-analysis-title">
    <div className="audio-analysis-heading">
      <div>
        <p className="eyebrow">Bring your sound / 01B · Full song</p>
        <h2 id="full-song-analysis-title">Learn the whole song.</h2>
      </div>
      <p className="audio-analysis-intro">Upload a full track you own or are authorised to analyse. SwarAI separates vocals, transcribes lyrics and detects chords end-to-end, then opens the result in the song reader on this page.</p>
    </div>

    <div className="audio-analysis-grid">
      <div>
        <div
          className={`audio-dropzone ${dragging ? "is-dragging" : ""} ${fileError ? "has-error" : ""}`}
          role="button"
          tabIndex={0}
          aria-label="Drop audio file here"
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
          <span className="audio-dropzone-icon"><UploadCloud size={20} /></span>
          <strong>{dragging ? "Drop it here" : "Drop an audio file here"}</strong>
          <span>or choose one from your device</span>
          <small>WAV, MP3, M4A or OGG / up to {formatBytes(getFs1MaxUploadBytes())}</small>
        </div>
        <input ref={fileInputRef} key="full-song-file-input" className="audio-choose-button" type="file" accept={ACCEPTED_AUDIO} aria-label="Choose a full-song audio file" onChange={(event) => selectFile(event.currentTarget.files?.[0] ?? null)} />
        {fileError && <p className="audio-form-error" role="alert"><AlertTriangle size={14} />{fileError}</p>}
      </div>

      <div className="audio-analysis-side">
        {file && <div className="audio-file-card">
          <span className="audio-file-icon"><FileAudio size={18} /></span>
          <div className="audio-file-details"><strong>{file.name}</strong><span>{formatBytes(file.size)} / {fileFormat} / ready to analyse</span></div>
          <button type="button" className="audio-icon-button" onClick={removeFile} aria-label="Remove selected file" disabled={isBusy}><X size={16} /></button>
        </div>}
        <label className="audio-consent"><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /><span><ShieldCheck size={16} />I own this audio or have permission to analyse it.</span></label>
        <div className="audio-action-row">
          <button type="button" className="primary-button audio-submit-button" disabled={!canUpload} onClick={() => void beginUpload()}><span>{isBusy ? "Analysing" : "Analyse full song"}</span>{isBusy ? <LoaderCircle className="audio-spin" size={16} /> : <ArrowRight size={16} />}</button>
          {isBusy && <button type="button" className="audio-secondary-button" onClick={cancelUpload}><X size={14} /> Cancel</button>}
          {(status === "failed" || status === "cancelled") && <button type="button" className="audio-secondary-button" disabled={!file || !authorized} onClick={retryUpload}><RefreshCw size={14} /> Retry</button>}
        </div>
      </div>
    </div>

    <div className="audio-status-region" aria-live="polite">
      <div className="audio-status-header"><span className={`audio-status-dot status-${status}`} /> <strong>{starting ? BUSY_LABEL : STATUS_LABELS[status]}</strong><span>{status === "uploading" ? `${progress}% uploaded` : status === "complete" ? "Your song sheet is ready below" : status === "failed" ? "Nothing was added to the song reader" : STATUS_LABELS[status]}</span></div>
      <div className="audio-status-rail" aria-label={`Full-song status: ${STATUS_LABELS[status]}`}>
        {STATUS_STAGES.map((stage, index) => <div key={stage} className={`audio-status-step ${status === stage ? "is-current" : ""} ${stageIndex(status) > index ? "is-done" : ""}`}><span>{stageIndex(status) > index ? <Check size={11} /> : index + 1}</span>{STATUS_LABELS[stage]}</div>)}
      </div>
      {isBusy && <div className="audio-progress-track"><span style={{ width: `${Math.max(progress, status === "complete" ? 100 : 0)}%` }} /></div>}
      {job && job.status === "transcribing" && <p className="audio-low-confidence"><AlertTriangle size={14} /> Transcription can take minutes on large songs. Keep this tab open.</p>}
      {error && <p className="audio-form-error" role="alert"><AlertTriangle size={14} />{error}</p>}
      {capabilityError && <p className="audio-form-error" role="alert"><AlertTriangle size={14} />{capabilityError}</p>}
      {capabilities && unavailable.length > 0 && !isBusy && <p className="audio-form-error" role="alert"><AlertTriangle size={14} />Full-song models are unavailable locally ({unavailable.map((capability) => capability.name).join(", ")}). The worker running at {getFs1ApiUrl()} cannot serve this feature.</p>}
    </div>

    {completed && <div className="audio-analysis-results" aria-labelledby="full-song-results-title">
      <div className="audio-results-heading"><div><p className="eyebrow">Readout / full song</p><h3 id="full-song-results-title">What your song revealed.</h3></div><span className="audio-results-badge"><Sparkles size={13} /> Sheet ready</span></div>
      <div className="audio-metrics-grid">
        <div><span>Duration</span><strong>{Math.round(completed.duration)}s</strong></div>
        <div><span>Detected BPM</span><strong>{completed.bpm === null ? "Unknown" : Math.round(completed.bpm)}</strong></div>
        <div><span>Language</span><strong>{completed.language || "Unknown"}</strong></div>
        <div><span>Chords</span><strong>{completed.song_sheet.chordsUsed.length}</strong></div>
        <div><span>Lyric lines</span><strong>{completed.song_sheet.sections.reduce((count, section) => count + section.lines.length, 0)}</strong></div>
      </div>
      <div className="audio-results-foot"><div><span>Separation</span><strong>{completed.model_info.demucs.model ?? "demucs"}</strong></div><div><span>Transcription</span><strong>{completed.model_info.whisper.model ?? "whisper"}</strong></div></div>
      {completed.warnings.length > 0 && <div className="audio-warnings"><span className="audio-warning-label"><AlertTriangle size={14} /> Warnings</span><ul>{completed.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}
      <button type="button" className="audio-load-lesson-button" onClick={() => { if (scrollToSongSheet) scrollToSongSheet(); else scrollToId("song-chords"); }}><ArrowRight size={15} /> Open in the song reader</button>
    </div>}
  </section>;
}