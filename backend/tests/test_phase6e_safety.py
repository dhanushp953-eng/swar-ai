import asyncio
import json
import logging
import time

import httpx
import pytest
from fastapi import Request, Response
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.idempotency import CapturedResponse, InFlightRegistry
from app.core.logging import RedactingFilter, configure_logging
from app.core.rate_limit import RateLimiter
from app.main import create_app
from app.services.ai import AIRequest, AIService, MockProvider, ProviderError


def run(coroutine):
    return asyncio.run(coroutine)


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
        await asyncio.sleep(0)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class SlowProvider:
    def __init__(self, delay: float) -> None:
        self.name = "slow"
        self._delay = delay
        self.calls = 0

    @property
    def availability(self) -> str:
        return "configured"

    async def generate(self, request: AIRequest, settings: Settings) -> str:
        del request, settings
        self.calls += 1
        await asyncio.sleep(self._delay)
        return "finished slowly"


VALID_TUTOR_REQUEST = {
    "lesson_name": "Morning Steps",
    "expected_notes": [{"name": "C4", "start": 0, "duration": 0.5, "hand": "right"}],
    "scores": {"overall": 72, "pitch": 88, "timing": 61, "rhythm": 64},
    "mistake_counts": {"wrong_pitch": 1, "early": 2, "late": 3, "missed": 1, "extra": 0},
    "difficult_notes": ["E4"],
    "practice_mode": "full",
}


# --------------------------------------------------------------------------- #
# Unit tests for the guard primitives.                                        #
# --------------------------------------------------------------------------- #


def test_rate_limiter_allows_up_to_limit_then_denies() -> None:
    clock = [0.0]
    limiter = RateLimiter(limit_per_minute=3, clock=lambda: clock[0])
    assert limiter.is_allowed("a") is True
    assert limiter.is_allowed("a") is True
    assert limiter.is_allowed("a") is True
    assert limiter.is_allowed("a") is False
    assert limiter.is_allowed("b") is True
    clock[0] = 61.0
    assert limiter.is_allowed("a") is True


def test_inflight_registry_collapses_concurrent_requests() -> None:
    registry: InFlightRegistry | None = None

    async def factory() -> CapturedResponse:
        await asyncio.sleep(0.05)
        return CapturedResponse(status_code=200, headers={}, body=b"ok")

    async def exercise() -> tuple[CapturedResponse, CapturedResponse]:
        nonlocal registry
        registry = InFlightRegistry(cache_ttl_seconds=10.0)
        return await asyncio.gather(registry.acquire("k", factory), registry.acquire("k", factory))

    first, second = run(exercise())
    assert first.body == b"ok" and second.body == b"ok"


def test_inflight_registry_caches_recent_completed_results() -> None:
    registry = InFlightRegistry(cache_ttl_seconds=5.0)

    async def exercise() -> CapturedResponse:
        result = await registry.acquire("k", lambda: asyncio.sleep(0, CapturedResponse(200, {}, b"cached")))
        repeat = await registry.acquire("k", lambda: asyncio.sleep(0, CapturedResponse(200, {}, b"SHOULD-NOT-APPEAR")))
        return repeat

    assert run(exercise()).body == b"cached"


# --------------------------------------------------------------------------- #
# Integration tests through the FastAPI app.                                  #
# --------------------------------------------------------------------------- #


def test_rate_limit_returns_safe_429_on_ai_endpoints() -> None:
    settings = Settings(gemini_api_key=None, groq_api_key=None, ai_rate_limit_per_minute=3)
    app = create_app(settings)

    with TestClient(app) as client:
        first = client.post("/api/ai/generate", json={"prompt": "Short tip."})
        second = client.post("/api/ai/generate", json={"prompt": "Short tip."})
        third = client.post("/api/ai/generate", json={"prompt": "Short tip."})
        blocked = client.post("/api/ai/generate", json={"prompt": "Short tip."})

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 200
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "rate_limited"

    app.state.rate_limiter.reset()
    with TestClient(app) as client:
        tutor = client.post("/api/tutor/advice", json=VALID_TUTOR_REQUEST)
        status = client.get("/api/ai/providers/status")
    assert tutor.status_code == 200
    assert status.status_code == 200


def test_duplicate_idempotency_key_collapses_concurrent_tutor_requests() -> None:
    slow = SlowProvider(delay=0.1)
    settings = Settings(ai_provider_priority=("slow", "mock"), ai_retry_limit=0, ai_request_timeout_seconds=5.0)
    service = AIService(settings, [slow, MockProvider()])
    app = create_app(settings, ai_service=service)

    transport = httpx.ASGITransport(app=app)
    payload = json.dumps(VALID_TUTOR_REQUEST).encode("utf-8")

    async def exercise() -> tuple[dict, dict]:
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            headers = {"idempotency-key": "same-key", "content-type": "application/json"}
            r1, r2 = await asyncio.gather(
                client.post("/api/tutor/advice", content=payload, headers=headers),
                client.post("/api/tutor/advice", content=payload, headers=headers),
            )
            return r1.json(), r2.json()

    one, two = run(exercise())
    assert one["provider"] == two["provider"]
    assert slow.calls == 1


def test_request_timeout_guard_returns_safe_503() -> None:
    slow = SlowProvider(delay=1.0)
    settings = Settings(ai_provider_priority=("slow", "mock"), ai_retry_limit=0, ai_request_timeout_seconds=0.2)
    service = AIService(settings, [slow, MockProvider()])
    app = create_app(settings, ai_service=service)

    with TestClient(app) as client:
        response = client.post("/api/ai/generate", json={"prompt": "Slow tip."})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ai_timeout"


def test_provider_status_is_not_rate_limited_into_failure() -> None:
    settings = Settings(gemini_api_key=None, groq_api_key=None)
    app = create_app(settings)

    with TestClient(app) as client:
        responses = [client.get("/api/ai/providers/status") for _ in range(3)]

    assert all(response.status_code == 200 for response in responses)


# --------------------------------------------------------------------------- #
# Key protection.                                                             #
# --------------------------------------------------------------------------- #


def test_logging_filter_redacts_configured_secrets() -> None:
    secret = "super-secret-gemini-key"
    redactor = RedactingFilter([secret])
    record = logging.LogRecord("app", logging.ERROR, "app/main.py", 1, f"upstream failed with {secret}", None, None)
    assert redactor.filter(record) is True
    assert secret not in record.getMessage()
    assert "[redacted]" in record.getMessage()


def test_configure_logging_is_idempotent_and_redacts() -> None:
    secret = "another-secret-key"
    logger = logging.getLogger("app")
    # Reset any filter left by an earlier test so this case is self-contained.
    logger.filters = [f for f in logger.filters if not isinstance(f, RedactingFilter)]
    configure_logging([secret])
    configure_logging([secret])
    redactors = [f for f in logger.filters if isinstance(f, RedactingFilter)]
    assert len(redactors) == 1
    record = logging.LogRecord("app", logging.WARNING, "x", 1, f"leak {secret}", None, None)
    logger.handle(record)
    assert secret not in record.getMessage()
    assert "[redacted]" in record.getMessage()


def test_configured_keys_are_not_exposed_in_status_or_errors() -> None:
    settings = Settings(gemini_api_key="exposed-key-value", groq_api_key="exposed-groq-value")
    app = create_app(settings)

    with TestClient(app) as client:
        status = client.get("/api/ai/providers/status")
        # Force a provider failure path that returns a safe structured error.
        failing = StubProvider("gemini", ProviderError("provider_failure"))
        service = AIService(settings, [failing, MockProvider()])
        forced = create_app(settings, ai_service=service)
        with TestClient(forced) as broken:
            advice = broken.post("/api/tutor/advice", json=VALID_TUTOR_REQUEST)

    assert "exposed-key-value" not in status.text
    assert "exposed-groq-value" not in status.text
    assert "exposed-key-value" not in advice.text
    assert "exposed-groq-value" not in advice.text
