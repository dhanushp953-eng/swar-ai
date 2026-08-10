import os
from dataclasses import dataclass
from pathlib import Path


def _env_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_name: str = "SwarAI Audio Analysis"
    analysis_version: str = "3.0.0"
    melody_analysis_version: str = "3.1.0"
    max_upload_bytes: int = 25 * 1024 * 1024
    max_duration_seconds: float = 300.0
    analysis_sample_rate: int = 22050
    melody_min_frequency: float = 65.406391
    melody_max_frequency: float = 2093.004522
    melody_min_note_duration_seconds: float = 0.08
    melody_merge_gap_seconds: float = 0.06
    melody_min_voiced_probability: float = 0.5
    melody_min_rms: float = 0.005
    melody_hop_length: int = 256
    melody_frame_length: int = 2048
    temp_root: Path = Path("backend/.runtime")
    ffmpeg_binary: str = "ffmpeg"
    cors_origins: str = "http://localhost:3000,http://localhost:3001"
    transcription_engine: str = "auto"
    basic_pitch_enabled: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        engine = os.getenv("TRANSCRIPTION_ENGINE", cls.transcription_engine).strip().lower()
        if engine not in {"auto", "basic-pitch", "librosa"}:
            engine = cls.transcription_engine
        return cls(
            app_name=os.getenv("APP_NAME", cls.app_name),
            analysis_version=os.getenv("ANALYSIS_VERSION", cls.analysis_version),
            melody_analysis_version=os.getenv("MELODY_ANALYSIS_VERSION", cls.melody_analysis_version),
            max_upload_bytes=max(1, int(os.getenv("MAX_UPLOAD_BYTES", cls.max_upload_bytes))),
            max_duration_seconds=max(0.1, float(os.getenv("MAX_DURATION_SECONDS", cls.max_duration_seconds))),
            analysis_sample_rate=max(8000, int(os.getenv("ANALYSIS_SAMPLE_RATE", cls.analysis_sample_rate))),
            melody_min_frequency=max(20.0, float(os.getenv("MELODY_MIN_FREQUENCY", cls.melody_min_frequency))),
            melody_max_frequency=max(21.0, float(os.getenv("MELODY_MAX_FREQUENCY", cls.melody_max_frequency))),
            melody_min_note_duration_seconds=max(0.02, float(os.getenv("MELODY_MIN_NOTE_DURATION_SECONDS", cls.melody_min_note_duration_seconds))),
            melody_merge_gap_seconds=max(0.0, float(os.getenv("MELODY_MERGE_GAP_SECONDS", cls.melody_merge_gap_seconds))),
            melody_min_voiced_probability=max(0.0, min(1.0, float(os.getenv("MELODY_MIN_VOICED_PROBABILITY", cls.melody_min_voiced_probability)))),
            melody_min_rms=max(1e-7, float(os.getenv("MELODY_MIN_RMS", cls.melody_min_rms))),
            melody_hop_length=max(64, int(os.getenv("MELODY_HOP_LENGTH", cls.melody_hop_length))),
            melody_frame_length=max(512, int(os.getenv("MELODY_FRAME_LENGTH", cls.melody_frame_length))),
            temp_root=Path(os.getenv("TEMP_ROOT", str(cls.temp_root))),
            ffmpeg_binary=os.getenv("FFMPEG_BINARY", cls.ffmpeg_binary),
            cors_origins=os.getenv("CORS_ORIGINS", cls.cors_origins),
            transcription_engine=engine,
            basic_pitch_enabled=_env_bool(os.getenv("BASIC_PITCH_ENABLED"), cls.basic_pitch_enabled),
        )

    @property
    def allowed_cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
