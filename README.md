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

Use only free-tier provider access. This foundation does not configure billing, paid models, or a paid service requirement. Model names, timeout, retry limit, provider priority, prompt/response limits, and mock fallback are configured through the `AI_*` variables in `backend/.env.example`. No tutor UI is included.

## Phase 6B grounded tutor backend

Phase 6B adds `POST /api/tutor/advice`. It accepts only structured, bounded lesson context: a lesson name, expected note names with timing metadata, sanitized scores, mistake counts, difficult note names, practice mode, and an optional question. It rejects extra fields and prompt-injection patterns. Raw MIDI events, recordings, uploaded files, blobs, personal data, lyrics, and provider credentials are not accepted or forwarded.

The backend builds a grounded JSON prompt from the allowlisted context. The tutor is instructed to use only those facts and to say when a score or count is unavailable. Responses are schema-validated and contain a short summary, strengths, improvement priorities, pitch/timing/rhythm feedback, and 2 to 4 practical exercises. Gemini remains primary, Groq remains optional fallback, and the deterministic mock remains the final fallback. No tutor UI, login, accounts, database, streaming, or Phase 6C functionality is included.

Example request:

```json
{
  "lesson_name": "Morning Steps",
  "expected_notes": [
    {"name": "C4", "start": 0, "duration": 0.5, "hand": "right"},
    {"name": "E4", "start": 0.5, "duration": 0.5, "hand": "right"}
  ],
  "scores": {"overall": 72, "pitch": 88, "timing": 61, "rhythm": 64},
  "mistake_counts": {"wrong_pitch": 1, "early": 2, "late": 3, "missed": 1, "extra": 0},
  "difficult_notes": ["E4"],
  "practice_mode": "full",
  "user_question": "How can I make the entrances steadier?"
}
```

Example response shape:

```json
{
  "advice": {
    "summary": "Keep building your work on Morning Steps. Your recorded overall score is 72/100.",
    "strengths": ["Pitch is a strong area at 88/100."],
    "improvement_priorities": ["Work on timing with slow, focused repetitions (61/100)."],
    "pitch_feedback": "Pitch score: 88/100. Keep the same careful approach.",
    "timing_feedback": "Timing score: 61/100. Slow the exercise down and repeat short sections.",
    "rhythm_feedback": "Rhythm score: 64/100. Slow the exercise down and repeat short sections.",
    "exercises": [
      {"title": "Slow note groups", "instructions": "Practice E4 in small groups at a comfortable slow speed."},
      {"title": "Steady pulse", "instructions": "Use a gentle, even count and repeat the full exercise three times."}
    ]
  },
  "provider": "mock",
  "used_fallback": true,
  "fallback_reason": "not_configured"
}
```

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

Authentication, persistence, chords, source separation, dense mixed-recording transcription, accounts, cloud history, streaming, and Phase 6D behavior are intentionally not implemented. Phase 6C adds only a temporary Studio tutor panel connected to the backend advice endpoint; it sends sanitized lesson/score context only and keeps conversation in React memory. Audio analysis remains local; Phase 6A and 6B provider calls are backend-only, structured/text-only, optional, and safe without API keys or paid services.
