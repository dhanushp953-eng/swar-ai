from __future__ import annotations

import numpy as np


def synth_chord_audio(root_hz: float, dur_sec: float, sr: int = 22050, beat_sec: float = 0.5) -> np.ndarray:
    """Synthesise a triadic chord as a sum of harmonics at the root pitch.

    Adds a short percussive onset so librosa's beat tracker has clear onsets.
    """
    t = np.arange(int(dur_sec * sr)) / sr
    freq_mults = (1.0, 1.26, 1.5)  # root, thirdish, fifthish harmonic seeds
    sample = np.zeros_like(t, dtype=np.float32)
    for n in range(1, 4):
        sample += 0.12 * np.sin(2 * np.pi * root_hz * n * t) / n
    for m, amp in zip(freq_mults, (0.16, 0.11, 0.13)):
        sample += amp * np.sin(2 * np.pi * root_hz * m * t)
    # Percussive click (2 ms noise burst) for beat-tracking onsets
    click_len = int(0.004 * sr)
    if click_len < len(sample):
        sample[:click_len] += 0.6 * (0.5 - np.random.default_rng(0).random(click_len)).astype(np.float32)
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
    expected = ["C", "G", "Am", "F"]
    chunks = []
    labels = []
    for ch in expected:
        root_hz = chord_hz[ch]
        for _ in range(beats_per_chord):
            chunks.append(synth_chord_audio(root_hz, beat_sec, sr=sr))
            labels.append(ch)
    audio = np.concatenate(chunks)
    return audio, labels


def write_wav(path, audio: np.ndarray, sr: int) -> None:
    import soundfile as sf

    sf.write(str(path), audio, samplerate=sr, subtype="PCM_16")
