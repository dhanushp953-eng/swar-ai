import asyncio
import io
import math
import struct
import time
import wave

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.schemas.analysis import MelodyAnalysis, RhythmAnalysis


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


def test_warmup_runs_once_and_reports_status(tmp_path: object, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def fake_prime() -> None:
        calls["n"] += 1
        time.sleep(0.2)

    monkeypatch.setattr("app.main._prime_librosa", fake_prime)
    app = create_app(Settings(temp_root=tmp_path))
    with TestClient(app) as client:
        assert app.state.warmup_status == "warming"
        assert isinstance(app.state.warmup_task, asyncio.Task)
        client.get("/health")  # must not trigger a second warm-up
        for _ in range(200):
            if app.state.warmup_task.done():
                break
            time.sleep(0.01)
    assert calls["n"] == 1  # primed exactly once, even with an extra request
    assert app.state.warmup_status == "ready"


def test_request_during_warmup_waits_for_same_task(tmp_path: object, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def slow_prime() -> None:
        calls["n"] += 1
        time.sleep(0.4)

    monkeypatch.setattr("app.main._prime_librosa", slow_prime)
    app = create_app(Settings(temp_root=tmp_path))
    _fake_analyzers(app)
    with TestClient(app) as client:
        assert app.state.warmup_status == "warming"
        response = client.post(
            "/api/analyze",
            data={"authorized": "true"},
            files={"file": ("tone.wav", make_wav(), "audio/wav")},
        )
        assert response.status_code == 201
        # The request did not re-prime librosa; it awaited the single warm-up task.
        assert calls["n"] == 1
        assert app.state.warmup_status == "ready"


def test_warmup_failure_fallback_keeps_service_up(tmp_path: object, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom() -> None:
        raise RuntimeError("librosa exploded")

    monkeypatch.setattr("app.main._prime_librosa", boom)
    app = create_app(Settings(temp_root=tmp_path))
    _fake_analyzers(app)
    with TestClient(app) as client:
        for _ in range(200):
            if app.state.warmup_status in ("ready", "failed"):
                break
            time.sleep(0.01)
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["warmup"] == "failed"
        # Analysis still works even though warm-up failed (first request pays JIT).
        response = client.post(
            "/api/analyze",
            data={"authorized": "true"},
            files={"file": ("tone.wav", make_wav(), "audio/wav")},
        )
        assert response.status_code == 201
