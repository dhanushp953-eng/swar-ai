from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.idempotency import CapturedResponse, InFlightRegistry
from app.core.rate_limit import RateLimiter

AI_PATHS = {"/api/ai/generate", "/api/tutor/advice", "/api/ai/providers/status"}

_SAFE_HEADERS = {"content-type", "content-encoding"}


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client is not None and request.client.host:
        return request.client.host
    return "unknown"


def _idempotency_key(request: Request, body: bytes) -> str:
    header_key = request.headers.get("idempotency-key")
    if header_key:
        return f"hdr:{header_key.strip()}"
    digest = hashlib.sha256(body).hexdigest()
    return f"{request.method}:{request.scope.get('path', '')}:{digest}"


class SafetyMiddleware(BaseHTTPMiddleware):
    """Per-client limits, duplicate-request collapsing, and a request timeout.

    Scoped to the AI endpoints. Each behavior is defense-in-depth on top of the
    existing prompt sanitization, provider fallback, and secret redaction.
    """

    def __init__(
        self,
        app: any,
        rate_limiter: RateLimiter,
        idempotency: InFlightRegistry,
        request_timeout_seconds: float,
    ) -> None:
        super().__init__(app)
        self._rate_limiter = rate_limiter
        self._idempotency = idempotency
        self._request_timeout = max(0.1, float(request_timeout_seconds))

    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        if request.scope.get("path", "") not in AI_PATHS:
            return await call_next(request)

        if not self._rate_limiter.is_allowed(_client_key(request)):
            return JSONResponse(
                status_code=429,
                content={"error": {"code": "rate_limited", "message": "Too many requests. Wait a moment and try again."}},
            )

        body = await request.body()
        key = _idempotency_key(request, body)

        async def run() -> CapturedResponse:
            try:
                response = await asyncio.wait_for(call_next(request), self._request_timeout)
            except asyncio.TimeoutError:
                return CapturedResponse(
                    status_code=503,
                    headers={"content-type": "application/json"},
                    body=json.dumps({"error": {"code": "ai_timeout", "message": "The request took too long. Try again."}}).encode("utf-8"),
                )
            chunks: list[bytes] = []
            async for chunk in response.body_iterator:
                chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode("utf-8"))
            headers = {name.lower(): value for name, value in response.headers.items() if name.lower() in _SAFE_HEADERS}
            return CapturedResponse(status_code=response.status_code, headers=headers, body=b"".join(chunks))

        captured = await self._idempotency.acquire(key, run)
        return Response(content=captured.body, status_code=captured.status_code, headers=captured.headers)
