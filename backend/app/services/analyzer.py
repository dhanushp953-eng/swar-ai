from collections.abc import Callable
from pathlib import Path

from app.core.config import Settings
from app.schemas.analysis import AnalysisResult, KeyEstimate
from app.services.audio import AudioDecoder
from app.services.event_conversion import raw_notes_to_events
from app.services.key_estimation import estimate_key
from app.services.rhythm import analyze_rhythm
from app.services.transcription import BasicPitchTranscriptionService, LibrosaPitchTranscriptionService, TranscriptionService


class AnalysisService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.decoder = AudioDecoder(settings)
        self.basic_pitch = BasicPitchTranscriptionService()
        self.fallback = LibrosaPitchTranscriptionService()

    @property
    def basic_pitch_available(self) -> bool:
        return self.basic_pitch.available

    @property
    def basic_pitch_reason(self) -> str | None:
        return self.basic_pitch.reason

    @property
    def active_engine(self) -> str:
        if self.settings.transcription_engine in {"auto", "basic-pitch"} and self.settings.basic_pitch_enabled and self.basic_pitch.available:
            return self.basic_pitch.name
        return self.fallback.name

    def _select_transcriber(self, warnings: list[str]) -> TranscriptionService:
        wants_basic = self.settings.transcription_engine in {"auto", "basic-pitch"} and self.settings.basic_pitch_enabled
        if wants_basic and self.basic_pitch.available:
            return self.basic_pitch
        if wants_basic and self.basic_pitch.reason:
            warnings.append(self.basic_pitch.reason)
        return self.fallback

    def analyze(self, path: Path, job_id: str, progress: Callable[[int], None] | None = None) -> AnalysisResult:
        warnings: list[str] = []
        update = progress or (lambda value: None)
        audio = self.decoder.decode(path)
        update(25)
        rhythm = analyze_rhythm(audio)
        warnings.extend(rhythm.warnings)
        update(42)
        key = estimate_key(audio)
        warnings.extend(key.warnings)
        update(58)
        transcriber = self._select_transcriber(warnings)
        try:
            raw_notes = transcriber.transcribe(path, audio)
        except Exception as error:
            if transcriber is self.basic_pitch:
                warnings.append(f"Basic Pitch transcription failed: {type(error).__name__}: {error}")
                transcriber = self.fallback
                raw_notes = transcriber.transcribe(path, audio)
            else:
                raise
        events = raw_notes_to_events(raw_notes)
        if not events:
            warnings.append("No confident melody notes were detected.")
        warnings.append("Hand and finger assignments are left unassigned because they cannot be determined from audio alone.")
        warnings.append("Dense commercial recordings may require source separation for reliable melody and chord results.")
        warnings.append("Time signature and chord timeline are unknown because no high-confidence detector is enabled.")
        update(90)
        note_confidence = sum(event.confidence for event in events) / len(events) if events else 0.0
        overall = max(0.0, min(1.0, 0.4 * rhythm.confidence + 0.25 * key.confidence + 0.35 * note_confidence))
        mode = "polyphonic-basic-pitch" if transcriber is self.basic_pitch else "monophonic-librosa-yin"
        return AnalysisResult(job_id=job_id, status="completed", analysis_version=self.settings.analysis_version, duration=round(audio.duration, 6), estimated_bpm=rhythm.bpm, beat_timestamps=rhythm.beat_timestamps, estimated_key=KeyEstimate(key=key.key, scale=key.scale if key.scale in {"major", "minor"} else "unknown", confidence=key.confidence), time_signature="unknown", note_events=events, chord_timeline=[], warnings=warnings, engine_used=transcriber.name, analysis_mode=mode, overall_confidence=round(overall, 3))
