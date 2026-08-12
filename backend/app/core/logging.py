from __future__ import annotations

import logging


class RedactingFilter(logging.Filter):
    """Redacts configured secrets from every log record.

    API keys live only in the backend environment and are already marked
    ``repr=False`` on the settings object, but a secret could still surface in
    an exception message or access log. This filter is a defense-in-depth guard
    that scrubs any configured secret substring from emitted records.
    """

    def __init__(self, secrets: list[str] | None = None) -> None:
        super().__init__()
        self._secrets = [secret for secret in (secrets or []) if secret]

    def add_secret(self, secret: str | None) -> None:
        if secret:
            self._secrets.append(secret)

    def filter(self, record: logging.LogRecord) -> bool:
        if not self._secrets:
            return True
        message = record.getMessage()
        redacted = message
        for secret in self._secrets:
            if secret and secret in redacted:
                redacted = redacted.replace(secret, "[redacted]")
        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True


def configure_logging(secrets: list[str] | None = None) -> RedactingFilter:
    """Attach a :class:`RedactingFilter` to the relevant loggers (idempotent)."""
    secrets = [secret for secret in (secrets or []) if secret]
    if not secrets:
        return RedactingFilter([])

    redactor = RedactingFilter(secrets)
    for logger_name in ("", "uvicorn", "uvicorn.access", "uvicorn.error", "app"):
        logger = logging.getLogger(logger_name)
        if not any(isinstance(existing, RedactingFilter) for existing in logger.filters):
            logger.addFilter(redactor)
    return redactor
