from __future__ import annotations

import shutil
import uuid
import wave
from pathlib import Path

from fastapi import UploadFile

from app.adapters.ffmpeg import FFmpegAdapter
from app.config import Settings
from app.errors import WorkerError

ALLOWED_SUFFIXES = {".wav", ".mp3", ".m4a", ".ogg"}
MIME_BY_SUFFIX = {
    ".wav": {"audio/wav", "audio/x-wav", "audio/wave"},
    ".mp3": {"audio/mpeg", "audio/mp3", "audio/x-mpeg"},
    ".m4a": {"audio/mp4", "audio/x-m4a", "audio/m4a"},
    ".ogg": {"audio/ogg", "application/ogg", "audio/x-ogg"},
}


def sniff_content_type(content: bytes) -> str | None:
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WAVE":
        return "audio/wav"
    if content[:4] == b"OggS":
        return "audio/ogg"
    if content[:3] == b"ID3" or (len(content) >= 2 and content[0] == 0xFF and content[1] & 0xE0 == 0xE0):
        return "audio/mpeg"
    if len(content) >= 12 and content[4:8] == b"ftyp":
        return "audio/mp4"
    return None


def _validate_filename(filename: str | None) -> Path:
    raw = filename or ""
    if not raw:
        raise WorkerError("unsafe_filename", "No filename was provided.", 400)
    name = Path(raw).name
    if name != raw or ".." in Path(raw).parts:
        raise WorkerError("unsafe_filename", "The uploaded filename is not safe.", 400)
    suffix = Path(raw).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise WorkerError(
            "unsupported_extension",
            "Only WAV, MP3, M4A and OGG files are accepted.",
            415,
            {"provided": suffix or "none"},
        )
    return Path(raw)


def _validate_matches(filename: Path, declared: str | None, detected: str | None) -> None:
    if detected is None:
        raise WorkerError("unknown_content_type", "The uploaded file type could not be detected from its content.", 415)
    if detected not in MIME_BY_SUFFIX[filename.suffix]:
        raise WorkerError(
            "content_type_mismatch",
            "The file extension does not match the detected media type.",
            415,
            {"extension": filename.suffix, "detected": detected},
        )
    if not declared or declared == "application/octet-stream":
        raise WorkerError(
            "invalid_mime_type",
            "The declared content type is missing or generic; refusing to trust it.",
            415,
            {"declared": declared or "missing"},
        )
    if declared not in MIME_BY_SUFFIX[filename.suffix]:
        raise WorkerError(
            "invalid_mime_type",
            "The declared content type is not valid for this file type.",
            415,
            {"declared": declared},
        )


def _validate_decodable(path: Path, settings: Settings, ffmpeg: FFmpegAdapter) -> float:
    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as wav_file:
                frames = wav_file.getnframes()
                rate = wav_file.getframerate()
                channels = wav_file.getnchannels()
                if frames <= 0 or rate <= 0 or channels <= 0:
                    raise WorkerError("invalid_audio", "The WAV file contains no usable audio frames.", 422)
                duration = frames / float(rate)
                _check_duration(duration, settings)
                return duration
        except WorkerError:
            raise
        except (EOFError, wave.Error, OSError) as exc:
            raise WorkerError("invalid_audio", "The uploaded WAV file is damaged or incomplete.", 422) from exc
    try:
        duration = ffmpeg.probe_duration(path)
    except WorkerError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise WorkerError("invalid_audio", "The uploaded audio could not be decoded.", 422) from exc
    if not (duration > 0):
        raise WorkerError("invalid_audio", "The uploaded audio contains no usable frames.", 422)
    _check_duration(duration, settings)
    return duration


def _check_duration(duration: float, settings: Settings) -> None:
    if duration > settings.max_duration_seconds:
        raise WorkerError(
            "duration_too_long",
            "The audio is longer than the allowed maximum.",
            413,
            {"max_seconds": settings.max_duration_seconds, "detected_seconds": round(duration, 2)},
        )


async def stage_upload(
    upload: UploadFile,
    settings: Settings,
    ffmpeg: FFmpegAdapter,
    *,
    authorised: bool,
) -> tuple[Path, float]:
    """Validate an authorised upload and write it to a per-job staging directory.

    Returns ``(staged_path, duration)``. The caller (job runner) owns cleanup of
    the staging directory, so the file survives for background processing.
    """
    if not authorised:
        raise WorkerError(
            "authorization_required",
            "Confirm that you own or are authorised to process this audio (authorised=true).",
            403,
        )
    filename = _validate_filename(upload.filename)
    content = await upload.read(settings.max_upload_bytes + 1)
    if not content:
        raise WorkerError("empty_file", "The uploaded audio file is empty.", 400)
    if len(content) > settings.max_upload_bytes:
        raise WorkerError(
            "file_too_large",
            "The uploaded audio exceeds the configured size limit.",
            413,
            {"max_bytes": settings.max_upload_bytes},
        )
    _validate_matches(filename, upload.content_type, sniff_content_type(content))

    stage_root = settings.temp_root / "uploads"
    stage_root.mkdir(parents=True, exist_ok=True)
    job_dir = stage_root / uuid.uuid4().hex
    job_dir.mkdir(parents=True, exist_ok=True)
    path = job_dir / f"input{uuid.uuid4().hex}{filename.suffix}"
    path.write_bytes(content)
    duration = _validate_decodable(path, settings, ffmpeg)
    return path, duration
