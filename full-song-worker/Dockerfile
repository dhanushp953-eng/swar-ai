# Phase FS1 full-song detection worker (production image).
#
# - Runs as a non-root user.
# - Healthcheck hits the FastAPI /health endpoint which reports FFmpeg, Demucs
#   and Whisper availability.
# - No secrets are baked in; all configuration is supplied via environment
#   variables at runtime (see README.md).
#
# Build:
#   docker build -f full-song-worker/Dockerfile -t swarai/fs1-worker:local .
#
# Run:
#   docker run --rm -p 8088:8088 -e FS1_MAX_CONCURRENT_JOBS=1 \
#     -v fs1-models:/models -v fs1-runtime:/runtime \
#     swarai/fs1-worker:local

FROM python:3.11-slim

# System dependencies: FFmpeg (decode + probe) and curl (healthcheck).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FS1_MODEL_DIR=/models \
    FS1_TEMP_ROOT=/runtime \
    FS1_MAX_CONCURRENT_JOBS=1

WORKDIR /srv/worker

# Install Python deps first for better layer caching.
COPY requirements.txt requirements-models.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir -r requirements-models.txt

# Application code.
COPY app ./app

# Non-root runtime user.
RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /models /runtime \
    && chown -R appuser:appuser /srv/worker /models /runtime
USER appuser

EXPOSE 8088

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8088/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8088", "--workers", "1"]
