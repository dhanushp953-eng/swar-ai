from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.adapters.ffmpeg import FFmpegAdapter
from app.config import Settings
from app.errors import WorkerError
from app.jobs.runner import JobRunner
from app.jobs.store import JobStore

logger = logging.getLogger("fs1.app")
logging.basicConfig(level=os.getenv("FS1_LOG_LEVEL", "INFO"))


def _log_redacted(msg: str) -> None:
    # Never log audio bytes, raw lyrics or stems.
    logger.info(msg)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = app.state.settings
    sweeper = asyncio.create_task(_sweep_loop(app))
    _log_redacted("Full-song worker started")
    try:
        yield
    finally:
        sweeper.cancel()
        try:
            await sweeper
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        _log_redacted("Full-song worker shutting down")


async def _sweep_loop(app: FastAPI) -> None:
    settings: Settings = app.state.settings
    while True:
        try:
            app.state.runner.sweep()
        except Exception:  # noqa: BLE001
            logger.exception("Sweep failed")
        await asyncio.sleep(max(10.0, settings.cancelled_sweep_seconds))


def create_app(settings: Settings | None = None) -> FastAPI:
    active = settings or Settings.from_env()
    active.temp_root.mkdir(parents=True, exist_ok=True)
    for d in ("decode", "stems"):
        (active.temp_root / d).mkdir(parents=True, exist_ok=True)

    store = JobStore()
    ffmpeg = FFmpegAdapter(active)
    runner = JobRunner(active, store, ffmpeg)

    app = FastAPI(title=active.app_name, version=active.analysis_version, lifespan=lifespan)
    app.state.settings = active
    app.state.store = store
    app.state.runner = runner
    app.state.ffmpeg = ffmpeg

    @app.exception_handler(WorkerError)
    async def worker_error_handler(request: Request, error: WorkerError) -> JSONResponse:
        del request
        return JSONResponse(
            status_code=error.status_code,
            content={"error": {"code": error.code, "message": error.message, "details": error.details}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, error: RequestValidationError) -> JSONResponse:
        del request
        details = [
            {"location": list(item.get("loc", ())), "message": item.get("msg", "Invalid request."), "type": item.get("type", "validation_error")}
            for item in error.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "invalid_request", "message": "The request could not be validated.", "details": {"errors": details}}},
        )

    # Import routes after app creation to avoid circular imports
    from app.api.routes import register_routes

    register_routes(app)

    return app


app = create_app()
