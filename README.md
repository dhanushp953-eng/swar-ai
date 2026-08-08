# SwarAI

SwarAI is a Next.js frontend foundation for an AI-powered visual instrument tutor. This phase includes a responsive landing page and a browser-based 61-key virtual piano. Audio is generated locally with Tone.js.

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

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

Audio upload, audio extraction, AI tutoring, authentication, and persistence are intentionally not implemented yet.
