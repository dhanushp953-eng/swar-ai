import re
from typing import Annotated, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator


PracticeMode = Literal["full", "melody", "rhythm"]
NOTE_NAME_PATTERN = r"^[A-Ga-g](?:#|b)?[0-8]$"


def _bounded_text(value: str, *, max_length: int, field_name: str) -> str:
    cleaned = " ".join(value.split())
    if not cleaned:
        raise ValueError(f"{field_name} must not be empty")
    if len(cleaned) > max_length:
        raise ValueError(f"{field_name} is too long")
    return cleaned


def _reject_unsafe_text(value: str, *, field_name: str) -> str:
    lowered = value.lower()
    blocked = (
        "ignore previous",
        "ignore all previous",
        "ignore the context",
        "disregard the context",
        "override the context",
        "override the rules",
        "follow new instructions",
        "system message",
        "system prompt",
        "developer message",
        "developer prompt",
        "assistant message",
        "reveal the prompt",
        "reveal your instructions",
        "follow these instructions instead",
        "instructions:",
        "act as",
        "you are now",
        "jailbreak",
        "<|",
        "|>",
        "```",
        "base64",
        "data:audio/",
        "data:application/octet-stream",
        "audio/mpeg",
        "audio/wav",
        "audio/ogg",
        "audio/mp4",
        "audio bytes",
        "raw midi",
        "midi data",
        "midi bytes",
        "note_on",
        "audio recording",
        "recording bytes",
        "microphone",
        "file://",
        "uploaded file",
        "attached file",
        "audio file",
        "blob",
        "personal data",
        "private information",
        "my name is",
        "my address is",
        "my phone is",
        "my email is",
        "date of birth",
        "social security",
        "credit card",
        "lyrics",
        "song words",
        "quote the song",
        "full text",
        "reproduce the song",
        "copyrighted text",
        "provider",
        "api key",
        "api_key",
        "secret",
    )
    if any(marker in lowered for marker in blocked) or _FILE_REFERENCE_PATTERN.search(value) or _ENCODED_BLOB_PATTERN.search(value) or _EMAIL_PATTERN.search(value) or _PHONE_PATTERN.search(value):
        raise ValueError(f"{field_name} contains unsupported instructions or data")
    return value


_EMAIL_PATTERN = re.compile(r"\b[^\s@]+@[^\s@]+\.[^\s@]+\b")
_PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+?\d[\s().-]?){7,}\d(?!\d)")
_ENCODED_BLOB_PATTERN = re.compile(r"\b[A-Za-z0-9+/]{200,}={0,2}\b")
_FILE_REFERENCE_PATTERN = re.compile(r"\.(?:wav|mp3|m4a|ogg|mid|midi|pdf|docx?|xlsx?)\b", re.IGNORECASE)


SafeNoteName = Annotated[str, Field(pattern=NOTE_NAME_PATTERN, max_length=4)]


class ExpectedNoteContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: SafeNoteName
    start: float = Field(ge=0, le=3600)
    duration: float = Field(gt=0, le=60)
    hand: Literal["left", "right"] | None = None


class SanitizedPracticeScores(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overall: float | None = Field(default=None, ge=0, le=100)
    pitch: float | None = Field(default=None, ge=0, le=100)
    timing: float | None = Field(default=None, ge=0, le=100)
    rhythm: float | None = Field(default=None, ge=0, le=100)
    duration: float | None = Field(default=None, ge=0, le=100)

    @model_validator(mode="after")
    def require_score(self) -> "SanitizedPracticeScores":
        if all(value is None for value in (self.overall, self.pitch, self.timing, self.rhythm, self.duration)):
            raise ValueError("at least one sanitized score is required")
        return self


class MistakeCounts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    wrong_pitch: int = Field(default=0, ge=0, le=10_000, validation_alias=AliasChoices("wrong_pitch", "wrong"))
    early: int = Field(default=0, ge=0, le=10_000)
    late: int = Field(default=0, ge=0, le=10_000)
    missed: int = Field(default=0, ge=0, le=10_000)
    extra: int = Field(default=0, ge=0, le=10_000)


class TutorAdviceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lesson_name: str = Field(min_length=1, max_length=120)
    expected_notes: list[ExpectedNoteContext] = Field(default_factory=list, max_length=128)
    scores: SanitizedPracticeScores = Field(validation_alias=AliasChoices("scores", "practice_scores"))
    mistake_counts: MistakeCounts
    difficult_notes: list[SafeNoteName] = Field(default_factory=list, max_length=24)
    practice_mode: Literal["full", "melody", "rhythm"]
    user_question: str | None = Field(default=None, max_length=600)

    @field_validator("lesson_name")
    @classmethod
    def validate_lesson_name(cls, value: str) -> str:
        return _reject_unsafe_text(_bounded_text(value, max_length=120, field_name="lesson_name"), field_name="lesson_name")

    @field_validator("user_question")
    @classmethod
    def validate_user_question(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _reject_unsafe_text(_bounded_text(value, max_length=600, field_name="user_question"), field_name="user_question")

    @model_validator(mode="after")
    def validate_note_context(self) -> "TutorAdviceRequest":
        if len(set(self.difficult_notes)) != len(self.difficult_notes):
            raise ValueError("difficult_notes must not contain duplicates")
        return self


class TutorExercise(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=80)
    instructions: str = Field(min_length=1, max_length=260)

    @field_validator("title", "instructions")
    @classmethod
    def validate_exercise_text(cls, value: str) -> str:
        return _reject_unsafe_text(_bounded_text(value, max_length=260, field_name="exercise"), field_name="exercise")


class TutorAdviceContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=500)
    strengths: list[str] = Field(min_length=1, max_length=3)
    improvement_priorities: list[str] = Field(min_length=1, max_length=3)
    pitch_feedback: str = Field(min_length=1, max_length=360)
    timing_feedback: str = Field(min_length=1, max_length=360)
    rhythm_feedback: str = Field(min_length=1, max_length=360)
    exercises: list[TutorExercise] = Field(min_length=2, max_length=4)

    @field_validator("summary", "pitch_feedback", "timing_feedback", "rhythm_feedback")
    @classmethod
    def validate_feedback_text(cls, value: str) -> str:
        return _reject_unsafe_text(_bounded_text(value, max_length=500, field_name="feedback"), field_name="feedback")

    @field_validator("strengths", "improvement_priorities")
    @classmethod
    def validate_advice_lists(cls, values: list[str]) -> list[str]:
        return [_reject_unsafe_text(_bounded_text(value, max_length=220, field_name="advice"), field_name="advice") for value in values]


class TutorAdviceResponse(BaseModel):
    advice: TutorAdviceContent
    provider: Literal["gemini", "groq", "mock"]
    used_fallback: bool
    fallback_reason: Literal["not_configured", "timeout", "invalid_response", "response_too_large", "rate_limited", "provider_failure"] | None = None
