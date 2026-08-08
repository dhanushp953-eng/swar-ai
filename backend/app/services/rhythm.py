from dataclasses import dataclass, field

import librosa
import numpy as np

from app.services.audio import DecodedAudio


@dataclass(frozen=True)
class RhythmResult:
    bpm: float | None
    beat_timestamps: list[float]
    confidence: float
    warnings: list[str] = field(default_factory=list)


def analyze_rhythm(audio: DecodedAudio) -> RhythmResult:
    onset = librosa.onset.onset_strength(y=audio.samples, sr=audio.sample_rate)
    if onset.size == 0 or float(np.max(onset)) <= 1e-7:
        return RhythmResult(None, [], 0.0, ["No reliable onset pattern was detected; BPM and beats are unknown."])
    tempo, beat_frames = librosa.beat.beat_track(y=audio.samples, sr=audio.sample_rate, onset_envelope=onset, trim=False)
    tempo_array = np.asarray(tempo).reshape(-1)
    bpm = float(tempo_array[0]) if tempo_array.size and np.isfinite(tempo_array[0]) else None
    beats = librosa.frames_to_time(beat_frames, sr=audio.sample_rate)
    beat_timestamps = [round(float(value), 6) for value in beats if 0 <= value <= audio.duration]
    warnings: list[str] = []
    if bpm is None or bpm < 20 or bpm > 300 or len(beat_timestamps) < 2:
        return RhythmResult(None, beat_timestamps, 0.0, ["The beat tracker did not find enough reliable beats to report a BPM."])
    intervals = np.diff(beat_timestamps)
    coefficient = float(np.std(intervals) / np.mean(intervals)) if intervals.size and np.mean(intervals) > 0 else 1.0
    confidence = max(0.1, min(0.85, (1.0 - coefficient) * min(1.0, len(beat_timestamps) / 8)))
    warnings.append("BPM confidence is heuristic because librosa's beat tracker does not provide calibrated confidence.")
    return RhythmResult(round(bpm, 3), beat_timestamps, round(confidence, 3), warnings)
