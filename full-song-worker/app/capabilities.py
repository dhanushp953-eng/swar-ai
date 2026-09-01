from __future__ import annotations

import importlib.util
import shutil

from app.config import Settings
from app.models import CapabilityInfo


def _module_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def ffmpeg_capability(settings: Settings) -> CapabilityInfo:
    binary = shutil.which(settings.ffmpeg_binary)
    if binary:
        return CapabilityInfo(name="ffmpeg", available=True, model=settings.ffmpeg_binary)
    return CapabilityInfo(
        name="ffmpeg",
        available=False,
        reason="FFmpeg executable not found on PATH. Install FFmpeg to decode MP3/M4A/OGG and run vocal separation.",
    )


def demucs_capability(settings: Settings) -> CapabilityInfo:
    if not settings.demucs_enabled:
        return CapabilityInfo(name="demucs", available=False, reason="Demucs is disabled via configuration.")
    if not (_module_available("demucs") and _module_available("torch")):
        return CapabilityInfo(
            name="demucs",
            available=False,
            reason="demucs and/or torch are not installed. Vocal separation is unavailable; lyrics transcription may still work on the mixture.",
        )
    return CapabilityInfo(name="demucs", available=True, model=settings.demucs_model)


def whisper_capability(settings: Settings) -> CapabilityInfo:
    if not settings.whisper_enabled:
        return CapabilityInfo(name="whisper", available=False, reason="Whisper is disabled via configuration.")
    if not _module_available("faster_whisper"):
        return CapabilityInfo(
            name="whisper",
            available=False,
            reason="faster-whisper is not installed. Timed lyrics transcription is unavailable.",
        )
    return CapabilityInfo(name="whisper", available=True, model=settings.whisper_model)
