# SwarAI Phase FS1 — Full-Song Detection Worker

Local, self-hosted worker that turns a complete song (or any authorised audio)
into a timed full-song sheet: vocal separation, timed lyrics, chord events,
anchored chords per lyric line, BPM, and a key estimate.

- **FFmpeg** decodes and probes uploads (MP3/M4A/OGG/WAV).
- **Demucs (htdemucs)** separates vocals from accompaniment.
- **faster-whisper (base)** transcribes timed lyrics word-by-word.
- **librosa** detects chords and beats on the accompaniment.

Runs entirely on your machine / an image you control. No cloud, no accounts, no
API keys. Models are downloaded once and cached on disk.

> **Authorised audio only.** Uploads must be audio you own or are otherwise
> permitted to process. The worker requires `authorised=true` on every job and
> rejects audio whose declared type does not match its content.

## Requirements

- Python 3.11
- FFmpeg on `PATH` (or set `FS1_FFMPEG_BINARY` to the full executable path)
- ~8 GB free RAM recommended (Demucs + Whisper both load per worker process)

## Install

```bash
cd full-song-worker
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m pip install -r requirements-models.txt   # optional but enables Demucs + Whisper
```

## Configure

All configuration is via environment variables (see `app/config.py`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `FS1_MODEL_DIR` | `full-song-worker/.models` | Where Whisper weights download |
| `FS1_TEMP_ROOT` | `full-song-worker/.runtime` | Scratch space for decode/stems/uploads |
| `FS1_FFMPEG_BINARY` | `ffmpeg` | FFmpeg executable name or full path |
| `FS1_MAX_CONCURRENT_JOBS` | `1` | In-process job concurrency (keep `1` on limited RAM) |
| `FS1_MAX_DURATION_SECONDS` | `360` | Max audio duration accepted |
| `FS1_MAX_UPLOAD_BYTES` | `26214400` (25 MB) | Max upload size |
| `FS1_DEMUCS_MODEL` | `htdemucs` | Demucs model name |
| `FS1_WHISPER_MODEL` | `base` | faster-whisper model size |
| `FS1_WHISPER_DEVICE` / `FS1_WHISPER_COMPUTE_TYPE` | `cpu` / `int8` | Whisper device and compute type |
| `FS1_DEMUCS_ENABLED` / `FS1_WHISPER_ENABLED` | `true` | Toggle capabilities |
| `FS1_LOG_LEVEL` | `INFO` | Logging level |

`TORCH_HOME` redirects the PyTorch/Demucs hub cache (set it outside the repo,
e.g. `C:\swarai-tools\fs1-torch` on Windows, so weights are never committed).

## Run

```bash
.venv/Scripts/python -m uvicorn app.main:app --app-dir . --host 127.0.0.1 --port 8088
```

Endpoints:

- `GET /health` — liveness plus `ffmpeg_available`, `demucs_available`, `whisper_available`.
- `GET /capabilities` — per-capability `{name, available, reason, model}`.
- `POST /v1/full-song/jobs` — multipart form: `file`, `authorised=true`, optional `title`.
- `GET /v1/full-song/jobs/{id}` — job status/progress/result.
- `DELETE /v1/full-song/jobs/{id}` — cancel and clean up a job.

## Docker

```bash
docker build -f full-song-worker/Dockerfile -t swarai/fs1-worker:local .
docker run --rm -p 8088:8088 \
  -v fs1-models:/models -v fs1-runtime:/runtime \
  -e FS1_MAX_CONCURRENT_JOBS=1 swarai/fs1-worker:local
```

The image runs as the non-root `appuser` (UID 1000), binds `8088`, and has a
`HEALTHCHECK` against `GET /health`. No secrets are baked in.

## Testing

```bash
# Normal suite (mocks + FFmpeg core; no model downloads)
python -m pytest

# Real-model smoke tests (downloads weights; heavy)
python -m pytest tests/test_slow_models.py -m slow -v
```

## Security notes

- Uploads are validated by declared extension, declared MIME type, and content
  sniffing; generic `application/octet-stream` is refused.
- Audio bytes, raw lyrics and stems are never logged or committed.
- Model weights download to `FS1_MODEL_DIR` / `TORCH_HOME` and are git-ignored.
- The worker binds localhost by default; bind `0.0.0.0` only behind an
  authenticated reverse proxy and keep `authorised=true` enforcement on.