from typing import Literal

from pydantic import BaseModel, Field


AnalysisStatus = Literal["queued", "processing", "validated", "pending_analysis", "completed", "failed"]


class NoteEvent(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    midi: int = Field(ge=0, le=127)
    name: str = Field(min_length=1, max_length=8)
    start: float = Field(ge=0)
    duration: float = Field(gt=0)
    velocity: int = Field(ge=1, le=127)
    confidence: float = Field(ge=0, le=1)
    hand: Literal["left", "right"] | None = None
    finger: Literal[1, 2, 3, 4, 5] | None = None


class KeyEstimate(BaseModel):
    key: str = Field(min_length=1, max_length=8)
    scale: Literal["major", "minor", "unknown"]
    confidence: float = Field(ge=0, le=1)


class ChordEvent(BaseModel):
    start: float = Field(ge=0)
    duration: float = Field(gt=0)
    label: str = Field(min_length=1, max_length=32)
    confidence: float = Field(ge=0, le=1)


class AnalysisResult(BaseModel):
    job_id: str
    status: Literal["completed"]
    analysis_version: str
    duration: float = Field(ge=0)
    estimated_bpm: float | None = Field(default=None, gt=0)
    beat_timestamps: list[float] = Field(default_factory=list)
    estimated_key: KeyEstimate
    time_signature: str = "unknown"
    note_events: list[NoteEvent] = Field(default_factory=list)
    chord_timeline: list[ChordEvent] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    engine_used: str
    analysis_mode: Literal["polyphonic-basic-pitch", "monophonic-librosa-yin"]
    overall_confidence: float = Field(ge=0, le=1)


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: dict[str, object] = Field(default_factory=dict)


class RhythmAnalysis(BaseModel):
    duration: float = Field(ge=0)
    estimated_bpm: float | None = Field(default=None, gt=0)
    beat_timestamps: list[float] = Field(default_factory=list)
    rhythm_confidence: float = Field(ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)
    analysis_engine: str
    analysis_version: str


class MelodyNoteEvent(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    midi_note: int = Field(ge=0, le=127)
    note_name: str = Field(min_length=1, max_length=8)
    start_time: float = Field(ge=0)
    duration: float = Field(gt=0)
    velocity: int = Field(ge=1, le=127)
    confidence: float = Field(ge=0, le=1)
    hand: Literal["left", "right"] | None = None
    finger: Literal[1, 2, 3, 4, 5] | None = None


class MelodyAnalysis(BaseModel):
    note_events: list[MelodyNoteEvent] = Field(default_factory=list)
    melody_confidence: float = Field(ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)
    melody_engine: str
    melody_analysis_version: str


class JobResponse(BaseModel):
    job_id: str
    status: AnalysisStatus
    progress: int = Field(ge=0, le=100)
    result: AnalysisResult | None = None
    error: ErrorResponse | None = None
    duration: float | None = Field(default=None, ge=0)
    estimated_bpm: float | None = Field(default=None, gt=0)
    beat_timestamps: list[float] = Field(default_factory=list)
    rhythm_confidence: float | None = Field(default=None, ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)
    analysis_engine: str | None = None
    analysis_version: str | None = None
    note_events: list[MelodyNoteEvent] = Field(default_factory=list)
    melody_confidence: float | None = Field(default=None, ge=0, le=1)
    melody_engine: str | None = None
    melody_analysis_version: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    analysis_version: str
    ffmpeg_available: bool
    active_transcription_engine: str
    basic_pitch_available: bool
    basic_pitch_reason: str | None = None
