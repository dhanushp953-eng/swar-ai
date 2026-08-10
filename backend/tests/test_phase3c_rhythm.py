import io
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.audio import AudioDecoder
from app.services.rhythm import analyze_rhythm


SAMPLE_RATE = 22050


def make_click_track(bpm: float, duration: float = 12.0) -> bytes:
    samples = np.zeros(round(duration * SAMPLE_RATE), dtype=np.float32)
    spacing = 60.0 / bpm
    pulse = np.hanning(round(0.04 * SAMPLE_RATE)).astype(np.float32)
    for timestamp in np.arange(0.15, duration - 0.05, spacing):
        start = round(timestamp * SAMPLE_RATE)
        end = min(start + pulse.size, samples.size)
        samples[start:end] += 0.8 * pulse[: end - start]
    output = io.BytesIO()
    sf.write(output, samples, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return output.getvalue()


def make_wav(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> bytes:
    output = io.BytesIO()
    sf.write(output, samples.astype(np.float32), sample_rate, format="WAV", subtype="PCM_16")
    return output.getvalue()


@pytest.fixture
def app_factory(tmp_path: Path):
    def factory():
        return create_app(Settings(temp_root=tmp_path, analysis_sample_rate=SAMPLE_RATE))

    return factory


def post_audio(client: TestClient, audio: bytes, filename: str = "synthetic.wav"):
    return client.post(
        "/api/analyze",
        data={"authorized": "true"},
        files={"file": (filename, audio, "audio/wav")},
    )


@pytest.mark.parametrize("bpm", [60, 90, 120])
def test_known_click_track_bpm(app_factory, tmp_path: Path, bpm: int):
    with TestClient(app_factory()) as client:
        response = post_audio(client, make_click_track(bpm))
        payload = response.json()
        job_response = client.get(f"/api/jobs/{payload['job_id']}")

    assert response.status_code == 201
    assert payload["status"] == "completed"
    assert payload["estimated_bpm"] == pytest.approx(bpm, abs=8)
    assert payload["duration"] == pytest.approx(12, abs=0.01)
    assert payload["analysis_engine"] == "librosa.beat.beat_track"
    assert payload["analysis_version"] == "3.0.0"
    assert payload["beat_timestamps"] == sorted(payload["beat_timestamps"])
    assert all(0 <= beat <= payload["duration"] for beat in payload["beat_timestamps"])
    assert 0 <= payload["rhythm_confidence"] <= 1
    assert job_response.status_code == 200
    assert job_response.json()["estimated_bpm"] == payload["estimated_bpm"]
    assert list(tmp_path.iterdir()) == []


def test_silence_returns_unknown_without_fabricated_beats(app_factory):
    with TestClient(app_factory()) as client:
        response = post_audio(client, make_wav(np.zeros(SAMPLE_RATE * 3)))

    payload = response.json()
    assert response.status_code == 201
    assert payload["estimated_bpm"] is None
    assert payload["beat_timestamps"] == []
    assert payload["rhythm_confidence"] == 0
    assert any("silent" in warning.lower() for warning in payload["warnings"])


def test_very_short_audio_returns_unknown(app_factory):
    with TestClient(app_factory()) as client:
        response = post_audio(client, make_wav(np.zeros(round(SAMPLE_RATE * 0.25))))

    payload = response.json()
    assert payload["estimated_bpm"] is None
    assert payload["beat_timestamps"] == []
    assert any("short" in warning.lower() for warning in payload["warnings"])


def test_irregular_clicks_reduce_confidence(tmp_path: Path):
    duration = 8.0
    samples = np.zeros(round(duration * SAMPLE_RATE), dtype=np.float32)
    for timestamp in (0.2, 0.9, 2.1, 2.65, 4.0, 5.4, 6.0, 7.7):
        start = round(timestamp * SAMPLE_RATE)
        samples[start : start + round(0.03 * SAMPLE_RATE)] = 0.8

    path = tmp_path / "irregular.wav"
    path.write_bytes(make_wav(samples))
    audio = AudioDecoder(Settings(analysis_sample_rate=SAMPLE_RATE)).decode(path)
    result = analyze_rhythm(audio)

    assert result.confidence < 0.8 or any("irregular" in warning.lower() for warning in result.warnings)


def test_corrupt_audio_is_rejected_and_cleaned_up(app_factory, tmp_path: Path):
    with TestClient(app_factory()) as client:
        response = post_audio(client, b"RIFF\x10\x00\x00\x00WAVEfmt ")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_audio"
    assert list(tmp_path.iterdir()) == []


def test_analysis_failure_marks_job_failed_and_cleans_up(app_factory, tmp_path: Path, monkeypatch):
    app = app_factory()

    def fail(_path):
        raise RuntimeError("synthetic analysis failure")

    monkeypatch.setattr(app.state.rhythm_analyzer, "analyze", fail)
    with TestClient(app) as client:
        response = post_audio(client, make_click_track(120, duration=3))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "analysis_failed"
    record = next(iter(app.state.jobs._jobs.values()))
    assert record.status == "failed"
    assert record.progress == 100
    assert list(tmp_path.iterdir()) == []
