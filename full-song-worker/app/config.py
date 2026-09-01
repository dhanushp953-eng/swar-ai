from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_TEMP_ROOT = Path(os.getenv("FS1_TEMP_ROOT", "full-song-worker/.runtime"))
DEFAULT_MODEL_DIR = Path(os.getenv("FS1_MODEL_DIR", "full-song-worker/.models"))


def _env_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(value: str | None, default: int, minimum: int, maximum: int | None = None) -> int:
    try:
        parsed = int(value) if value is not None else default
    except (TypeError, ValueError):
        parsed = default
    parsed = max(minimum, parsed)
    return min(parsed, maximum) if maximum is not None else parsed


def _env_float(value: str | None, default: float, minimum: float, maximum: float | None = None) -> float:
    try:
        parsed = float(value) if value is not None else default
    except (TypeError, ValueError):
        parsed = default
    parsed = max(minimum, parsed)
    return min(parsed, maximum) if maximum is not None else parsed


@dataclass(frozen=True)
class Settings:
    """Configuration for the Phase FS1 local full-song detection worker."""

    app_name: str = "SwarAI Full-Song Detection Worker (Phase FS1)"
    analysis_version: str = "fs1.0.0"
    max_upload_bytes: int = 25 * 1024 * 1024  # 25 MB
    max_duration_seconds: float = 360.0  # 6 minutes
    target_sample_rate: int = 44100
    analysis_sample_rate: int = 22050
    ffmpeg_binary: str = "ffmpeg"

    temp_root: Path = field(default_factory=lambda: DEFAULT_TEMP_ROOT)
    model_dir: Path = field(default_factory=lambda: DEFAULT_MODEL_DIR)

    # Concurrency control
    max_concurrent_jobs: int = 1
    job_retention_seconds: float = 1800.0  # clean abandoned jobs after 30 min
    cancelled_sweep_seconds: float = 120.0

    # Demucs adapter
    demucs_model: str = "htdemucs"  # replaceable via FS1_DEMUCS_MODEL
    demucs_enabled: bool = True
    demucs_default_sample_rate: int = 44100

    # Whisper adapter
    whisper_model: str = "base"  # CPU-friendly base model
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_enabled: bool = True
    whisper_language: str | None = None  # optional language hint (ISO-639-1)

    # Lyric line grouping
    line_max_chars: int = 80
    line_pause_seconds: float = 0.55
    uncertain_word_confidence: float = 0.45

    # Chord detection
    chord_confidence_threshold: float = 0.40  # below this -> N
    chord_min_duration_seconds: float = 0.60
    cqt_bins_per_octave: int = 36
    chord_smoothing_window: int = 3
    chord_window_seconds: float = 2.0  # fixed-window length used when no reliable beats exist

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            analysis_version=os.getenv("FS1_ANALYSIS_VERSION", cls.analysis_version),
            max_upload_bytes=_env_int(os.getenv("FS1_MAX_UPLOAD_BYTES"), cls.max_upload_bytes, 1, None),
            max_duration_seconds=_env_float(os.getenv("FS1_MAX_DURATION_SECONDS"), cls.max_duration_seconds, 0.1, None),
            target_sample_rate=_env_int(os.getenv("FS1_TARGET_SAMPLE_RATE"), cls.target_sample_rate, 8000, 192000),
            analysis_sample_rate=_env_int(os.getenv("FS1_ANALYSIS_SAMPLE_RATE"), cls.analysis_sample_rate, 8000, 192000),
            ffmpeg_binary=os.getenv("FS1_FFMPEG_BINARY", cls.ffmpeg_binary),
            temp_root=Path(os.getenv("FS1_TEMP_ROOT", str(DEFAULT_TEMP_ROOT))),
            model_dir=Path(os.getenv("FS1_MODEL_DIR", str(DEFAULT_MODEL_DIR))),
            max_concurrent_jobs=_env_int(os.getenv("FS1_MAX_CONCURRENT_JOBS"), cls.max_concurrent_jobs, 1, 16),
            job_retention_seconds=_env_float(os.getenv("FS1_JOB_RETENTION_SECONDS"), cls.job_retention_seconds, 1.0, None),
            cancelled_sweep_seconds=_env_float(os.getenv("FS1_CANCELLED_SWEEP_SECONDS"), cls.cancelled_sweep_seconds, 1.0, None),
            demucs_model=os.getenv("FS1_DEMUCS_MODEL", cls.demucs_model),
            demucs_enabled=_env_bool(os.getenv("FS1_DEMUCS_ENABLED"), cls.demucs_enabled),
            whisper_model=os.getenv("FS1_WHISPER_MODEL", cls.whisper_model),
            whisper_device=os.getenv("FS1_WHISPER_DEVICE", cls.whisper_device),
            whisper_compute_type=os.getenv("FS1_WHISPER_COMPUTE_TYPE", cls.whisper_compute_type),
            whisper_enabled=_env_bool(os.getenv("FS1_WHISPER_ENABLED"), cls.whisper_enabled),
            whisper_language=os.getenv("FS1_WHISPER_LANGUAGE") or None,
            line_max_chars=_env_int(os.getenv("FS1_LINE_MAX_CHARS"), cls.line_max_chars, 20, 200),
            line_pause_seconds=_env_float(os.getenv("FS1_LINE_PAUSE_SECONDS"), cls.line_pause_seconds, 0.0, 10.0),
            uncertain_word_confidence=_env_float(os.getenv("FS1_UNCERTAIN_WORD_CONFIDENCE"), cls.uncertain_word_confidence, 0.0, 1.0),
            chord_confidence_threshold=_env_float(os.getenv("FS1_CHORD_CONFIDENCE_THRESHOLD"), cls.chord_confidence_threshold, 0.0, 1.0),
            chord_min_duration_seconds=_env_float(os.getenv("FS1_CHORD_MIN_DURATION_SECONDS"), cls.chord_min_duration_seconds, 0.0, 60.0),
            cqt_bins_per_octave=_env_int(os.getenv("FS1_CQT_BINS_PER_OCTAVE"), cls.cqt_bins_per_octave, 12, 72),
            chord_smoothing_window=_env_int(os.getenv("FS1_CHORD_SMOOTHING_WINDOW"), cls.chord_smoothing_window, 1, 15),
            chord_window_seconds=_env_float(os.getenv("FS1_CHORD_WINDOW_SECONDS"), cls.chord_window_seconds, 0.25, 30.0),
        )
