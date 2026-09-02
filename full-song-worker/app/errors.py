from __future__ import annotations


class WorkerError(Exception):
    """Base error for the Phase FS1 worker. Carries an HTTP status and machine code."""

    def __init__(self, code: str, message: str, status_code: int = 400, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


class CapabilityError(WorkerError):
    """Raised when a required capability (model or tool) is unavailable."""

    def __init__(self, capability: str, message: str, details: dict | None = None):
        super().__init__("capability_unavailable", message, 503, {"capability": capability, **(details or {})})
        self.capability = capability
