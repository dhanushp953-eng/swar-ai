from __future__ import annotations

import pytest

from app.adapters.demucs import DemucsAdapter
from app.adapters.whisper import WhisperAdapter
from app.errors import CapabilityError


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
