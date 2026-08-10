from dataclasses import dataclass
from threading import Lock

from app.schemas.analysis import AnalysisResult, ErrorResponse, JobResponse, MelodyAnalysis, RhythmAnalysis


@dataclass
class JobRecord:
    job_id: str
    status: str = "queued"
    progress: int = 0
    result: AnalysisResult | None = None
    error: ErrorResponse | None = None
    rhythm: RhythmAnalysis | None = None
    melody: MelodyAnalysis | None = None

    def response(self) -> JobResponse:
        warnings = list(dict.fromkeys((self.rhythm.warnings if self.rhythm else []) + (self.melody.warnings if self.melody else [])))
        return JobResponse(
            job_id=self.job_id,
            status=self.status,
            progress=self.progress,
            result=self.result,
            error=self.error,
            duration=self.rhythm.duration if self.rhythm else None,
            estimated_bpm=self.rhythm.estimated_bpm if self.rhythm else None,
            beat_timestamps=self.rhythm.beat_timestamps if self.rhythm else [],
            rhythm_confidence=self.rhythm.rhythm_confidence if self.rhythm else None,
            warnings=warnings,
            analysis_engine=self.rhythm.analysis_engine if self.rhythm else None,
            analysis_version=self.rhythm.analysis_version if self.rhythm else None,
            note_events=self.melody.note_events if self.melody else [],
            melody_confidence=self.melody.melody_confidence if self.melody else None,
            melody_engine=self.melody.melody_engine if self.melody else None,
            melody_analysis_version=self.melody.melody_analysis_version if self.melody else None,
        )


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, JobRecord] = {}
        self._lock = Lock()

    def create(self, job_id: str) -> JobRecord:
        record = JobRecord(job_id=job_id)
        with self._lock:
            self._jobs[job_id] = record
        return record

    def get(self, job_id: str) -> JobRecord | None:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, *, status: str | None = None, progress: int | None = None, result: AnalysisResult | None = None, error: ErrorResponse | None = None, rhythm: RhythmAnalysis | None = None, melody: MelodyAnalysis | None = None) -> JobRecord:
        with self._lock:
            record = self._jobs[job_id]
            if status is not None:
                record.status = status
            if progress is not None:
                record.progress = progress
            if result is not None:
                record.result = result
            if error is not None:
                record.error = error
            if rhythm is not None:
                record.rhythm = rhythm
            if melody is not None:
                record.melody = melody
            return record
