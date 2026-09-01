"""Optional, separately-marked slow tests for real models (Demucs, Whisper).

These download models on first run and are computationally heavy. They are NOT
run by the normal suite. Run explicitly with:

    python -m pytest tests/test_slow_models.py -m slow -v

Each test is auto-skipped when its real dependency or model is unavailable, so
they degrade gracefully on a machine without the model stack.
"""

from __future__ import annotations

import importlib.util
import time
from pathlib import Path

import numpy as np
import pytest

from app.adapters.demucs import DemucsAdapter
from app.adapters.whisper import WhisperAdapter
from tests.audio_fixtures import synth_cg_am_f_progression

pytestmark = pytest.mark.slow

_DEMUCS_AVAILABLE = importlib.util.find_spec("demucs") is not None and importlib.util.find_spec("torch") is not None
_WHISPER_AVAILABLE = importlib.util.find_spec("faster_whisper") is not None

require_demucs = pytest.mark.skipif(
    not _DEMUCS_AVAILABLE, reason="demucs/torch not installed; real separation unavailable."
)
require_whisper = pytest.mark.skipif(
    not _WHISPER_AVAILABLE, reason="faster-whisper not installed; real transcription unavailable."
)


def _write_wav(path: Path, audio: np.ndarray, sr: int) -> None:
    import soundfile as sf

    sf.write(str(path), audio, sr, subtype="PCM_16")


@require_demucs
def test_real_demucs_separation(tmp_path, worker_settings):
    """Real Demucs (htdemucs) separation produces vocals and accompaniment."""
    adapter = DemucsAdapter(worker_settings)
    audio, _ = synth_cg_am_f_progression(sr=22050, beats_per_chord=2)
    wav = Path(tmp_path) / "in.wav"
    _write_wav(wav, audio, 22050)
    started = time.monotonic()
    stems = adapter.separate(wav, Path(tmp_path) / "stems")
    assert len(stems["vocals"]) > 0
    assert len(stems["accompaniment"]) > 0
    assert len(stems["vocals"]) == len(stems["accompaniment"])
    assert stems["sample_rate"] > 0
    # Installed real models should run within a sane window on CPU.
    assert time.monotonic() - started < 600


@require_demucs
def test_real_demucs_caches_model(worker_settings, tmp_path):
    """Demucs weights are loaded/downloaded once per process; a second call reuses the cache."""
    import demucs.pretrained

    adapter = DemucsAdapter(worker_settings)
    first = adapter._load_model()
    second = adapter._load_model()
    assert first is second
    assert demucs.pretrained is not None


@require_whisper
def test_real_whisper_transcription(tmp_path, worker_settings):
    """Real faster-whisper transcription returns a well-formed Transcript."""
    adapter = WhisperAdapter(worker_settings)
    sr = 16000
    rng = np.random.default_rng(0)
    audio = rng.uniform(-0.5, 0.5, int(3 * sr)).astype(np.float32)
    wav = Path(tmp_path) / "speech.wav"
    _write_wav(wav, audio, sr)
    started = time.monotonic()
    result = adapter.transcribe(wav, 3.0)
    assert isinstance(result.lines, list)
    assert isinstance(result.words, list)
    assert isinstance(result.warnings, list)
    assert result.language != ""
    assert time.monotonic() - started < 1200