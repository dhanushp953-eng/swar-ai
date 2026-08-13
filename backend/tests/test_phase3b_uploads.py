import io
import math
import struct
import wave
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def make_wav(duration: float = 0.25, sample_rate: int = 8000) -> bytes:
    frames = bytearray()
    for index in range(int(duration * sample_rate)):
        sample = int(9000 * math.sin(2 * math.pi * 440 * index / sample_rate))
        frames.extend(struct.pack("<h", sample))
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(frames)
    return output.getvalue()


@pytest.fixture
def app_factory(tmp_path: Path):
    def factory(max_upload_bytes: int = 25 * 1024 * 1024):
        return create_app(Settings(temp_root=tmp_path, max_upload_bytes=max_upload_bytes))

    return factory


def post_wav(client: TestClient, data: bytes | None = None, filename: str = "tone.wav", mime: str = "audio/wav", form: dict[str, str] | None = None):
    return client.post("/api/analyze", data={"authorized": "true"} if form is None else form, files={"file": (filename, make_wav() if data is None else data, mime)})


def test_health_is_preserved(app_factory):
    with TestClient(app_factory()) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_valid_wav_is_validated_and_cleaned_up(app_factory, tmp_path: Path):
    with TestClient(app_factory()) as client:
        response = post_wav(client)
        assert response.status_code == 201
        payload = response.json()
        assert payload["status"] == "completed"
        assert payload["progress"] == 100
        assert payload["analysis_engine"] == "librosa.beat.beat_track"
        job_response = client.get(f"/api/jobs/{payload['job_id']}")
    assert job_response.status_code == 200
    assert job_response.json()["status"] == "completed"
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("form", [{}, {"authorized": "false"}])
def test_authorization_is_required(app_factory, form):
    with TestClient(app_factory()) as client:
        response = post_wav(client, form=form)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "authorization_required"


def test_empty_file_is_rejected_and_cleaned_up(app_factory, tmp_path: Path):
    with TestClient(app_factory()) as client:
        response = post_wav(client, data=b"")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "empty_file"
    assert list(tmp_path.iterdir()) == []


def test_unsupported_extension_is_rejected(app_factory):
    with TestClient(app_factory()) as client:
        response = post_wav(client, filename="tone.txt", mime="text/plain")
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_extension"


def test_invalid_mime_type_is_rejected(app_factory):
    with TestClient(app_factory()) as client:
        response = post_wav(client, mime="audio/mpeg")
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "invalid_mime_type"


def test_extension_and_signature_must_match(app_factory):
    with TestClient(app_factory()) as client:
        response = post_wav(client, filename="tone.mp3", mime="audio/mpeg")
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "content_type_mismatch"


def test_path_traversal_filename_is_rejected(app_factory):
    with TestClient(app_factory()) as client:
        response = post_wav(client, filename="../tone.wav")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "unsafe_filename"


def test_size_limit_is_enforced(app_factory):
    with TestClient(app_factory(max_upload_bytes=32)) as client:
        response = post_wav(client)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "file_too_large"


def test_corrupt_wav_header_is_rejected(app_factory, tmp_path: Path):
    corrupted = b"RIFF\x10\x00\x00\x00WAVEfmt "
    with TestClient(app_factory()) as client:
        response = post_wav(client, data=corrupted)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_audio"
    assert list(tmp_path.iterdir()) == []


def test_unknown_job_is_rejected(app_factory):
    with TestClient(app_factory()) as client:
        response = client.get("/api/jobs/not-a-real-job")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "job_not_found"


def test_analysis_failure_returns_safe_message_without_internal_paths(app_factory, tmp_path: Path):
    # A generic failure during processing must not leak internal paths or stack
    # details to the client; the response stays generic and the temp file is
    # cleaned up.
    app = app_factory()
    app.state.rhythm_analyzer.analyze = MagicMock(side_effect=RuntimeError("boom at C:\\secret\\internal\\path\\to\\librosa"))
    with TestClient(app) as client:
        response = post_wav(client)
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "analysis_failed"
    assert body["error"]["message"] == "The audio could not be analyzed."
    assert body["error"]["details"] == {}
    assert "C:\\secret" not in str(body)
    assert list(tmp_path.iterdir()) == []
