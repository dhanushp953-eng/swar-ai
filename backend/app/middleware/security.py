from __future__ import annotations

from typing import Mapping

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Basic, broadly-compatible security headers for every API response.
# The Content-Security-Policy is intentionally strict for an API that only
# returns JSON (no executable sub-resources): block everything by default and
# deny framing.
_DEFAULT_HEADERS: dict[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds defensive HTTP response headers to every response.

    Applied as the outermost middleware so the headers are present even on
    CORS preflight responses and on error responses raised before reaching a
    route handler.
    """

    def __init__(self, app: object, headers: Mapping[str, str] | None = None) -> None:
        super().__init__(app)
        self._headers = dict(_DEFAULT_HEADERS)
        if headers:
            self._headers.update(headers)

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        for name, value in self._headers.items():
            if name not in response.headers:
                response.headers[name] = value
        return response
