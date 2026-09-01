from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from threading import Lock

from app.models import ErrorResponse, FullSongJob, FullSongResult


@dataclass
class JobRecord:
    job_id: str
    status: str = "queued"
    progress: int = 0
    result: FullSongResult | None = None
    error: ErrorResponse | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    cancel_requested: bool = False
    staged_path: str | None = None

    def response(self) -> FullSongJob:
        return FullSongJob(
            job_id=self.job_id,
            status=self.status,
            progress=self.progress,
            result=self.result,
            error=self.error,
        )


class JobStore:
    """Thread-safe in-memory job store. Results are held only temporarily."""

    def __init__(self) -> None:
        self._records: dict[str, JobRecord] = {}
        self._lock = Lock()

    def create(self) -> JobRecord:
        record = JobRecord(job_id=uuid.uuid4().hex)
        with self._lock:
            self._records[record.job_id] = record
        return record

    def get(self, job_id: str) -> JobRecord | None:
        with self._lock:
            return self._records.get(job_id)

    def update(
        self,
        job_id: str,
        *,
        status: str | None = None,
        progress: int | None = None,
        result: FullSongResult | None = None,
        error: ErrorResponse | None = None,
        cancel_requested: bool | None = None,
        staged_path: str | None = None,
    ) -> JobRecord | None:
        with self._lock:
            record = self._records.get(job_id)
            if record is None:
                return None
            if status is not None:
                record.status = status
            if progress is not None:
                record.progress = min(100, max(0, progress))
            if result is not None:
                record.result = result
            if error is not None:
                record.error = error
            if cancel_requested is not None:
                record.cancel_requested = cancel_requested
            if staged_path is not None:
                record.staged_path = staged_path
            record.updated_at = time.time()
            return record

    def mark_cancel(self, job_id: str) -> bool:
        return self.update(job_id, cancel_requested=True) is not None

    def delete(self, job_id: str) -> bool:
        with self._lock:
            return self._records.pop(job_id, None) is not None

    def snapshot(self) -> list[JobRecord]:
        with self._lock:
            return list(self._records.values())

    def sweep_abandoned(self, max_age_seconds: float) -> list[str]:
        now = time.time()
        removed: list[str] = []
        with self._lock:
            for job_id, record in list(self._records.items()):
                terminal = record.status in {"complete", "failed", "cancelled"}
                age = now - record.updated_at
                if terminal and age > max_age_seconds:
                    removed.append(job_id)
                    self._records.pop(job_id, None)
        return removed
