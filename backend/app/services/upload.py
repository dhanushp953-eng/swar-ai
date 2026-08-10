import tempfile
import uuid
import wave
import shutil

import soundfile as sf
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import UploadFile

from app.core.config import Settings
from app.core.errors import AnalysisError

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".ogg"}
MIME_BY_EXTENSION = {
    ".wav": {"audio/wav", "audio/x-wav", "audio/wave"},
    ".mp3": {"audio/mpeg", "audio/mp3"},
    ".m4a": {"audio/mp4", "audio/x-m4a"},
    ".ogg": {"audio/ogg", "application/ogg"},
}


def sniff_content_type(content: bytes) -> str | None:
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WAVE":
        return "audio/wav"
    if content[:4] == b"OggS":
        return "audio/ogg"
    if content[:3] == b"ID3" or len(content) >= 2 and content[0] == 0xFF and content[1] & 0xE0 == 0xE0:
        return "audio/mpeg"
    if len(content) >= 12 and content[4:8] == b"ftyp":
        return "audio/mp4"
    return None


def _validate_filename(filename: str | None) -> Path:
    raw_name = filename or ""
    if not raw_name or raw_name != Path(raw_name).name or ".." in Path(raw_name).parts:
        raise AnalysisError("unsafe_filename", "The uploaded filename is not safe.", 400)
    suffix = Path(raw_name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise AnalysisError("unsupported_extension", "Only WAV, MP3, M4A, and OGG files are accepted.", 415)
    return Path(raw_name)


def _validate_types(filename: Path, declared: str | None, detected: str | None) -> None:
    if detected is None:
        raise AnalysisError("unknown_content_type", "The uploaded file type could not be detected.", 415)
    if detected not in MIME_BY_EXTENSION[filename.suffix]:
        raise AnalysisError("content_type_mismatch", "The file extension does not match its detected audio type.", 415, {"extension": filename.suffix, "detected": detected})
    if not declared or declared == "application/octet-stream" or declared not in MIME_BY_EXTENSION[filename.suffix]:
        raise AnalysisError("invalid_mime_type", "The declared content type is not valid for this extension.", 415, {"declared": declared or "missing"})


def _validate_decodable(path: Path, settings: Settings) -> None:
    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as wav_file:
                if wav_file.getnframes() <= 0 or wav_file.getframerate() <= 0 or wav_file.getnchannels() <= 0:
                    raise AnalysisError("invalid_audio", "The WAV file contains no usable audio frames.", 422)
        except AnalysisError:
            raise
        except (EOFError, wave.Error, OSError) as error:
            raise AnalysisError("invalid_audio", "The uploaded WAV file is damaged or incomplete.", 422) from error
        return
    try:
        info = sf.info(path)
        if info.frames <= 0 or info.samplerate <= 0:
            raise AnalysisError("invalid_audio", "The uploaded audio contains no usable frames.", 422)
        return
    except AnalysisError:
        raise
    except (RuntimeError, OSError, sf.SoundFileError):
        pass
    if shutil.which(settings.ffmpeg_binary) is None:
        raise AnalysisError("decoder_unavailable", "This file type is not decodable in the current environment because FFmpeg is unavailable.", 415, {"extension": path.suffix.lower(), "ffmpeg_required": True})


@asynccontextmanager
async def staged_upload(upload: UploadFile, settings: Settings) -> AsyncIterator[Path]:
    filename = _validate_filename(upload.filename)
    content = await upload.read(settings.max_upload_bytes + 1)
    if not content:
        raise AnalysisError("empty_file", "The uploaded audio file is empty.", 400)
    if len(content) > settings.max_upload_bytes:
        raise AnalysisError("file_too_large", "The uploaded audio file exceeds the configured size limit.", 413, {"max_bytes": settings.max_upload_bytes})
    _validate_types(filename, upload.content_type, sniff_content_type(content))
    settings.temp_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="swarai-upload-", dir=settings.temp_root) as directory:
        path = Path(directory) / f"upload-{uuid.uuid4().hex}{filename.suffix}"
        path.write_bytes(content)
        _validate_decodable(path, settings)
        yield path
