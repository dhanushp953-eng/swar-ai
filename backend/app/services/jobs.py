from dataclasses import dataclass
from threading import Lock

from app.schemas.analysis import AnalysisResult, ErrorResponse, JobResponse


@dataclass
class JobRecord:
    job_id: str
    status: str = "queued"
    progress: int = 0
    result: AnalysisResult | None = None
    error: ErrorResponse | None = None

    def response(self) -> JobResponse:
        return JobResponse(job_id=self.job_id, status=self.status, progress=self.progress, result=self.result, error=self.error)


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

    def update(self, job_id: str, *, status: str | None = None, progress: int | None = None, result: AnalysisResult | None = None, error: ErrorResponse | None = None) -> JobRecord:
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
            return record
