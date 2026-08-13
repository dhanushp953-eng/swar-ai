import os
from dataclasses import dataclass, field
from pathlib import Path


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


def _env_string(value: str | None, default: str) -> str:
    candidate = (value or "").strip()
    return candidate or default


def _provider_priority(value: str | None, default: tuple[str, ...]) -> tuple[str, ...]:
    allowed = {"gemini", "groq", "mock"}
    seen: set[str] = set()
    parsed = []
    for item in (value or "").split(","):
        provider = item.strip().lower()
        if provider in allowed and provider not in seen:
            seen.add(provider)
            parsed.append(provider)
    return tuple(parsed) or default


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
    cors_reflect_lan: bool = True
    transcription_engine: str = "auto"
    basic_pitch_enabled: bool = False
    gemini_api_key: str | None = field(default=None, repr=False, compare=False)
    groq_api_key: str | None = field(default=None, repr=False, compare=False)
    gemini_model: str = "gemini-2.0-flash"
    groq_model: str = "llama-3.1-8b-instant"
    ai_request_timeout_seconds: float = 15.0
    ai_retry_limit: int = 1
    ai_provider_priority: tuple[str, ...] = ("gemini", "groq", "mock")
    ai_max_prompt_chars: int = 4000
    ai_max_response_chars: int = 4000
    ai_max_response_bytes: int = 64 * 1024
    ai_max_output_tokens: int = 512
    ai_mock_fallback_enabled: bool = True
    ai_rate_limit_per_minute: int = 12
    ai_duplicate_window_seconds: float = 4.0

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
            cors_reflect_lan=_env_bool(os.getenv("CORS_REFLECT_LAN"), cls.cors_reflect_lan),
            transcription_engine=engine,
            basic_pitch_enabled=_env_bool(os.getenv("BASIC_PITCH_ENABLED"), cls.basic_pitch_enabled),
            gemini_api_key=(os.getenv("GEMINI_API_KEY") or "").strip() or None,
            groq_api_key=(os.getenv("GROQ_API_KEY") or "").strip() or None,
            gemini_model=_env_string(os.getenv("GEMINI_MODEL"), cls.gemini_model),
            groq_model=_env_string(os.getenv("GROQ_MODEL"), cls.groq_model),
            ai_request_timeout_seconds=_env_float(os.getenv("AI_REQUEST_TIMEOUT_SECONDS"), cls.ai_request_timeout_seconds, 0.1, 120.0),
            ai_retry_limit=_env_int(os.getenv("AI_RETRY_LIMIT"), cls.ai_retry_limit, 0, 5),
            ai_provider_priority=_provider_priority(os.getenv("AI_PROVIDER_PRIORITY"), cls.ai_provider_priority),
            ai_max_prompt_chars=_env_int(os.getenv("AI_MAX_PROMPT_CHARS"), cls.ai_max_prompt_chars, 1, 100_000),
            ai_max_response_chars=_env_int(os.getenv("AI_MAX_RESPONSE_CHARS"), cls.ai_max_response_chars, 1, 100_000),
            ai_max_response_bytes=_env_int(os.getenv("AI_MAX_RESPONSE_BYTES"), cls.ai_max_response_bytes, 1, 1_048_576),
            ai_max_output_tokens=_env_int(os.getenv("AI_MAX_OUTPUT_TOKENS"), cls.ai_max_output_tokens, 1, 4096),
            ai_mock_fallback_enabled=_env_bool(os.getenv("AI_MOCK_FALLBACK_ENABLED"), cls.ai_mock_fallback_enabled),
            ai_rate_limit_per_minute=_env_int(os.getenv("AI_RATE_LIMIT_PER_MINUTE"), cls.ai_rate_limit_per_minute, 1, 1000),
            ai_duplicate_window_seconds=_env_float(os.getenv("AI_DUPLICATE_WINDOW_SECONDS"), cls.ai_duplicate_window_seconds, 0.0, 3600.0),
        )

    @property
    def allowed_cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
