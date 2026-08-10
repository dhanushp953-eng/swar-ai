import shutil
from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from app.core.config import Settings
from app.core.errors import AnalysisError


@dataclass(frozen=True)
class DecodedAudio:
    samples: np.ndarray
    sample_rate: int
    duration: float


def ffmpeg_available(settings: Settings) -> bool:
    return shutil.which(settings.ffmpeg_binary) is not None


class AudioDecoder:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def decode(self, path: Path) -> DecodedAudio:
        try:
            samples, sample_rate = sf.read(path, dtype="float32", always_2d=True)
            mono = np.asarray(samples, dtype=np.float32).mean(axis=1)
        except (RuntimeError, OSError, sf.SoundFileError) as soundfile_error:
            if not ffmpeg_available(self.settings):
                raise AnalysisError("decoder_unavailable", "This audio codec needs FFmpeg, which is not available on the server.", 415, {"ffmpeg_required": True, "extension": path.suffix.lower()}) from soundfile_error
            try:
                mono, sample_rate = librosa.load(path, sr=self.settings.analysis_sample_rate, mono=True)
                mono = np.asarray(mono, dtype=np.float32)
            except Exception as decoder_error:  # decoder libraries expose several backend-specific exception types
                raise AnalysisError("invalid_audio", "The uploaded audio could not be decoded.", 422) from decoder_error

        if mono.size == 0 or not np.isfinite(mono).all():
            raise AnalysisError("invalid_audio", "The uploaded audio contains no usable finite samples.", 422)
        if int(sample_rate) != self.settings.analysis_sample_rate:
            mono = librosa.resample(mono, orig_sr=int(sample_rate), target_sr=self.settings.analysis_sample_rate)
            sample_rate = self.settings.analysis_sample_rate
        duration = float(mono.size / sample_rate)
        if duration <= 0:
            raise AnalysisError("invalid_audio", "The uploaded audio has no duration.", 422)
        if duration > self.settings.max_duration_seconds:
            raise AnalysisError("duration_limit", "The uploaded audio exceeds the configured duration limit.", 413, {"max_seconds": self.settings.max_duration_seconds, "duration": duration})
        return DecodedAudio(samples=mono, sample_rate=int(sample_rate), duration=duration)
