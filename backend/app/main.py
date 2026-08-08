import shutil

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import Settings
from app.core.errors import AnalysisError
from app.schemas.analysis import HealthResponse


def create_app(settings: Settings | None = None) -> FastAPI:
    active_settings = settings or Settings.from_env()
    app = FastAPI(
        title=active_settings.app_name,
        version=active_settings.analysis_version,
        description="Phase 3A scaffold. Audio analysis endpoints will be added in a later step.",
    )
    app.state.settings = active_settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=active_settings.allowed_cors_origins,
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(AnalysisError)
    async def analysis_error_handler(request: Request, error: AnalysisError) -> JSONResponse:
        del request
        return JSONResponse(status_code=error.status_code, content={"error": {"code": error.code, "message": error.message, "details": error.details}})

    @app.get("/health", response_model=HealthResponse, tags=["system"])
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            analysis_version=active_settings.analysis_version,
            ffmpeg_available=shutil.which(active_settings.ffmpeg_binary) is not None,
            active_transcription_engine="phase3a-scaffold",
            basic_pitch_available=False,
            basic_pitch_reason="Phase 3A intentionally does not install or activate analysis dependencies.",
        )

    return app


app = create_app()
