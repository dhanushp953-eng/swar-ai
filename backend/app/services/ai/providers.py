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
        if request.prompt.startswith("SWARAI_TUTOR_CONTEXT_V1\n"):
            return _mock_tutor_response(request.prompt, settings)
        return _validated_text(
            "The AI provider foundation is running in deterministic local fallback mode.",
            settings,
        )


def _validated_text(text: str, settings: Settings) -> str:
    if not text or len(text) > settings.ai_max_response_chars or len(text.encode("utf-8")) > settings.ai_max_response_bytes:
        raise ProviderError("response_too_large" if text else "invalid_response")
    return text


def _mock_tutor_response(prompt: str, settings: Settings) -> str:
    try:
        context = json.loads(prompt.split("\nCONTEXT_JSON:\n", 1)[1])
    except (IndexError, TypeError, json.JSONDecodeError) as error:
        raise ProviderError("invalid_response") from error
    if not isinstance(context, dict):
        raise ProviderError("invalid_response")

    scores = context.get("scores") if isinstance(context.get("scores"), dict) else {}
    mistakes = context.get("mistake_counts") if isinstance(context.get("mistake_counts"), dict) else {}
    difficult_notes = context.get("difficult_notes") if isinstance(context.get("difficult_notes"), list) else []
    lesson_name = context.get("lesson_name", "this lesson")
    mode = context.get("practice_mode", "full")

    overall = _score(scores, "overall")
    overall_display = _display_score(overall)
    summary = (
        f"Keep building your work on {lesson_name}. Your recorded overall score is {overall_display}/100."
        if overall is not None
        else f"Keep building your work on {lesson_name}. An overall score was not supplied, so use the available details as your guide."
    )

    strengths: list[str] = []
    for key, label in (("pitch", "Pitch"), ("timing", "Timing"), ("rhythm", "Rhythm"), ("duration", "Note length")):
        value = _score(scores, key)
        if value is not None and value >= 80:
            strengths.append(f"{label} is a strong area at {value}/100.")
    if not strengths:
        strengths.append("You have a structured practice result to use as a clear starting point.")

    priorities: list[str] = []
    for key, label in (("pitch", "pitch"), ("timing", "timing"), ("rhythm", "rhythm"), ("duration", "note length")):
        value = _score(scores, key)
        if value is not None and value < 70:
            priorities.append(f"Work on {label} with slow, focused repetitions ({value}/100).")
    if _count(mistakes, "wrong_pitch") > 0:
        priorities.append(f"Check note choices: {_count(mistakes, 'wrong_pitch')} wrong-pitch mistake(s) were recorded.")
    if _count(mistakes, "early") + _count(mistakes, "late") > 0:
        priorities.append("Use a steady pulse to make note entrances more even.")
    if not priorities:
        priorities.append("Keep the same careful focus and make the next repetition consistent.")

    pitch_feedback = _feedback(scores, "pitch", "Pitch")
    timing_feedback = _feedback(scores, "timing", "Timing")
    rhythm_feedback = _feedback(scores, "rhythm", "Rhythm")
    exercises = [
        {
            "title": "Slow note groups",
            "instructions": f"Practice {', '.join(str(note) for note in difficult_notes[:4]) or 'the expected notes'} in groups of three at a comfortable slow speed. Pause between groups.",
        },
        {
            "title": "Steady pulse",
            "instructions": f"Use a gentle, even count and repeat the {mode} exercise three times without speeding up.",
        },
    ]
    if _count(mistakes, "wrong_pitch") > 0:
        exercises.append({
            "title": "Look, then play",
            "instructions": "Name each upcoming note quietly before playing it, then check that the next note is ready.",
        })
    if _count(mistakes, "early") + _count(mistakes, "late") > 0 and len(exercises) < 4:
        exercises.append({
            "title": "Tap before playing",
            "instructions": "Tap the pulse for one round, then play the same notes while keeping the tap steady.",
        })

    return _validated_text(json.dumps({
        "summary": summary,
        "strengths": strengths[:3],
        "improvement_priorities": priorities[:3],
        "pitch_feedback": pitch_feedback,
        "timing_feedback": timing_feedback,
        "rhythm_feedback": rhythm_feedback,
        "exercises": exercises[:4],
    }, ensure_ascii=True, separators=(",", ":")), settings)


def _score(scores: dict[str, Any], key: str) -> int | float | None:
    value = scores.get(key)
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _display_score(value: int | float | None) -> str:
    if value is None:
        return "unavailable"
    return str(int(value)) if float(value).is_integer() else str(value)


def _count(mistakes: dict[str, Any], key: str) -> int:
    value = mistakes.get(key, 0)
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _feedback(scores: dict[str, Any], key: str, label: str) -> str:
    value = _score(scores, key)
    if value is None:
        return f"{label} feedback is unavailable because no {key} score was supplied."
    if value >= 80:
        return f"{label} score: {value}/100. This is a strong area; keep the same careful approach."
    return f"{label} score: {value}/100. Slow the exercise down and repeat short sections before joining them together."
