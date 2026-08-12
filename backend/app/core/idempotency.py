from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, TypeVar

T = TypeVar("T")


@dataclass(slots=True)
class CapturedResponse:
    status_code: int
    headers: dict[str, str]
    body: bytes


class InFlightRegistry:
    """Prevents duplicate concurrent requests and caches recent results.

    Two requests that share the same idempotency key are collapsed: the second
    awaits the in-flight result of the first instead of invoking the handler
    again. A recently completed result is served directly for a short window so
    that an accidental rapid re-submit returns the same safe answer.
    """

    def __init__(self, cache_ttl_seconds: float, clock: callable = time.monotonic) -> None:
        self._cache_ttl = max(0.0, float(cache_ttl_seconds))
        self._clock = clock
        self._inflight: dict[str, "asyncio.Task[CapturedResponse]"] = {}
        self._cache: dict[str, tuple[float, CapturedResponse]] = {}
        self._lock = asyncio.Lock()

    async def acquire(self, key: str, factory: Callable[[], Awaitable[CapturedResponse]]) -> CapturedResponse:
        async with self._lock:
            now = self._clock()
            cached = self._cache.get(key)
            if cached is not None and now - cached[0] < self._cache_ttl:
                return cached[1]
            existing = self._inflight.get(key)
            if existing is not None and not existing.done():
                return await existing

            task: asyncio.Task[CapturedResponse] = asyncio.ensure_future(factory())
            self._inflight[key] = task

        try:
            result = await task
        finally:
            async with self._lock:
                if self._inflight.get(key) is task:
                    self._inflight.pop(key, None)
                    self._cache[key] = (self._clock(), result)
        return result

    def reset(self) -> None:
        self._inflight.clear()
        self._cache.clear()
