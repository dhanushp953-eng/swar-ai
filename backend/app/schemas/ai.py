from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


AIProviderName = Literal["gemini", "groq", "mock"]
AIProviderAvailability = Literal["configured", "available", "unavailable"]
AIFallbackReason = Literal["not_configured", "timeout", "invalid_response", "response_too_large", "rate_limited", "provider_failure"]


class AIGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Phase 6A intentionally accepts generic text only. No media, files, MIDI, or profile context belongs here.
    prompt: str = Field(min_length=1, max_length=100_000)


class AIGenerateResponse(BaseModel):
    text: str = Field(min_length=1)
    provider: AIProviderName
    used_fallback: bool
    fallback_reason: AIFallbackReason | None = None


class AIProviderStatusResponse(BaseModel):
    providers: dict[AIProviderName, AIProviderAvailability]
