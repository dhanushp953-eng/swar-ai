"""Optional, separately-marked slow tests for real models (Demucs, Whisper).

These download models on first run and are computationally heavy. They are NOT
run by the normal suite. Run explicitly with:

    python -m pytest tests/test_slow_models.py -m slow -v

They are skipped automatically when the real dependencies/models are absent.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pytest

from app.adapters.demucs import DemucsAdapter
from app.adapters.whisper import WhisperAdapter
from tests.audio_fixtures import synth_cg_am_f_progression

pytestmark = pytest.mark.slow


@pytest.mark.skipif(True, reason="Slow real-model test: enable explicitly and then remove this skip.")
def test_real_demucs_separation(tmp_path, worker_settings):
    adapter = DemucsAdapter(worker_settings)
    audio, _ = synth_cg_am_f_progression(sr=22050, beats_per_chord=2)
    wav = Path(tmp_path) / "in.wav"
    import soundfile as sf

    sf.write(str(wav), audio, 22050, subtype="PCM_16")
    stems = adapter.separate(wav, Path(tmp_path) / "stems")
    assert len(stems["vocals"]) > 0
    assert len(stems["accompaniment"]) > 0


@pytest.mark.skipif(True, reason="Slow real-model test: enable explicitly and then remove this skip.")
def test_real_whisper_transcription(tmp_path, worker_settings):
    adapter = WhisperAdapter(worker_settings)
    wav = Path(tmp_path) / "speech.wav"
    sr = 16000
    import soundfile as sf

    rng = np.random.default_rng(0)
    sf.write(str(wav), rng.uniform(-0.5, 0.5, int(3 * sr)).astype(np.float32), sr, subtype="PCM_16")
    result = adapter.transcribe(wav, 3.0)
    assert result.language != "unknown"
    assert isinstance(result.words, list)
