import shutil
import uuid

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import Settings
from app.core.errors import AnalysisError
from app.schemas.ai import AIGenerateRequest, AIGenerateResponse, AIProviderStatusResponse
from app.schemas.analysis import ErrorResponse, HealthResponse, JobResponse
from app.services.ai import AIRequest, AIService, GeminiProvider, GroqProvider, MockProvider, ProviderError
from app.services.jobs import JobStore
from app.services.melody_analysis import MelodyTranscriptionService
from app.services.rhythm_analysis import RhythmAnalysisService
from app.services.upload import staged_upload


def _ai_error(error: ProviderError) -> AnalysisError:
    if error.kind == "invalid_request":
        return AnalysisError("ai_invalid_request", "The AI request contains unsupported or unsafe input.", 422)
    if error.kind == "timeout":
        return AnalysisError("ai_timeout", "The AI providers did not respond in time.", 503)
    if error.kind == "invalid_response":
        return AnalysisError("ai_invalid_response", "The AI provider returned an invalid response.", 502)
    if error.kind == "rate_limited":
        return AnalysisError("ai_rate_limited", "The AI providers are temporarily rate limited.", 429)
    if error.kind == "response_too_large":
        return AnalysisError("ai_response_too_large", "The AI provider response exceeded the configured limit.", 502)
    return AnalysisError("ai_unavailable", "The AI service is temporarily unavailable.", 503)


def create_app(settings: Settings | None = None, ai_service: AIService | None = None) -> FastAPI:
    active_settings = settings or Settings.from_env()
    app = FastAPI(
        title=active_settings.app_name,
        version=active_settings.analysis_version,
        description="Phase 3D validates authorised local audio and estimates rhythm and monophonic melody locally with librosa.",
    )
    app.state.settings = active_settings
    app.state.jobs = JobStore()
    app.state.rhythm_analyzer = RhythmAnalysisService(active_settings)
    app.state.melody_analyzer = MelodyTranscriptionService(active_settings)
    app.state.ai_service = ai_service or AIService(
        active_settings,
        [
            GeminiProvider(active_settings.gemini_api_key, active_settings.gemini_model),
            GroqProvider(active_settings.groq_api_key, active_settings.groq_model),
            MockProvider(),
        ],
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=active_settings.allowed_cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(AnalysisError)
    async def analysis_error_handler(request: Request, error: AnalysisError) -> JSONResponse:
        del request
        return JSONResponse(status_code=error.status_code, content={"error": {"code": error.code, "message": error.message, "details": error.details}})

    @app.exception_handler(RequestValidationError)
    async def request_validation_error_handler(request: Request, error: RequestValidationError) -> JSONResponse:
        del request
        details = [{"location": list(item.get("loc", ())), "message": item.get("msg", "Invalid request."), "type": item.get("type", "validation_error")} for item in error.errors()]
        return JSONResponse(status_code=422, content={"error": {"code": "invalid_request", "message": "The request could not be validated.", "details": {"errors": details}}})

    @app.get("/health", response_model=HealthResponse, tags=["system"])
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            analysis_version=active_settings.analysis_version,
            ffmpeg_available=shutil.which(active_settings.ffmpeg_binary) is not None,
            active_transcription_engine="librosa.pyin",
            basic_pitch_available=False,
            basic_pitch_reason="Basic Pitch is intentionally not installed; Phase 3D uses librosa.pyin with a librosa.yin fallback.",
        )

    @app.get("/api/ai/providers/status", response_model=AIProviderStatusResponse, tags=["ai"])
    @app.get("/api/ai/status", response_model=AIProviderStatusResponse, include_in_schema=False)
    async def ai_provider_status() -> AIProviderStatusResponse:
        return AIProviderStatusResponse(providers=app.state.ai_service.provider_status())

    @app.post("/api/ai/generate", response_model=AIGenerateResponse, tags=["ai"])
    async def generate_ai(request: AIGenerateRequest) -> AIGenerateResponse:
        try:
            result = await app.state.ai_service.generate(AIRequest(prompt=request.prompt))
        except ProviderError as error:
            raise _ai_error(error) from error
        return AIGenerateResponse(
            text=result.text,
            provider=result.provider,
            used_fallback=result.used_fallback,
            fallback_reason=result.fallback_reason,
        )

    @app.post("/api/analyze", response_model=JobResponse, status_code=201, tags=["analysis"])
    async def analyze(file: UploadFile = File(..., description="WAV, MP3, M4A, or OGG audio you own or are authorised to analyze."), authorized: bool | None = Form(default=None, description="Confirm that you own or are authorised to analyze this audio.")) -> JobResponse:
        if authorized is not True:
            raise AnalysisError("authorization_required", "Confirm that you own or are authorised to analyze this audio.", 403)
        job_id = str(uuid.uuid4())
        jobs: JobStore = app.state.jobs
        record = None
        try:
            async with staged_upload(file, active_settings) as staged_path:
                record = jobs.create(job_id)
                jobs.update(job_id, status="validated", progress=25)
                jobs.update(job_id, status="processing", progress=40)
                rhythm = app.state.rhythm_analyzer.analyze(staged_path)
                melody = app.state.melody_analyzer.analyze(staged_path)
                jobs.update(job_id, status="completed", progress=100, rhythm=rhythm, melody=melody)
        except AnalysisError as error:
            if record is not None:
                jobs.update(job_id, status="failed", progress=100, error=ErrorResponse(code=error.code, message=error.message, details=error.details))
            raise
        except Exception as error:
            if record is not None:
                jobs.update(job_id, status="failed", progress=100, error=ErrorResponse(code="analysis_failed", message="The audio could not be analyzed.", details={}))
            raise AnalysisError("analysis_failed", "The audio could not be analyzed.", 422) from error
        return jobs.get(job_id).response()

    @app.get("/api/jobs/{job_id}", response_model=JobResponse, tags=["analysis"])
    async def get_job(job_id: str) -> JobResponse:
        record = app.state.jobs.get(job_id)
        if record is None:
            raise AnalysisError("job_not_found", "No analysis job exists for that ID.", 404)
        return record.response()

    return app


app = create_app()
