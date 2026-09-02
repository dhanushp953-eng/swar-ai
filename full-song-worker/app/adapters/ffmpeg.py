from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from app.config import Settings
from app.errors import WorkerError


class FFmpegAdapter:
    """Decodes arbitrary audio into a 16-bit PCM WAV using FFmpeg.

    Replaceable in tests: set ``binary`` to a fake runner or subclass to override.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.binary = settings.ffmpeg_binary

    def available(self) -> bool:
        return shutil.which(self.binary) is not None

    def probe_duration(self, path: Path) -> float:
        if not self.available():
            raise WorkerError("decoder_unavailable", "FFmpeg is not available, cannot probe duration.", 503)
        args = [
            self.binary,
            "-v", "error",
            "-i", str(path),
            "-f", "null",
            "-",
        ]
        result = subprocess.run(args, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise WorkerError("decode_failed", "The audio could not be decoded for duration probing.", 422)
        return self._parse_duration(result.stderr)

    def _parse_duration(self, ffmpeg_stderr: str) -> float:
        for line in ffmpeg_stderr.splitlines():
            line = line.strip()
            if line.startswith("Duration:") and ":" in line:
                part = line.split("Duration:", 1)[1].split(",", 1)[0].strip()
                try:
                    h, m, s = part.split(":")
                    return float(h) * 3600 + float(m) * 60 + float(s)
                except ValueError:
                    continue
        raise WorkerError("decode_failed", "Could not determine the audio duration.", 422)

    def decode_to_wav(self, src: Path, dst: Path, sample_rate: int | None = None) -> None:
        if not self.available():
            raise WorkerError("decoder_unavailable", "FFmpeg is not available, cannot decode the uploaded audio.", 503)
        args = [
            self.binary,
            "-v", "error",
            "-y",
            "-i", str(src),
        ]
        if sample_rate is not None:
            args += ["-ar", str(sample_rate)]
        args += ["-ac", "1", "-c:a", "pcm_s16le", str(dst)]
        result = subprocess.run(args, capture_output=True, text=True, timeout=300)
        if result.returncode != 0 or not dst.exists() or dst.stat().st_size == 0:
            raise WorkerError("decode_failed", "The audio could not be decoded to PCM WAV.", 422)
