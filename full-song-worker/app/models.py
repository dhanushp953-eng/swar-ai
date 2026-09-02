from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

AnalysisStatus = Literal[
    "queued",
    "validating",
    "separating",
    "transcribing",
    "detecting_chords",
    "aligning",
    "complete",
    "failed",
    "cancelled",
]


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: dict = Field(default_factory=dict)


class CapabilityInfo(BaseModel):
    name: str
    available: bool
    model: str | None = None
    reason: str | None = None


class ModelInfo(BaseModel):
    demucs: CapabilityInfo
    whisper: CapabilityInfo
    ffmpeg: CapabilityInfo


class LyricWord(BaseModel):
    text: str = Field(min_length=1)
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    confidence: float = Field(ge=0, le=1)
    uncertain: bool = False


class LyricLine(BaseModel):
    text: str
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    confidence: float = Field(ge=0, le=1)
    uncertain: bool = False
    words: list[LyricWord] = Field(default_factory=list)


class ChordEvent(BaseModel):
    chord: str = Field(min_length=1)  # e.g. "C", "Am", or "N"
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    confidence: float = Field(ge=0, le=1)
    beat_index: int = Field(ge=0)


class ChordAnchor(BaseModel):
    """A chord anchored to a lyric word. Compatible with the Song Chords reader."""
    chord: str
    time: float = Field(ge=0)
    confidence: float = Field(ge=0, le=1)


class SongLyricSegment(BaseModel):
    """Mirrors src/types/song-sheet.ts SongLyricSegment."""
    chord: str | None = None
    text: str = ""


class SongLine(BaseModel):
    """Mirrors src/types/song-sheet.ts SongLine."""
    id: str | None = None
    segments: list[SongLyricSegment] = Field(default_factory=list)


class SongSection(BaseModel):
    """Mirrors src/types/song-sheet.ts SongSection."""
    id: str
    title: str
    type: Literal["intro", "verse", "chorus", "bridge", "outro"] = "verse"
    lines: list[SongLine] = Field(default_factory=list)


class SongSheetCompat(BaseModel):
    """A SongSheet-compatible object consumable by the existing SongSheetReader."""
    id: str
    metadata: dict
    chordsUsed: list[str]
    sections: list[SongSection]


class FullSongResult(BaseModel):
    analysis_version: str
    duration: float = Field(ge=0)

    language: str = "unknown"
    language_confidence: float = Field(default=0.0, ge=0, le=1)

    bpm: float | None = Field(default=None, gt=0)

    # How chords were timed: "percussive" | "onset_envelope" | "windowed_fallback"
    beat_source: str | None = Field(default=None)

    lyric_words: list[LyricWord] = Field(default_factory=list)
    lyric_lines: list[LyricLine] = Field(default_factory=list)

    chord_events: list[ChordEvent] = Field(default_factory=list)

    # Chord anchors aligned to lyric words
    chord_anchors: list[ChordAnchor] = Field(default_factory=list)

    # SongSheet-compatible object
    song_sheet: SongSheetCompat

    warnings: list[str] = Field(default_factory=list)

    model_info: ModelInfo
    processing_time_seconds: float = Field(default=0.0, ge=0)


class FullSongJob(BaseModel):
    job_id: str
    status: AnalysisStatus = "queued"
    progress: int = Field(default=0, ge=0, le=100)
    result: FullSongResult | None = None
    error: ErrorResponse | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    analysis_version: str
    ffmpeg_available: bool
    demucs_available: bool
    whisper_available: bool


class CapabilitiesResponse(BaseModel):
    analysis_version: str
    capabilities: list[CapabilityInfo]
