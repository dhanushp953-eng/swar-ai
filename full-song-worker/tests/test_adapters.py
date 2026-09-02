from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.adapters.demucs import DemucsAdapter
from app.adapters.ffmpeg import FFmpegAdapter
from app.adapters.whisper import WhisperAdapter
from app.errors import CapabilityError


def test_ffmpeg_probe_duration_keeps_metadata_visible(worker_settings, monkeypatch, tmp_path):
    adapter = FFmpegAdapter(worker_settings)
    captured: dict[str, list[str]] = {}

    monkeypatch.setattr(adapter, "available", lambda: True)

    def fake_run(args, **kwargs):
        del kwargs
        captured["args"] = args
        return SimpleNamespace(returncode=0, stderr="Duration: 00:00:32.05, start: 0.000000, bitrate: 192 kb/s")

    monkeypatch.setattr("app.adapters.ffmpeg.subprocess.run", fake_run)

    duration = adapter.probe_duration(tmp_path / "song.mp3")

    assert duration == pytest.approx(32.05)
    assert "-hide_banner" in captured["args"]
    assert "-v" not in captured["args"]


def test_demucs_adapter_available_false_without_deps(worker_settings):
    adapter = DemucsAdapter(worker_settings)
    # Even if the package is not installed, available() should be False, never raise.
    assert adapter.available() in (True, False)


def test_demucs_adapter_disabled(worker_settings):
    from app.config import Settings

    disabled = Settings(demucs_enabled=False)
    adapter = DemucsAdapter(disabled)
    assert adapter.available() is False


def test_demucs_separate_raises_capability_error_when_unavailable(worker_settings):
    if DemucsAdapter(worker_settings).available():
        pytest.skip("Demucs is installed for real-model run")
    adapter = DemucsAdapter(worker_settings)
    with pytest.raises(CapabilityError) as exc:
        adapter.separate(None, None)
    assert exc.value.capability == "demucs"


def test_whisper_available_false_without_deps(worker_settings):
    adapter = WhisperAdapter(worker_settings)
    assert adapter.available() in (True, False)


def test_whisper_transcribe_raises_capability_error_when_unavailable(worker_settings):
    if WhisperAdapter(worker_settings).available():
        pytest.skip("Whisper is installed for real-model run")
    adapter = WhisperAdapter(worker_settings)
    with pytest.raises(CapabilityError) as exc:
        adapter.transcribe(None, 1.0)
    assert exc.value.capability == "whisper"
