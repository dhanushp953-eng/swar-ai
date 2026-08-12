from __future__ import annotations

import time


class RateLimiter:
    """Fixed-window per-client request limiter.

    State is process-local and intentionally simple: this protects a single
    backend process from runaway client loops and accidental double-submits.
    It is not a distributed limiter; behind multiple workers each process
    enforces its own ceiling.
    """

    def __init__(self, limit_per_minute: int, window_seconds: float = 60.0, clock: callable = time.monotonic) -> None:
        self._limit = max(1, int(limit_per_minute))
        self._window = max(1.0, float(window_seconds))
        self._clock = clock
        self._hits: dict[str, list[float]] = {}

    def is_allowed(self, client_key: str) -> bool:
        now = self._clock()
        cutoff = now - self._window
        timestamps = self._hits.setdefault(client_key, [])
        timestamps[:] = [stamp for stamp in timestamps if stamp > cutoff]
        if len(timestamps) >= self._limit:
            return False
        timestamps.append(now)
        return True

    def reset(self, client_key: str | None = None) -> None:
        if client_key is None:
            self._hits.clear()
        else:
            self._hits.pop(client_key, None)
