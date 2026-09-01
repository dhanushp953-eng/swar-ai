from __future__ import annotations

import numpy as np


def synth_chord_audio(
    root_hz: float,
    dur_sec: float,
    sr: int = 22050,
    beat_sec: float = 0.5,
    quality: str = "major",
) -> np.ndarray:
    """Synthesise a genuine equal-tempered triadic chord as harmonic tones.

    Intervals are exact semitone steps (major: root/third/fifth, minor:
    root/minor-third/fifth), so the chroma genuinely reflects the requested
    chord quality. A short percussive click gives librosa's beat tracker clear
    onsets.
    """
    steps = {"major": (0, 4, 7), "minor": (0, 3, 7)}[quality]
    freqs = [root_hz * (2 ** (step / 12.0)) for step in steps]
    amp = (0.16, 0.11, 0.13)
    t = np.arange(int(dur_sec * sr)) / sr
    sample = np.zeros_like(t, dtype=np.float64)
    for tone_hz, tone_amp in zip(freqs, amp):
        for n in range(1, 4):
            sample += (0.12 * tone_amp / n) * np.sin(2 * np.pi * tone_hz * n * t)
    # Percussive click (2 ms noise burst) for beat-tracking onsets
    click_len = int(0.004 * sr)
    if click_len < len(sample):
        click = (0.5 - np.random.default_rng(0).random(click_len)).astype(np.float32)
        sample[:click_len] += 0.6 * click
    env = np.ones_like(t)
    attack = int(0.03 * sr)
    env[:attack] = np.linspace(0, 1, attack)
    env[-attack:] = np.linspace(1, 0, attack)
    return (sample * env).astype(np.float32)


def synth_cg_am_f_progression(sr: int = 22050, beats_per_chord: int = 4, beat_sec: float = 0.5) -> tuple[np.ndarray, list[str]]:
    """Synthesise a deterministic C-G-Am-F progression audio and expected chords.

    Frequencies (Hz) approximate standard tuning: C 261.6, G 196.0, A 220.0, F 174.6.
    Returns (audio mono float32, expected chord labels repeated per beat).
    """
    chord_hz = {"C": 261.63, "G": 196.00, "Am": 220.00, "F": 174.61}
    qualities = {"C": "major", "G": "major", "Am": "minor", "F": "major"}
    expected = ["C", "G", "Am", "F"]
    chunks = []
    labels = []
    for ch in expected:
        root_hz = chord_hz[ch]
        for _ in range(beats_per_chord):
            chunks.append(synth_chord_audio(root_hz, beat_sec, sr=sr, quality=qualities[ch]))
            labels.append(ch)
    audio = np.concatenate(chunks)
    return audio, labels


def synth_c_f_g_progression(
    sr: int = 22050,
    beats_per_chord: int = 8,
    beat_sec: float = 0.5,
) -> tuple[np.ndarray, list[tuple[str, tuple[float, float]]]]:
    """Synthesise a C-F-G-C-F-G chord progression with ground-truth timestamps.

    Synthesises beat-by-beat (like synth_cg_am_f_progression) so the percussive
    click at position 0 of each beat_sec chunk gives librosa's beat tracker a
    clear 120 BPM grid, enabling reliable beat-synchronised chord detection.

    Returns (audio mono float32, ground_truth_segments) where each segment is
    (label, (start_sec, end_sec)).
    """
    chord_hz = {"C": 261.63, "F": 174.61, "G": 196.00}
    progression = ["C", "F", "G", "C", "F", "G"]
    chunks: list[np.ndarray] = []
    segments: list[tuple[str, tuple[float, float]]] = []
    cursor = 0.0
    for ch in progression:
        dur = beats_per_chord * beat_sec
        for _ in range(beats_per_chord):
            chunks.append(synth_chord_audio(chord_hz[ch], beat_sec, sr=sr, quality="major"))
        segments.append((ch, (cursor, cursor + dur)))
        cursor += dur
    return np.concatenate(chunks), segments


def weighted_chord_accuracy(chord_events, expected_segments, duration: float, step: float = 0.05) -> float:
    """Fraction of time the detected chord events agree with the expected labels.

    ``chord_events`` are objects exposing ``.chord``, ``.start`` and ``.end``
    (e.g. ``ChordEvent``); ``expected_segments`` is a list of
    ``(label, (start, end))`` covering ``[0, duration)``. Unlabelled time is
    never credited, and no-chord ('N') detections never count as correct.
    """
    times = np.arange(0.0, duration, step)
    detected = np.full(len(times), None, dtype=object)
    for ev in chord_events:
        mask = (times >= ev.start) & (times < ev.end)
        detected[mask] = ev.chord
    expected = np.full(len(times), None, dtype=object)
    for label, (start, end) in expected_segments:
        expected[(times >= start) & (times < end)] = label
    if len(times) == 0:
        return 0.0
    labelled = expected != None  # noqa: E711 - object-array None comparison
    return float(np.mean((detected == expected) & labelled))


def synth_vocal_track(duration_sec: float, notes, sr: int = 22050) -> np.ndarray:
    """Synthesise a voice-like monophonic track from ``(freq_hz, start, dur)`` notes.

    Adds subtle vibrato, a harmonic timbre and a vocal-band (200-5200 Hz)
    spectral shaping so Demucs has a plausible singing source to separate from
    a full-mix accompaniment.
    """
    t = np.arange(int(duration_sec * sr)) / sr
    out = np.zeros_like(t, dtype=np.float64)
    for freq, start, dur in notes:
        i0 = int(start * sr)
        i1 = min(int((start + dur) * sr), len(t))
        if i1 <= i0:
            continue
        tt = t[i0:i1] - start
        instant = freq * (1.0 + 0.012 * np.sin(2 * np.pi * 5.5 * tt))
        phase = 2 * np.pi * np.cumsum(instant) / sr
        sig = np.zeros_like(phase)
        for h, amp in zip((1, 2, 3, 4, 5, 6), (1.0, 0.5, 0.35, 0.2, 0.09, 0.05)):
            sig += amp * np.sin(h * phase)
        env = np.ones_like(tt)
        attack = int(0.06 * sr)
        release = int(0.12 * sr)
        env[:attack] = np.linspace(0, 1, attack)
        env[-release:] = np.linspace(1, 0, release)
        out[i0:i1] += sig * env
    peak = np.max(np.abs(out)) + 1e-9
    out = out / peak
    # Vocal-band spectral shaping (200-5200 Hz) so the timbre reads as singing.
    try:
        from scipy.signal import butter, sosfiltfilt

        sos = butter(3, [200.0 / (0.5 * sr), 5200.0 / (0.5 * sr)], btype="bandpass", output="sos")
        out = sosfiltfilt(sos, out)
        out = out / (np.max(np.abs(out)) + 1e-9)
    except Exception:  # noqa: BLE001 - shaping is best-effort
        pass
    return out.astype(np.float32)


def cgamf_melody_notes(chord_hz: dict[str, float], beats_per_chord: int, beat_sec: float) -> list[tuple[float, float, float]]:
    """Vocal melody walking root / fifth / octave / fifth over each C-G-Am-F chord.

    Returns ``(freq_hz, start, dur)`` notes aligned to the chord segments.
    """
    notes = []
    start = 0.0
    note_dur = beat_sec
    for ch in ("C", "G", "Am", "F"):
        root = chord_hz[ch]
        shape = (1.0, 1.5, 2.0, 1.5)
        for k in range(beats_per_chord):
            notes.append((root * shape[k % len(shape)], start + (k % len(shape)) * note_dur, note_dur))
        start += beats_per_chord * beat_sec
    return notes


def write_wav(path, audio: np.ndarray, sr: int) -> None:
    import soundfile as sf

    sf.write(str(path), audio, samplerate=sr, subtype="PCM_16")
