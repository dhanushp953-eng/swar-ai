from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, Protocol

from app.core.config import Settings


ProviderErrorKind = Literal[
    "invalid_request",
    "timeout",
    "invalid_response",
    "rate_limited",
    "provider_failure",
    "response_too_large",
]


@dataclass(frozen=True)
class AIRequest:
    prompt: str


@dataclass(frozen=True)
class AIResult:
    text: str
    provider: Literal["gemini", "groq", "mock"]
    used_fallback: bool
    fallback_reason: Literal["not_configured", "timeout", "invalid_response", "response_too_large", "rate_limited", "provider_failure"] | None = None


class ProviderError(Exception):
    def __init__(self, kind: ProviderErrorKind, *, retryable: bool = False) -> None:
        super().__init__(kind)
        self.kind = kind
        self.retryable = retryable


class AIProvider(Protocol):
    name: Literal["gemini", "groq", "mock"]

    @property
    def availability(self) -> Literal["configured", "available", "unavailable"]: ...

    async def generate(self, request: AIRequest, settings: Settings) -> str: ...


class AIService:
    def __init__(self, settings: Settings, providers: list[AIProvider]) -> None:
        self.settings = settings
        self.providers = {provider.name: provider for provider in providers}

    def provider_status(self) -> dict[str, str]:
        return {name: self.providers[name].availability for name in ("gemini", "groq", "mock") if name in self.providers}

    async def generate(self, request: AIRequest) -> AIResult:
        self._validate_request(request)
        ordered_names = self._ordered_provider_names()
        failure_reasons: list[ProviderErrorKind] = []
        attempted_external_provider = False
        preferred_external_provider = next((name for name in self.settings.ai_provider_priority if name in {"gemini", "groq"}), None)

        for name in ordered_names:
            provider = self.providers.get(name)
            if provider is None or provider.availability == "unavailable":
                continue
            if name != "mock":
                attempted_external_provider = True
            attempts = self.settings.ai_retry_limit + 1
            for attempt in range(attempts):
                try:
                    text = await provider.generate(request, self.settings)
                    text = self._safe_output(text)
                    used_fallback = provider.name == "mock" or provider.name != preferred_external_provider or bool(failure_reasons)
                    return AIResult(
                        text=text,
                        provider=provider.name,
                        used_fallback=used_fallback,
                        fallback_reason=(self._fallback_reason(failure_reasons) or "not_configured") if used_fallback else None,
                    )
                except ProviderError as error:
                    failure_reasons.append(error.kind)
                    if not error.retryable or attempt + 1 >= attempts:
                        break
                except Exception:
                    # Provider exceptions are intentionally converted to a public-safe category.
                    failure_reasons.append("provider_failure")
                    break

        if self.settings.ai_mock_fallback_enabled:
            mock = self.providers.get("mock")
            if mock is not None and mock.availability != "unavailable":
                try:
                    text = await mock.generate(request, self.settings)
                    text = self._safe_output(text)
                    return AIResult(
                        text=text,
                        provider="mock",
                        used_fallback=True,
                        fallback_reason=self._fallback_reason(failure_reasons) if attempted_external_provider or failure_reasons else "not_configured",
                    )
                except Exception:
                    failure_reasons.append("provider_failure")

        raise ProviderError(self._fallback_reason(failure_reasons) or "provider_failure")

    def _ordered_provider_names(self) -> list[str]:
        ordered = []
        for name in self.settings.ai_provider_priority:
            if name in self.providers and name not in ordered:
                if name != "mock" or self.settings.ai_mock_fallback_enabled:
                    ordered.append(name)
        if self.settings.ai_mock_fallback_enabled and "mock" in self.providers and "mock" not in ordered:
            ordered.append("mock")
        return ordered

    def _validate_request(self, request: AIRequest) -> None:
        prompt = request.prompt.strip()
        if not prompt:
            raise ProviderError("invalid_request")
        if len(prompt) > self.settings.ai_max_prompt_chars:
            raise ProviderError("invalid_request")
        if _contains_restricted_data(prompt) or self._contains_configured_secret(prompt):
            raise ProviderError("invalid_request")

    def _contains_configured_secret(self, value: str) -> bool:
        return any(secret and secret in value for secret in (self.settings.gemini_api_key, self.settings.groq_api_key))

    def _safe_output(self, text: str) -> str:
        for secret in (self.settings.gemini_api_key, self.settings.groq_api_key):
            if secret:
                text = text.replace(secret, "[redacted]")
        if not text.strip() or len(text) > self.settings.ai_max_response_chars or len(text.encode("utf-8")) > self.settings.ai_max_response_bytes:
            raise ProviderError("response_too_large" if text.strip() else "invalid_response")
        return text

    @staticmethod
    def _fallback_reason(reasons: list[ProviderErrorKind]) -> Literal["not_configured", "timeout", "invalid_response", "response_too_large", "rate_limited", "provider_failure"] | None:
        for reason in ("rate_limited", "timeout", "response_too_large", "invalid_response", "provider_failure"):
            if reason in reasons:
                return reason
        return None


_EMAIL_PATTERN = re.compile(r"\b[^\s@]+@[^\s@]+\.[^\s@]+\b")
_PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+?\d[\s().-]?){7,}\d(?!\d)")
_LONG_NUMBER_PATTERN = re.compile(r"(?<!\d)\d{13,19}(?!\d)")
_RESTRICTED_CONTENT_MARKERS = (
    "data:audio/",
    "data:application/octet-stream",
    "base64",
    "audio/mpeg",
    "audio/wav",
    "audio/ogg",
    "audio/mp4",
    "audio bytes",
    "binary data",
    "microphone recording",
    "recorded audio",
    "recording bytes",
    "raw midi data",
    "midi data",
    "midi bytes",
    "note_on",
    "file://",
    "personal data",
    "private information",
    "my name is",
    "my address is",
    "my phone is",
    "my email is",
    "date of birth",
    "social security",
    "credit card",
)
_ENCODED_BLOB_PATTERN = re.compile(r"\b[A-Za-z0-9+/]{200,}={0,2}\b")
_FILE_REFERENCE_PATTERN = re.compile(r"\.(?:wav|mp3|m4a|ogg|mid|midi|pdf|docx?|xlsx?)\b", re.IGNORECASE)


def _contains_restricted_data(prompt: str) -> bool:
    normalized = prompt.lower()
    return bool(
        _EMAIL_PATTERN.search(prompt)
        or _PHONE_PATTERN.search(prompt)
        or _LONG_NUMBER_PATTERN.search(prompt)
        or _ENCODED_BLOB_PATTERN.search(prompt)
        or _FILE_REFERENCE_PATTERN.search(prompt)
        or any(marker in normalized for marker in _RESTRICTED_CONTENT_MARKERS)
    )
