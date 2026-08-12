# SwarAI

SwarAI is a Next.js frontend foundation for an AI-powered visual instrument tutor. This phase includes a responsive landing page and a browser-based 61-key virtual piano. Audio is generated locally with Tone.js.

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Local audio analysis

Run the FastAPI backend from the project root:

```bash
backend/.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --reload --port 8000
```

Run the Next.js frontend in a second terminal:

```bash
npm run dev
```

The frontend reads `NEXT_PUBLIC_AUDIO_API_URL` from `.env.example` and defaults to `http://localhost:8000` for local development. FastAPI allows the local frontend origins `http://localhost:3000` and `http://localhost:3001`; production deployments must set explicit `CORS_ORIGINS` values. Audio analysis is local and requires no API key.

## Phase 6A AI provider foundation

Phase 6A adds a backend-only, text-only AI provider foundation. Copy `backend/.env.example` to the backend environment and set `GEMINI_API_KEY` for the primary Gemini free tier. `GROQ_API_KEY` is optional and can be used as a free-tier fallback. Never put either key in the root `.env.example`, Next.js environment, browser code, browser requests, logs, tests, or Git.

The backend exposes provider status at `GET /api/ai/providers/status` and a bounded text foundation endpoint at `POST /api/ai/generate`. The endpoint accepts only a `prompt` string; it does not accept or forward audio, microphone recordings, raw MIDI, files, or personal data. Missing keys and provider failures safely use a deterministic local mock response. The response contains only the provider name and a safe fallback category, never credentials or provider internals.

Use only free-tier provider access. This foundation does not configure billing, paid models, or a paid service requirement. Model names, timeout, retry limit, provider priority, prompt/response limits, and mock fallback are configured through the `AI_*` variables in `backend/.env.example`. No tutor chat UI or Phase 6B behavior is included.

## Verification

```bash
npm run lint
npm run test
npm run build
npm run start
```

## Current scope

- Interactive 61-key piano from C2 to C7
- Mouse, touch, and mapped computer keyboard input
- Soft piano, warm pad, and soft bell synthesis options
- Volume and sustain controls
- Responsive horizontal piano scrolling on small screens
- Three original local demo exercises with typed note events
- Scheduled falling-note piano roll synchronized with the keyboard
- Play, pause, restart, seek, count-in, metronome, loop, speed, hand, note-name, and fingering controls
- Unit coverage for lesson timing and active-note state
- Responsible-use legal notice
- Local rhythm and BPM analysis with librosa
- Local monophonic melody transcription with librosa.pyin and a librosa.yin fallback
- Timed melody note events with MIDI numbers, scientific note names, velocity, confidence, and unassigned hand/finger fields
- Melody defaults optimized for isolated C2-C7 material, a 0.08-second minimum note duration, and a 0.06-second interruption merge window
- Python 3.13-compatible backend dependencies: librosa 0.11.0, numpy 2.2.6, and soundfile 0.13.1
- Authorised WAV, MP3, M4A, and OGG upload with local analysis status and result readout

Tutor chat UI, authentication, persistence, chords, source separation, dense mixed-recording transcription, and Phase 6B behavior are intentionally not implemented. Audio analysis remains local; Phase 6A provider calls are backend-only, text-only, optional, and safe without API keys or paid services.
