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
from app.config import Settings
from app.pipeline.chords import detect_chords
from tests.audio_fixtures import (
    cgamf_melody_notes,
    synth_cg_am_f_progression,
    synth_vocal_track,
    weighted_chord_accuracy,
)

pytestmark = pytest.mark.slow

_ACC_CHORD_HZ = {"C": 261.63, "G": 196.00, "Am": 220.00, "F": 174.61}
_ACC_SEQUENCE = ["C", "G", "Am", "F"]

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


def _chord_settings() -> Settings:
    return Settings(
        chord_confidence_threshold=0.40,
        chord_min_duration_seconds=0.40,
        chord_smoothing_window=3,
    )


def _cgamf_expected_segments(beats_per_chord: int, beat_sec: float):
    segment = beats_per_chord * beat_sec
    return [(ch, (i * segment, (i + 1) * segment)) for i, ch in enumerate(_ACC_SEQUENCE)]


@require_demucs
def test_chord_accuracy_gate_direct_and_after_demucs(worker_settings, tmp_path):
    """Chord detection must hold >= 80% weighted accuracy on C-G-Am-F both on
    the direct accompaniment and on real-Demucs-separated accompaniment taken
    from a full mix with a synthetic vocal melody."""
    sr = 22050
    beats_per_chord, beat_sec = 4, 0.5
    accomp, _ = synth_cg_am_f_progression(sr=sr, beats_per_chord=beats_per_chord, beat_sec=beat_sec)
    dur = len(accomp) / sr
    expected = _cgamf_expected_segments(beats_per_chord, beat_sec)
    settings = _chord_settings()

    # 1) DIRECT gate
    direct = detect_chords(accomp, sr, settings)
    assert weighted_chord_accuracy(direct.chords, expected, dur) >= 0.80

    # 2) POST-DEMUCS gate: build a full mix of accompaniment plus a vocal melody.
    vocals = synth_vocal_track(dur, cgamf_melody_notes(_ACC_CHORD_HZ, beats_per_chord, beat_sec), sr=sr)
    mix = np.clip(accomp + 0.35 * vocals, -1.0, 1.0).astype(np.float32)
    wav = Path(tmp_path) / "mix.wav"
    _write_wav(wav, mix, sr)
    stems = DemucsAdapter(worker_settings).separate(wav, Path(tmp_path) / "stems")
    separated = stems["accompaniment"]
    separated_sr = int(stems["sample_rate"])
    sep_dur = min(dur, len(separated) / separated_sr)
    separated_result = detect_chords(separated, separated_sr, settings)
    assert weighted_chord_accuracy(separated_result.chords, expected, sep_dur) >= 0.80