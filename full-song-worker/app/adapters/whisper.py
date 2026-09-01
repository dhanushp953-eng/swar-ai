from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from app.config import Settings
from app.errors import CapabilityError, WorkerError
from app.models import LyricLine, LyricWord

logger = logging.getLogger("fs1.adapters.whisper")

ProgressCallback = Callable[[float, str], None]


@dataclass
class Transcript:
    language: str
    language_confidence: float
    words: list[LyricWord]
    lines: list[LyricLine]
    warnings: list[str]


class WhisperAdapter:
    """Free local multilingual speech-to-text via faster-whisper (CTranslate2).

    Uses the CPU-friendly ``base`` model by default, produces word-level
    timestamps and auto language detection. Singing transcription is lossy
    and may contain errors or hallucinated words; we surface warnings and flag
    low-confidence lines rather than silently passing them through.

    The model is loaded lazily the first time transcription runs.
    """

    def __init__(self, settings: Settings, progress: ProgressCallback | None = None):
        self.settings = settings
        self.progress = progress
        self._model = None

    def available(self) -> bool:
        if not self.settings.whisper_enabled:
            return False
        try:
            import faster_whisper  # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return True

    def _report(self, fraction: float, message: str) -> None:
        if self.progress is not None:
            self.progress(fraction, message)

    def _load_model(self):
        if not self.available():
            raise CapabilityError(
                "whisper",
                "faster-whisper is unavailable in this environment. Timed lyric transcription is offline.",
            )
        from faster_whisper import WhisperModel

        self._report(0.0, "Loading Whisper model")
        self._model = WhisperModel(
            self.settings.whisper_model,
            device=self.settings.whisper_device,
            compute_type=self.settings.whisper_compute_type,
            download_root=str(self.settings.model_dir),
        )
        return self._model

    def transcribe(self, wav_path: Path, duration_seconds: float) -> Transcript:
        model = self._model or self._load_model()
        self._report(0.1, "Detecting language and transcribing")
        try:
            segments, info = model.transcribe(
                str(wav_path),
                language=self.settings.whisper_language,
                word_timestamps=True,
                vad_filter=True,
                beam_size=5,
                condition_on_previous_text=False,
            )
            language = info.language
            language_confidence = float(getattr(info, "language_probability", 0.0) or 0.0)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Whisper transcription failed")
            raise WorkerError("transcription_failed", f"Whisper transcription failed: {exc}", 500) from exc

        words: list[LyricWord] = []
        for segment in segments:
            for word in (segment.words or []):
                text = (word.word or "").strip()
                if not text:
                    continue
                conf = float(getattr(word, "probability", 0.0) or 0.0)
                words.append(
                    LyricWord(
                        text=text,
                        start=float(word.start),
                        end=float(word.end),
                        confidence=max(0.0, min(1.0, conf)),
                        uncertain=conf < self.settings.uncertain_word_confidence,
                    )
                )

        lines = _group_words_into_lines(
            words,
            max_chars=self.settings.line_max_chars,
            pause_seconds=self.settings.line_pause_seconds,
            uncertain_confidence=self.settings.uncertain_word_confidence,
        )
        warnings: list[str] = []
        if any(w.uncertain for w in words) or any(line.uncertain for line in lines):
            warnings.append(
                "Singing transcription may contain errors or hallucinated words; "
                "low-confidence segments are flagged for review."
            )
        if not words:
            warnings.append("No lyrics were detected in the supplied audio (instrumental or unvoiced).")
        return Transcript(
            language=language,
            language_confidence=language_confidence,
            words=words,
            lines=lines,
            warnings=warnings,
        )


def _group_words_into_lines(
    words: list[LyricWord],
    *,
    max_chars: int,
    pause_seconds: float,
    uncertain_confidence: float,
) -> list[LyricLine]:
    lines: list[LyricLine] = []
    current: list[LyricWord] = []
    current_len = 0

    def flush() -> None:
        nonlocal current, current_len
        if not current:
            return
        start = current[0].start
        end = current[-1].end
        conf = sum(w.confidence for w in current) / len(current)
        text = " ".join(w.text for w in current)
        lines.append(
            LyricLine(
                text=text,
                start=start,
                end=end,
                confidence=conf,
                uncertain=conf < uncertain_confidence,
                words=list(current),
            )
        )
        current = []
        current_len = 0

    for word in words:
        projected = (current_len + len(word.text) + 1) if current else len(word.text)
        gap = word.start - (current[-1].end if current else word.start)
        if (current and (projected > max_chars or gap > pause_seconds)) or (not current and len(word.text) > max_chars):
            flush()
        current.append(word)
        current_len = (current_len + len(word.text) + 1) if len(current) > 1 else len(word.text)

    flush()
    return lines
