from __future__ import annotations

import json
from typing import Any, Literal

import httpx

from app.core.config import Settings
from app.services.ai.service import AIRequest, ProviderError


class _HttpProvider:
    name: Literal["gemini", "groq"]
    endpoint: str

    def __init__(self, api_key: str | None, model: str, client: httpx.AsyncClient | None = None) -> None:
        self._api_key = api_key.strip() if api_key else None
        self.model = model
        self._client = client

    def __repr__(self) -> str:
        return f"{type(self).__name__}(model={self.model!r}, configured={bool(self._api_key)})"

    @property
    def availability(self) -> Literal["configured", "available", "unavailable"]:
        return "configured" if self._api_key else "unavailable"

    async def _post_json(self, headers: dict[str, str], body: dict[str, Any], settings: Settings) -> dict[str, Any]:
        if not self._api_key:
            raise ProviderError("provider_failure")
        try:
            if self._client is not None:
                return await self._send(self._client, headers, body, settings)
            async with httpx.AsyncClient(timeout=settings.ai_request_timeout_seconds) as client:
                return await self._send(client, headers, body, settings)
        except ProviderError:
            raise
        except httpx.TimeoutException as error:
            del error
            raise ProviderError("timeout", retryable=True) from None
        except httpx.RequestError as error:
            del error
            raise ProviderError("provider_failure", retryable=True) from None
        except Exception as error:
            del error
            raise ProviderError("provider_failure") from None

    async def _send(self, client: httpx.AsyncClient, headers: dict[str, str], body: dict[str, Any], settings: Settings) -> dict[str, Any]:
        try:
            async with client.stream(
                "POST",
                self.endpoint,
                headers=headers,
                json=body,
                timeout=settings.ai_request_timeout_seconds,
            ) as response:
                raw = await _read_response(response, settings.ai_max_response_bytes)
        except httpx.TimeoutException as error:
            del error
            raise ProviderError("timeout", retryable=True) from None
        except httpx.RequestError as error:
            del error
            raise ProviderError("provider_failure", retryable=True) from None

        if response.status_code == 429:
            raise ProviderError("rate_limited", retryable=True)
        if response.status_code in {408, 504}:
            raise ProviderError("timeout", retryable=True)
        if response.status_code >= 500:
            raise ProviderError("provider_failure", retryable=True)
        if response.status_code < 200 or response.status_code >= 300:
            raise ProviderError("provider_failure")
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ProviderError("invalid_response") from error
        if not isinstance(payload, dict):
            raise ProviderError("invalid_response")
        return payload


async def _read_response(response: httpx.Response, max_bytes: int) -> bytes:
    content_length = response.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > max_bytes:
                raise ProviderError("response_too_large")
        except ValueError:
            pass

    chunks: list[bytes] = []
    size = 0
    async for chunk in response.aiter_bytes():
        size += len(chunk)
        if size > max_bytes:
            raise ProviderError("response_too_large")
        chunks.append(chunk)
    return b"".join(chunks)


class GeminiProvider(_HttpProvider):
    name: Literal["gemini"] = "gemini"
    endpoint = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    async def generate(self, request: AIRequest, settings: Settings) -> str:
        payload = await self._post_json(
            {
                "x-goog-api-key": self._api_key or "",
                "content-type": "application/json",
            },
            {
                "contents": [{"parts": [{"text": request.prompt}]}],
                "generationConfig": {"maxOutputTokens": settings.ai_max_output_tokens},
            },
            settings,
        )
        candidates = payload.get("candidates")
        if not isinstance(candidates, list) or not candidates or not isinstance(candidates[0], dict):
            raise ProviderError("invalid_response")
        content = candidates[0].get("content")
        if not isinstance(content, dict) or not isinstance(content.get("parts"), list):
            raise ProviderError("invalid_response")
        text = "".join(part.get("text", "") for part in content["parts"] if isinstance(part, dict) and isinstance(part.get("text"), str)).strip()
        return _validated_text(text, settings)

    @property
    def endpoint(self) -> str:  # type: ignore[override]
        return f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"


class GroqProvider(_HttpProvider):
    name: Literal["groq"] = "groq"
    endpoint = "https://api.groq.com/openai/v1/chat/completions"

    async def generate(self, request: AIRequest, settings: Settings) -> str:
        payload = await self._post_json(
            {
                "authorization": f"Bearer {self._api_key or ''}",
                "content-type": "application/json",
            },
            {
                "model": self.model,
                "messages": [{"role": "user", "content": request.prompt}],
                "max_tokens": settings.ai_max_output_tokens,
            },
            settings,
        )
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise ProviderError("invalid_response")
        message = choices[0].get("message")
        if not isinstance(message, dict) or not isinstance(message.get("content"), str):
            raise ProviderError("invalid_response")
        return _validated_text(message["content"].strip(), settings)


class MockProvider:
    name: Literal["mock"] = "mock"

    @property
    def availability(self) -> Literal["configured", "available", "unavailable"]:
        return "available"

    async def generate(self, request: AIRequest, settings: Settings) -> str:
        del request
        return _validated_text(
            "The AI provider foundation is running in deterministic local fallback mode.",
            settings,
        )


def _validated_text(text: str, settings: Settings) -> str:
    if not text or len(text) > settings.ai_max_response_chars or len(text.encode("utf-8")) > settings.ai_max_response_bytes:
        raise ProviderError("response_too_large" if text else "invalid_response")
    return text
