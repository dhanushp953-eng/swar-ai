import asyncio
import io
import logging
import math
import struct
import wave
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.schemas.analysis import MelodyAnalysis, RhythmAnalysis


def _fake_analyzers(app) -> None:
    app.state.melody_analyzer.analyze = lambda path: MelodyAnalysis(
        note_events=[],
        melody_confidence=0.0,
        warnings=[],
        melody_engine="librosa.pyin",
        melody_analysis_version="3.1.0",
    )
    app.state.rhythm_analyzer.analyze = lambda path: RhythmAnalysis(
        duration=0.25,
        rhythm_confidence=0.0,
        warnings=[],
        analysis_engine="librosa.beat.beat_track",
        analysis_version="3.0.0",
    )


def make_wav(duration: float = 0.25, sr: int = 8000) -> bytes:
    frames = bytearray()
    for index in range(int(duration * sr)):
        sample = int(9000 * math.sin(2 * math.pi * 440 * index / sr))
        frames.extend(struct.pack("<h", sample))
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sr)
        wav_file.writeframes(frames)
    return output.getvalue()


def test_vercel_disables_background_warmup(tmp_path: object, monkeypatch: pytest.MonkeyPatch) -> None:
    # On Vercel the background warm-up (librosa JIT + pyin model load) must not
    # run, because it can OOM/crash the memory-constrained serverless function
    # during cold start. /api/analyze then processes directly.
    monkeypatch.setenv("VERCEL", "1")
    app = create_app(Settings(temp_root=tmp_path))
    _fake_analyzers(app)
    with TestClient(app) as client:
        assert app.state.warmup_task is None
        assert app.state.warmup_status == "skipped"
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["warmup"] == "skipped"
        response = client.post(
            "/api/analyze",
            data={"authorized": "true"},
            files={"file": ("tone.wav", make_wav(), "audio/wav")},
            headers={"X-Request-ID": "req-test-123"},
        )
        assert response.status_code == 201
        # The request id is echoed so failures can be correlated in logs.
        assert response.headers.get("X-Request-ID") == "req-test-123"


def test_non_vercel_still_runs_warmup(tmp_path: object, monkeypatch: pytest.MonkeyPatch) -> None:
    # Regression guard: only Vercel disables the warm-up. Everywhere else the
    # single background warm-up task is still scheduled.
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("APP_SKIP_WARMUP", raising=False)
    monkeypatch.setattr("app.main._prime_librosa", lambda: None)
    app = create_app(Settings(temp_root=tmp_path))
    with TestClient(app) as client:
        del client
        assert isinstance(app.state.warmup_task, asyncio.Task)
        assert app.state.warmup_status == "warming"


def test_analyze_logs_request_id_and_stage(tmp_path: object, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setenv("VERCEL", "1")
    app = create_app(Settings(temp_root=tmp_path))
    _fake_analyzers(app)
    with caplog.at_level(logging.INFO, logger="app.startup"):
        with TestClient(app) as client:
            response = client.post(
                "/api/analyze",
                data={"authorized": "true"},
                files={"file": ("tone.wav", make_wav(), "audio/wav")},
                headers={"X-Request-ID": "req-log-1"},
            )
    assert response.status_code == 201
    texts = "\n".join(record.getMessage() for record in caplog.records)
    assert "req-log-1" in texts
    assert "stage=receive" in texts
    assert "stage=analyze" in texts
    assert "stage=cleanup" in texts


def test_analyze_logs_sanitized_exception_type(tmp_path: object, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setenv("VERCEL", "1")
    app = create_app(Settings(temp_root=tmp_path))
    app.state.rhythm_analyzer.analyze = MagicMock(side_effect=RuntimeError("boom at C:\\secret\\internal"))
    with caplog.at_level(logging.INFO, logger="app.startup"):
        with TestClient(app) as client:
            response = client.post(
                "/api/analyze",
                data={"authorized": "true"},
                files={"file": ("tone.wav", make_wav(), "audio/wav")},
                headers={"X-Request-ID": "req-fail-1"},
            )
    assert response.status_code == 422
    texts = "\n".join(record.getMessage() for record in caplog.records)
    assert "req-fail-1" in texts
    assert "stage=error" in texts
    # The exception type is logged for triage but internal paths are not leaked.
    assert "exc_type=RuntimeError" in texts
    assert "C:\\secret" not in texts
    assert "stage=cleanup" in texts
