from dataclasses import dataclass, field

import librosa
import numpy as np

from app.services.audio import DecodedAudio

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


@dataclass(frozen=True)
class KeyResult:
    key: str
    scale: str
    confidence: float
    warnings: list[str] = field(default_factory=list)


def _correlation(chroma: np.ndarray, profile: np.ndarray) -> list[float]:
    normalized = (profile - profile.mean()) / (profile.std() or 1.0)
    return [float(np.corrcoef(chroma, np.roll(normalized, shift))[0, 1]) for shift in range(12)]


def estimate_key(audio: DecodedAudio) -> KeyResult:
    chroma = librosa.feature.chroma_stft(y=audio.samples, sr=audio.sample_rate)
    weights = librosa.feature.rms(y=audio.samples)[0]
    if chroma.size == 0 or float(np.max(weights, initial=0.0)) <= 1e-7:
        return KeyResult("unknown", "unknown", 0.0, ["No reliable harmonic content was detected; key is unknown."])
    weighted = np.average(chroma, axis=1, weights=np.maximum(weights[: chroma.shape[1]], 1e-8)) if chroma.shape[1] == weights.size else chroma.mean(axis=1)
    weighted = weighted / (np.linalg.norm(weighted) or 1.0)
    major = _correlation(weighted, MAJOR_PROFILE)
    minor = _correlation(weighted, MINOR_PROFILE)
    candidates = [(value, NOTE_NAMES[index], "major") for index, value in enumerate(major)] + [(value, NOTE_NAMES[index], "minor") for index, value in enumerate(minor)]
    candidates.sort(reverse=True)
    best, key, scale = candidates[0]
    second = candidates[1][0]
    margin = max(0.0, best - second)
    confidence = max(0.0, min(0.82, 0.35 * max(0.0, best) + 0.65 * min(1.0, margin * 2)))
    warnings = ["Key confidence is heuristic and may be ambiguous for a single note or dense mixed recording."]
    if confidence < 0.35:
        warnings.append("The estimated key is low-confidence; treat it as a suggestion rather than a definitive result.")
    return KeyResult(key, scale, round(confidence, 3), warnings)
