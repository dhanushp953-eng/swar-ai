from __future__ import annotations

import asyncio
import io

import numpy as np
import pytest
from fastapi import UploadFile

from app.adapters.ffmpeg import FFmpegAdapter
from app.errors import WorkerError
from app.pipeline.upload import sniff_content_type, stage_upload
from tests.audio_fixtures import synth_cg_am_f_progression


class _FakeFFmpeg(FFmpegAdapter):
    """FFmpeg adapter that probes a fixed duration without invoking FFmpeg."""

    def __init__(self, duration: float):
        self._duration = duration

    def available(self) -> bool:
        return True

    def probe_duration(self, path) -> float:
        return self._duration


def make_upload(data: bytes, filename: str, content_type: str) -> UploadFile:
    headers = {"content-type": content_type}
    return UploadFile(filename=filename, file=io.BytesIO(data), headers=headers)


def _run(upload, settings, fake, authorised=True):
    return asyncio.run(stage_upload(upload, settings, fake, authorised=authorised))


def _wav_bytes(audio: np.ndarray | None = None, sr: int = 8000, seconds: float = 0.5) -> bytes:
    import soundfile as sf

    if audio is None:
        audio = np.zeros(int(sr * seconds), dtype=np.float32) + 0.01
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV")
    return buf.getvalue()


def test_requires_authorisation(worker_settings):
    upload = make_upload(_wav_bytes(), "song.wav", "audio/wav")
    fake = _FakeFFmpeg(0.5)
    with pytest.raises(WorkerError) as exc:
        _run(upload, worker_settings, fake, authorised=False)
    assert exc.value.code == "authorization_required"
    assert exc.value.status_code == 403


def test_rejects_empty_file(worker_settings):
    upload = make_upload(b"", "song.wav", "audio/wav")
    fake = _FakeFFmpeg(0.5)
    with pytest.raises(WorkerError) as exc:
        _run(upload, worker_settings, fake)
    assert exc.value.code == "empty_file"


def test_rejects_too_large(worker_settings):
    big = b"0" * (worker_settings.max_upload_bytes + 1)
    upload = make_upload(big, "song.wav", "audio/wav")
    fake = _FakeFFmpeg(0.5)
    with pytest.raises(WorkerError) as exc:
        _run(upload, worker_settings, fake)
    assert exc.value.code == "file_too_large"


def test_rejects_unsupported_extension(worker_settings):
    upload = make_upload(b"RIFF....WAVE", "song.exe", "application/octet-stream")
    fake = _FakeFFmpeg(0.5)
    with pytest.raises(WorkerError) as exc:
        _run(upload, worker_settings, fake)
    assert exc.value.code == "unsupported_extension"


def test_rejects_path_traversal(worker_settings):
    upload = make_upload(_wav_bytes(), "../../../etc/passwd.wav", "audio/wav")
    fake = _FakeFFmpeg(0.5)
    with pytest.raises(WorkerError) as exc:
        _run(upload, worker_settings, fake)
    assert exc.value.code == "unsafe_filename"


def test_rejects_mismatched_content(worker_settings):
    upload = make_upload(b"OggS" + b"\x00" * 30, "song.wav", "audio/ogg")
    fake = _FakeFFmpeg(0.5)
    with pytest.raises(WorkerError) as exc:
        _run(upload, worker_settings, fake)
    assert exc.value.code == "content_type_mismatch"


def test_rejects_corrupted_wav(worker_settings):
    upload = make_upload(b"RIFF....WAVE" + b"\x00" * 50, "song.wav", "audio/wav")
    fake = _FakeFFmpeg(0.5)
    with pytest.raises(WorkerError) as exc:
        _run(upload, worker_settings, fake)
    assert exc.value.code == "invalid_audio"


def test_rejects_generic_mime(worker_settings):
    upload = make_upload(b"RIFF....WAVE" + b"\x00" * 40, "song.wav", "application/octet-stream")
    fake = _FakeFFmpeg(0.5)
    with pytest.raises(WorkerError) as exc:
        _run(upload, worker_settings, fake)
    assert exc.value.code == "invalid_mime_type"


def test_rejects_duration_too_long(worker_settings):
    long_audio = np.zeros(int(worker_settings.max_duration_seconds * 100) + 1000, dtype=np.float32)
    upload = make_upload(_wav_bytes(long_audio, sr=100), "song.wav", "audio/wav")
    fake = _FakeFFmpeg(9999.0)
    with pytest.raises(WorkerError) as exc:
        _run(upload, worker_settings, fake)
    assert exc.value.code == "duration_too_long"


def test_accepts_valid_wav(worker_settings, tmp_path):
    audio = synth_cg_am_f_progression(sr=8000, beats_per_chord=2)[0]
    upload = make_upload(_wav_bytes(audio, sr=8000), "song.wav", "audio/wav")
    fake = _FakeFFmpeg(0.5)
    path, duration = _run(upload, worker_settings, fake)
    assert path.exists()
    assert duration > 0
    assert "song" not in path.name  # random server-generated name


def test_sniff_known_types():
    assert sniff_content_type(b"RIFF....WAVE") == "audio/wav"
    assert sniff_content_type(b"OggS....") == "audio/ogg"
    assert sniff_content_type(b"ID3xxxx") == "audio/mpeg"
    assert sniff_content_type(b"\x00\x00\x00\x18" + b"ftypisom") == "audio/mp4"
    assert sniff_content_type(b"garbage") is None
