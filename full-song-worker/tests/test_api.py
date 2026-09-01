from __future__ import annotations

import io
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.audio_fixtures import synth_cg_am_f_progression


def _wav_bytes(sr: int = 8000, seconds: float = 0.5) -> bytes:
    import numpy as np
    import soundfile as sf

    buf = io.BytesIO()
    sf.write(buf, np.zeros(int(sr * seconds), dtype=np.float32) + 0.01, sr, format="WAV")
    return buf.getvalue()


@pytest.fixture()
def client(worker_settings):
    app = create_app(worker_settings)
    return TestClient(app)


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "analysis_version" in body


def test_capabilities(client):
    resp = client.get("/capabilities")
    assert resp.status_code == 200
    names = {c["name"] for c in resp.json()["capabilities"]}
    assert {"ffmpeg", "demucs", "whisper"} <= names


def test_post_requires_authorisation(client):
    resp = client.post(
        "/v1/full-song/jobs",
        files={"file": ("song.wav", _wav_bytes(), "audio/wav")},
        data={"authorised": "false"},
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "authorization_required"


def test_post_rejects_invalid_file(client):
    resp = client.post(
        "/v1/full-song/jobs",
        files={"file": ("song.wav", b"not really audio", "audio/wav")},
        data={"authorised": "true"},
    )
    assert resp.status_code in (400, 415, 422)


def test_post_and_get_job_lifecycle(client, worker_settings, monkeypatch):
    from app.models import CapabilityInfo, FullSongResult, ModelInfo, SongSheetCompat

    events = []
    block = {"done": False}

    def fake_process(**kwargs):
        events.append(kwargs["song_id"])
        block["done"] = True
        return FullSongResult(
            analysis_version=worker_settings.analysis_version,
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
            song_sheet=SongSheetCompat(id="x", metadata={"title": "T"}, chordsUsed=[], sections=[]),
            processing_time_seconds=0.1,
        )

    monkeypatch.setattr("app.jobs.runner.process_full_song", fake_process)

    resp = client.post(
        "/v1/full-song/jobs",
        files={"file": ("song.wav", _wav_bytes(), "audio/wav")},
        data={"authorised": "true", "title": "Test Tune"},
    )
    assert resp.status_code == 201
    job_id = resp.json()["job_id"]
    deadline = time.time() + 5
    while time.time() < deadline:
        st = client.get(f"/v1/full-song/jobs/{job_id}").json()["status"]
        if st in {"complete", "failed", "cancelled"}:
            break
        time.sleep(0.02)
    final = client.get(f"/v1/full-song/jobs/{job_id}").json()
    assert final["status"] in {"complete", "failed", "cancelled"}
    assert job_id in events


def test_get_missing_job_404(client):
    resp = client.get("/v1/full-song/jobs/nonexistent")
    assert resp.status_code == 404


def test_delete_job(client, worker_settings, monkeypatch):
    def fake_process(**kwargs):
        raise RuntimeError("should not reach after delete")

    monkeypatch.setattr("app.jobs.runner.process_full_song", fake_process)

    resp = client.post(
        "/v1/full-song/jobs",
        files={"file": ("song.wav", _wav_bytes(), "audio/wav")},
        data={"authorised": "true"},
    )
    job_id = resp.json()["job_id"]
    del_resp = client.delete(f"/v1/full-song/jobs/{job_id}")
    assert del_resp.status_code == 200
    body = del_resp.json()
    assert body["status"] == "cancelled"
    # job removed from store
    assert client.get(f"/v1/full-song/jobs/{job_id}").status_code == 404
