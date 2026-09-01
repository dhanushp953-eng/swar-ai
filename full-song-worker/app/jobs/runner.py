from __future__ import annotations

import logging
import shutil
import threading
from pathlib import Path

from app.adapters.ffmpeg import FFmpegAdapter
from app.config import Settings
from app.errors import WorkerError
from app.jobs.store import JobRecord, JobStore
from app.models import ErrorResponse
from app.pipeline.process import JobCancelled, process_full_song

logger = logging.getLogger("fs1.jobs.runner")


class JobRunner:
    """Runs full-song jobs on bounded-concurrency background workers.

    Heavy work (FFmpeg, Demucs, Whisper, librosa) is CPU-bound and blocking, so
    each job runs in a dedicated worker thread. A semaphore bounds how many
    jobs may run concurrently so multiple songs cannot exhaust the computer.
    """

    def __init__(self, settings: Settings, store: JobStore, ffmpeg: FFmpegAdapter):
        self.settings = settings
        self.store = store
        self.ffmpeg = ffmpeg
        self._semaphore = threading.BoundedSemaphore(settings.max_concurrent_jobs)
        self._lock = threading.Lock()
        self._running: set[str] = set()

    def submit(self, record: JobRecord, staged_wav: Path, duration: float, title: str) -> None:
        worker = threading.Thread(target=self._run, args=(record.job_id, str(staged_wav), duration, title), daemon=True)
        with self._lock:
            self._running.add(record.job_id)
        worker.start()

    def _run(self, job_id: str, staged_wav: str, duration: float, title: str) -> None:
        acquired = self._semaphore.acquire(timeout=1.0)
        try:
            self.store.update(job_id, status="validating", progress=5)
            if not acquired:
                logger.warning("Concurrency slot timed out for job %s", job_id)
                self.store.update(job_id, status="failed", progress=100, error=ErrorResponse(code="busy", message="The worker is at full capacity; try again later.", details={}))
                return
            try:
                self.store.update(job_id, status="separating", progress=15, staged_path=staged_wav)
                result = process_full_song(
                    settings=self.settings,
                    staged_wav=Path(staged_wav),
                    duration_seconds=duration,
                    ffmpeg=self.ffmpeg,
                    song_id=job_id,
                    title=title or "Untitled song",
                    progress=lambda f, m: self._map_progress(job_id, f, m),
                    cancel_token=lambda: self._is_cancelled(job_id),
                )
                self.store.update(job_id, status="complete", progress=100, result=result)
            except JobCancelled:
                self.store.update(job_id, status="cancelled", progress=0)
                logger.info("Job %s cancelled by user", job_id)
            except WorkerError as exc:
                self.store.update(job_id, status="failed", progress=100, error=ErrorResponse(code=exc.code, message=exc.message, details=exc.details))
                logger.warning("Job %s failed: %s (%s)", job_id, exc.code, exc.message)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Job %s crashed", job_id)
                self.store.update(job_id, status="failed", progress=100, error=ErrorResponse(code="internal_error", message="The full-song job failed internally.", details={"type": type(exc).__name__}))
            finally:
                self._cleanup_job_files(job_id)
        finally:
            if acquired:
                self._semaphore.release()
            with self._lock:
                self._running.discard(job_id)

    def _is_cancelled(self, job_id: str) -> bool:
        record = self.store.get(job_id)
        return bool(record and record.cancel_requested)

    def _map_progress(self, job_id: str, fraction: float, message: str) -> None:
        # Map pipeline fraction (0..1) onto stages; primarily used for message + coarse progress.
        pct = int(10 + fraction * 75)
        self.store.update(job_id, progress=pct)
        logger.debug("job %s progress=%s %s", job_id, fraction, message)

    def _cleanup_job_files(self, job_id: str) -> None:
        for root in ("decode", "stems"):
            directory = self.settings.temp_root / root
            for candidate in directory.glob(f"{job_id}-*"):
                try:
                    if candidate.is_dir():
                        shutil.rmtree(candidate, ignore_errors=True)
                    else:
                        candidate.unlink(missing_ok=True)
                except OSError:
                    logger.warning("Could not remove temp file %s", candidate)
        staged = self.store.get(job_id)
        if staged and staged.staged_path:
            parent = Path(staged.staged_path).parent
            if parent.exists():
                shutil.rmtree(parent, ignore_errors=True)

    def sweep(self) -> None:
        removed = self.store.sweep_abandoned(self.settings.job_retention_seconds)
        for job_id in removed:
            logger.info("Swept abandoned job %s", job_id)
