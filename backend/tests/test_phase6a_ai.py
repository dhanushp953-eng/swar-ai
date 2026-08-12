import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.ai import AIRequest, AIService, GeminiProvider, GroqProvider, MockProvider, ProviderError


class StubProvider:
    def __init__(self, name: str, outcome: str | Exception, availability: str = "configured") -> None:
        self.name = name
        self.outcome = outcome
        self.calls = 0
        self._availability = availability

    @property
    def availability(self) -> str:
        return self._availability

    async def generate(self, request: AIRequest, settings: Settings) -> str:
        del request, settings
        self.calls += 1
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def run(coroutine):
    return asyncio.run(coroutine)


def test_missing_keys_use_deterministic_mock_and_safe_status() -> None:
    app = create_app(Settings(gemini_api_key=None, groq_api_key=None))

    with TestClient(app) as client:
        status = client.get("/api/ai/providers/status")
        response = client.post("/api/ai/generate", json={"prompt": "Explain a major scale in one sentence."})

    assert status.status_code == 200
    assert status.json() == {"providers": {"gemini": "unavailable", "groq": "unavailable", "mock": "available"}}
    assert response.status_code == 200
    assert response.json() == {
        "text": "The AI provider foundation is running in deterministic local fallback mode.",
        "provider": "mock",
        "used_fallback": True,
        "fallback_reason": "not_configured",
    }
    assert "key" not in response.text.lower()


def test_request_contract_rejects_media_midi_and_extra_fields() -> None:
    app = create_app(Settings(gemini_api_key=None, groq_api_key=None))

    with TestClient(app) as client:
        media = client.post("/api/ai/generate", json={"prompt": "audio bytes", "audio": "file://recording.wav"})
        midi = client.post("/api/ai/generate", json={"prompt": "raw MIDI data: 144,60,100"})
        personal = client.post("/api/ai/generate", json={"prompt": "Please use learner@example.test in the answer."})

    assert media.status_code == 422
    assert midi.status_code == 422
    assert personal.status_code == 422
    assert "file://" not in media.text
    assert "learner@example.test" not in personal.text


@pytest.mark.parametrize(
    ("error", "reason"),
    [
        (ProviderError("timeout", retryable=True), "timeout"),
        (ProviderError("invalid_response"), "invalid_response"),
        (ProviderError("rate_limited", retryable=True), "rate_limited"),
        (ProviderError("provider_failure"), "provider_failure"),
    ],
)
def test_provider_failures_fall_back_without_internal_details(error, reason) -> None:
    settings = Settings(ai_provider_priority=("gemini", "mock"), ai_retry_limit=0)
    failing = StubProvider("gemini", error)
    service = AIService(settings, [failing, MockProvider()])
    app = create_app(settings, ai_service=service)

    with TestClient(app) as client:
        response = client.post("/api/ai/generate", json={"prompt": "Give a short practice tip."})

    assert response.status_code == 200
    assert response.json()["provider"] == "mock"
    assert response.json()["fallback_reason"] == reason
    assert "ProviderError" not in response.text


def test_timeout_retries_are_configurable_before_fallback() -> None:
    settings = Settings(ai_provider_priority=("gemini", "mock"), ai_retry_limit=2)
    failing = StubProvider("gemini", ProviderError("timeout", retryable=True))
    service = AIService(settings, [failing, MockProvider()])

    result = run(service.generate(AIRequest(prompt="Give a short practice tip.")))

    assert result.provider == "mock"
    assert result.fallback_reason == "timeout"
    assert failing.calls == 3


def test_provider_priority_uses_groq_before_mock() -> None:
    settings = Settings(ai_provider_priority=("gemini", "groq", "mock"), ai_retry_limit=0)
    gemini = StubProvider("gemini", ProviderError("provider_failure"))
    groq = StubProvider("groq", "A safe mocked provider response.")
    service = AIService(settings, [gemini, groq, MockProvider()])

    result = run(service.generate(AIRequest(prompt="Give a short practice tip.")))

    assert result.provider == "groq"
    assert result.used_fallback is True
    assert result.fallback_reason == "provider_failure"
    assert groq.calls == 1


def test_provider_status_never_contains_configuration_values() -> None:
    settings = Settings(gemini_api_key="configured-value", groq_api_key="configured-value")
    app = create_app(settings)

    with TestClient(app) as client:
        response = client.get("/api/ai/providers/status")

    assert response.status_code == 200
    assert response.json() == {"providers": {"gemini": "configured", "groq": "configured", "mock": "available"}}
    assert "configured-value" not in response.text


def test_provider_output_redacts_configured_keys() -> None:
    settings = Settings(
        gemini_api_key="configured-value",
        ai_provider_priority=("gemini", "mock"),
        ai_retry_limit=0,
    )
    provider = StubProvider("gemini", "The configured value is configured-value.")
    service = AIService(settings, [provider, MockProvider()])

    result = run(service.generate(AIRequest(prompt="Give a short practice tip.")))

    assert result.text == "The configured value is [redacted]."
    assert "configured-value" not in result.text


def test_disabled_mock_fallback_is_not_used_even_if_prioritized() -> None:
    settings = Settings(ai_provider_priority=("mock",), ai_mock_fallback_enabled=False)
    service = AIService(settings, [MockProvider()])

    with pytest.raises(ProviderError) as raised:
        run(service.generate(AIRequest(prompt="Give a short practice tip.")))

    assert raised.value.kind == "provider_failure"


def test_gemini_provider_uses_backend_key_and_bounded_text_only() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": "A mocked Gemini answer."}]}}]},
        )

    async def exercise() -> str:
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            provider = GeminiProvider("configured-value", "gemini-test", client)
            return await provider.generate(AIRequest("Explain a scale."), Settings(ai_max_response_chars=100))
        finally:
            await client.aclose()

    assert run(exercise()) == "A mocked Gemini answer."
    assert len(requests) == 1
    assert requests[0].url.host == "generativelanguage.googleapis.com"
    assert "configured-value" not in str(requests[0].url)
    assert requests[0].headers["x-goog-api-key"] == "configured-value"
    assert json.loads(requests[0].content)["contents"][0]["parts"][0]["text"] == "Explain a scale."


def test_groq_provider_rejects_oversized_response_without_network() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(200, json={"choices": [{"message": {"content": "x" * 20}}]})

    async def exercise() -> None:
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            provider = GroqProvider("configured-value", "groq-test", client)
            await provider.generate(AIRequest("Explain a scale."), Settings(ai_max_response_chars=10))
        finally:
            await client.aclose()

    with pytest.raises(ProviderError) as raised:
        run(exercise())
    assert raised.value.kind == "response_too_large"


def test_invalid_mock_response_is_structured_and_safe() -> None:
    invalid = StubProvider("mock", ProviderError("invalid_response"), "available")
    settings = Settings(ai_provider_priority=("mock",), ai_mock_fallback_enabled=True)
    service = AIService(settings, [invalid])

    with pytest.raises(ProviderError) as raised:
        run(service.generate(AIRequest(prompt="Give a short practice tip.")))

    assert raised.value.kind == "invalid_response"
