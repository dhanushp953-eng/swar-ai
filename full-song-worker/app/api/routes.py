from __future__ import annotations

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse

from app.capabilities import demucs_capability, ffmpeg_capability, whisper_capability
from app.errors import WorkerError
from app.models import CapabilitiesResponse, FullSongJob, HealthResponse
from app.pipeline.upload import stage_upload


def register_routes(app) -> None:
    router = APIRouter()

    @router.get("/health", response_model=HealthResponse, tags=["system"])
    async def health(request: Request) -> HealthResponse:
        settings = request.app.state.settings
        return HealthResponse(
            status="ok",
            analysis_version=settings.analysis_version,
            ffmpeg_available=request.app.state.ffmpeg.available(),
            demucs_available=demucs_capability(settings).available,
            whisper_available=whisper_capability(settings).available,
        )

    @router.get("/capabilities", response_model=CapabilitiesResponse, tags=["system"])
    async def capabilities(request: Request) -> CapabilitiesResponse:
        settings = request.app.state.settings
        return CapabilitiesResponse(
            analysis_version=settings.analysis_version,
            capabilities=[ffmpeg_capability(settings), demucs_capability(settings), whisper_capability(settings)],
        )

    @router.post("/v1/full-song/jobs", response_model=FullSongJob, status_code=201, tags=["full-song"])
    async def create_job(
        request: Request,
        file: UploadFile = File(...),
        authorised: bool | None = Form(default=None),
        title: str | None = Form(default=None),
    ) -> FullSongJob:
        app = request.app
        settings = app.state.settings
        store = app.state.store
        runner = app.state.runner
        ffmpeg = app.state.ffmpeg

        staged_path, duration = await stage_upload(file, settings, ffmpeg, authorised=bool(authorised))
        record = store.create()
        store.update(record.job_id, status="queued", progress=0, staged_path=str(staged_path))
        runner.submit(record, staged_path, duration, title or (file.filename or "")[:200])
        return record.response()

    @router.get("/v1/full-song/jobs/{job_id}", response_model=FullSongJob, tags=["full-song"])
    async def get_job(job_id: str, request: Request) -> FullSongJob:
        record = request.app.state.store.get(job_id)
        if record is None:
            raise WorkerError("job_not_found", "No full-song job exists for that ID.", 404)
        return record.response()

    @router.delete("/v1/full-song/jobs/{job_id}", response_model=FullSongJob, tags=["full-song"])
    async def delete_job(job_id: str, request: Request) -> FullSongJob:
        app = request.app
        record = app.state.store.get(job_id)
        if record is None:
            raise WorkerError("job_not_found", "No full-song job exists for that ID.", 404)
        # Request cancellation so an in-flight job stops promptly.
        app.state.store.mark_cancel(job_id)
        # Force cleanup of any temp files for this job.
        app.state.runner._cleanup_job_files(job_id)
        app.state.store.delete(job_id)
        return JSONResponse(
            status_code=200,
            content={"job_id": job_id, "status": "cancelled", "progress": 0, "result": None, "error": None},
        )

    app.include_router(router)
