from __future__ import annotations

import ipaddress
from typing import Iterable
from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

_DEV_PORTS = {"3000", "3001"}

_PREFLIGHT_HEADERS = {"access-control-request-method"}


def _is_lan_dev_origin(origin: str) -> bool:
    """True for http(s) origins on a non-loopback host using a dev frontend port.

    This lets a phone on the LAN reach the API (e.g. Origin
    http://192.168.29.53:3001) without hard-coding the dev machine's IP.
    """
    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"}:
        return False
    host = parsed.hostname
    if not host:
        return False
    if host in {"localhost", "127.0.0.1", "::1"}:
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if address.is_loopback:
            return False
    effective_port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if str(effective_port) not in _DEV_PORTS:
        return False
    return True


class LanCorsMiddleware(BaseHTTPMiddleware):
    """CORS that allows an explicit origin list plus reflected LAN dev origins."""

    def __init__(
        self,
        app: object,
        allow_origins: Iterable[str],
        allow_methods: Iterable[str] = ("GET", "POST"),
        allow_headers: Iterable[str] = ("Content-Type",),
        reflect_lan: bool = True,
    ) -> None:
        super().__init__(app)
        self._allow_origins = {origin.strip() for origin in allow_origins if origin.strip()}
        self._allow_methods = list(allow_methods)
        self._allow_headers = list(allow_headers)
        self._reflect_lan = reflect_lan

    def _resolve_origin(self, origin: str | None) -> str | None:
        if not origin:
            return None
        if origin in self._allow_origins:
            return origin
        if self._reflect_lan and _is_lan_dev_origin(origin):
            return origin
        return None

    async def dispatch(self, request: Request, call_next) -> Response:
        origin = request.headers.get("origin")
        allowed = self._resolve_origin(origin)

        is_preflight = (
            request.method == "OPTIONS"
            and origin is not None
            and request.headers.get("access-control-request-method") is not None
        )
        if is_preflight:
            headers: dict[str, str] = {}
            if allowed is not None:
                headers["access-control-allow-origin"] = allowed
                headers["access-control-allow-methods"] = ", ".join(self._allow_methods)
                headers["access-control-max-age"] = "600"
                requested = request.headers.get("access-control-request-headers")
                headers["access-control-allow-headers"] = requested or ", ".join(self._allow_headers)
            return Response(content=b"", status_code=204, headers=headers)

        response = await call_next(request)
        if allowed is not None and "access-control-allow-origin" not in response.headers:
            response.headers["access-control-allow-origin"] = allowed
        return response
