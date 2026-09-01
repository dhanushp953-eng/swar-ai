from __future__ import annotations

import time
from pathlib import Path

import pytest

from app.adapters.ffmpeg import FFmpegAdapter
from app.config import Settings
from app.jobs.runner import JobRunner
from app.jobs.store import JobRecord, JobStore
from app.models import FullSongResult
from app.pipeline.process import JobCancelled


def _settings(tmp_path, concurrent=1):
    return Settings(
        temp_root=Path(tmp_path) / "runtime",
        model_dir=Path(tmp_path) / "models",
        max_concurrent_jobs=concurrent,
        job_retention_seconds=0.2,
        cancelled_sweep_seconds=5.0,
    )


def test_job_store_lifecycle(tmp_path):
    store = JobStore()
    rec = store.create()
    assert rec.status == "queued"
    store.update(rec.job_id, status="validating", progress=5)
    stored = store.get(rec.job_id)
    assert stored.status == "validating"
    assert stored.progress == 5
    assert store.delete(rec.job_id)
    assert store.get(rec.job_id) is None


def test_sweep_abandoned(tmp_path):
    store = JobStore()
    settings = _settings(tmp_path)
    rec = store.create()
    store.update(rec.job_id, status="complete", progress=100)
    time.sleep(settings.job_retention_seconds + 0.1)
    removed = store.sweep_abandoned(settings.job_retention_seconds)
    assert rec.job_id in removed
    assert store.get(rec.job_id) is None


def test_cancel_request_flag(tmp_path):
    store = JobStore()
    rec = store.create()
    assert store.mark_cancel(rec.job_id)
    assert store.get(rec.job_id).cancel_requested


def _min_result(settings, **overrides):
    from app.models import (
        CapabilityInfo,
        FullSongResult,
        ModelInfo,
        SongSheetCompat,
        SongSection,
    )

    defaults = dict(
        analysis_version=settings.analysis_version,
        duration=1.0,
        language="en",
        language_confidence=0.9,
        bpm=120.0,
        chord_events=[],
        chord_anchors=[],
        lyric_words=[],
        lyric_lines=[],
        warnings=[],
        model_info=ModelInfo(
            demucs=CapabilityInfo(name="demucs", available=False),
            whisper=CapabilityInfo(name="whisper", available=False),
            ffmpeg=CapabilityInfo(name="ffmpeg", available=False),
        ),
        song_sheet=SongSheetCompat(
            id="x",
            metadata={"title": "T"},
            chordsUsed=[],
            sections=[],
        ),
        processing_time_seconds=0.1,
    )
    defaults.update(overrides)
    return FullSongResult(**defaults)


def test_runner_completes_and_cleans_up(tmp_path, monkeypatch):
    settings = _settings(tmp_path)
    store = JobStore()
    ffmpeg = object()  # unused placeholder
    runner = JobRunner(settings, store, ffmpeg)

    staged = Path(tmp_path) / "runtime" / "uploads" / "abc" / "input.wav"
    staged.parent.mkdir(parents=True)
    staged.write_bytes(b"FAKE")

    def make_result(**kwargs):
        (settings.temp_root / "decode").mkdir(parents=True, exist_ok=True)
        (settings.temp_root / "decode" / f"{kwargs['song_id']}-mixture.wav").write_bytes(b"x")
        return _min_result(settings)

    monkeypatch.setattr("app.jobs.runner.process_full_song", make_result)

    rec = store.create()
    store.update(rec.job_id, staged_path=str(staged))
    runner.submit(rec, staged, 1.0, "Test")
    deadline = time.time() + 5
    while time.time() < deadline and (store.get(rec.job_id).status not in {"complete", "failed"}):
        time.sleep(0.02)
    final = store.get(rec.job_id)
    assert final.status == "complete"
    # staging directory removed
    assert not staged.parent.exists()
    # decode artifact removed
    assert not (settings.temp_root / "decode" / f"{rec.job_id}-mixture.wav").exists()


def test_runner_cancellation(tmp_path, monkeypatch):
    settings = _settings(tmp_path)
    store = JobStore()
    runner = JobRunner(settings, store, object())

    staged = Path(tmp_path) / "runtime" / "uploads" / "abc" / "input.wav"
    staged.parent.mkdir(parents=True)
    staged.write_bytes(b"FAKE")

    def slow_process(**kwargs):
        store.mark_cancel(kwargs["song_id"])
        raise JobCancelled()

    monkeypatch.setattr("app.jobs.runner.process_full_song", slow_process)

    rec = store.create()
    store.update(rec.job_id, staged_path=str(staged))
    runner.submit(rec, staged, 1.0, "Test")
    deadline = time.time() + 5
    while time.time() < deadline and (store.get(rec.job_id).status not in {"cancelled", "failed", "complete"}):
        time.sleep(0.02)
    assert store.get(rec.job_id).status == "cancelled"
    # Cleanup happens in the runner's finally; poll for it.
    cleanup_deadline = time.time() + 5
    while time.time() < cleanup_deadline and staged.parent.exists():
        time.sleep(0.02)
    assert not staged.parent.exists()


def test_concurrency_limit(tmp_path, monkeypatch):
    """With max_concurrent_jobs=1, a second job must wait for the first."""
    settings = _settings(tmp_path, concurrent=1)
    store = JobStore()
    runner = JobRunner(settings, store, object())

    import threading

    active_flag = {"count": 0, "max": 0}
    lock = threading.Lock()

    def fake_process(**kwargs):
        with lock:
            active_flag["count"] += 1
            active_flag["max"] = max(active_flag["max"], active_flag["count"])
        time.sleep(0.2)
        with lock:
            active_flag["count"] -= 1
        return _min_result(settings)

    monkeypatch.setattr("app.jobs.runner.process_full_song", fake_process)

    staged1 = Path(tmp_path) / "s1.wav"
    staged2 = Path(tmp_path) / "s2.wav"
    staged1.write_bytes(b"1")
    staged2.write_bytes(b"2")
    rec1 = store.create()
    rec2 = store.create()
    runner.submit(rec1, staged1, 1.0, "One")
    runner.submit(rec2, staged2, 1.0, "Two")
    deadline = time.time() + 6
    done = set()
    while time.time() < deadline and len(done) < 2:
        for jid in (rec1.job_id, rec2.job_id):
            if store.get(jid).status in {"complete", "failed"}:
                done.add(jid)
        time.sleep(0.02)
    assert len(done) == 2
    assert active_flag["max"] == 1, "concurrency must not exceed max_concurrent_jobs"
