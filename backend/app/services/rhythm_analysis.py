from pathlib import Path

from app.core.config import Settings
from app.schemas.analysis import RhythmAnalysis
from app.services.audio import AudioDecoder
from app.services.rhythm import analyze_rhythm


class RhythmAnalysisService:
    engine_name = "librosa.beat.beat_track"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.decoder = AudioDecoder(settings)

    def analyze(self, path: Path) -> RhythmAnalysis:
        audio = self.decoder.decode(path)
        rhythm = analyze_rhythm(audio)
        return RhythmAnalysis(
            duration=round(audio.duration, 6),
            estimated_bpm=rhythm.bpm,
            beat_timestamps=rhythm.beat_timestamps,
            rhythm_confidence=rhythm.confidence,
            warnings=rhythm.warnings,
            analysis_engine=self.engine_name,
            analysis_version=self.settings.analysis_version,
        )
