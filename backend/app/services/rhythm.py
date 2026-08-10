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
    if audio.duration < 0.5:
        return RhythmResult(None, [], 0.0, ["Audio is too short for a reliable BPM estimate."])
    rms = librosa.feature.rms(y=audio.samples)[0]
    if rms.size == 0 or float(np.max(rms)) <= 1e-7:
        return RhythmResult(None, [], 0.0, ["Audio is silent or below the analysis level; BPM and beats are unknown."])
    onset = librosa.onset.onset_strength(y=audio.samples, sr=audio.sample_rate)
    onset_peak = float(np.max(onset, initial=0.0)) if onset.size else 0.0
    if onset.size == 0 or onset_peak <= 1e-7:
        return RhythmResult(None, [], 0.0, ["No reliable onset pattern was detected; BPM and beats are unknown."])
    tempo, beat_frames = librosa.beat.beat_track(y=audio.samples, sr=audio.sample_rate, onset_envelope=onset, trim=False)
    tempo_array = np.asarray(tempo).reshape(-1)
    bpm = float(tempo_array[0]) if tempo_array.size and np.isfinite(tempo_array[0]) else None
    beats = librosa.frames_to_time(beat_frames, sr=audio.sample_rate)
    beat_timestamps = sorted({round(float(value), 6) for value in beats if 0 <= value <= audio.duration})
    warnings: list[str] = []
    if bpm is None or bpm < 20 or bpm > 300 or len(beat_timestamps) < 2:
        return RhythmResult(None, beat_timestamps, 0.0, ["The beat tracker did not find enough reliable beats to report a BPM."])
    intervals = np.diff(beat_timestamps)
    coefficient = float(np.std(intervals) / np.mean(intervals)) if intervals.size and np.mean(intervals) > 0 else 1.0
    onset_times = librosa.onset.onset_detect(onset_envelope=onset, sr=audio.sample_rate, units="time")
    onset_intervals = np.diff(onset_times)
    onset_coefficient = float(np.std(onset_intervals) / np.mean(onset_intervals)) if onset_intervals.size and np.mean(onset_intervals) > 0 else 0.0
    positive_onsets = onset[onset > 0]
    onset_mean = float(np.mean(positive_onsets)) if positive_onsets.size else 0.0
    onset_contrast = max(0.0, min(1.0, (onset_peak / onset_mean - 1.0) / 4.0)) if onset_mean > 0 else 0.0
    consistency = max(0.0, min(1.0, 1.0 - coefficient))
    confidence = max(0.0, min(0.95, 0.7 * consistency + 0.3 * onset_contrast))
    if float(np.max(rms)) < 0.005:
        warnings.append("Audio is weak; the BPM estimate may be unreliable.")
    if max(coefficient, onset_coefficient) > 0.2:
        warnings.append("Detected beat intervals are irregular, so BPM confidence is reduced.")
    if confidence < 0.35:
        warnings.append("Rhythm confidence is low; the BPM and beat positions may be unreliable.")
    warnings.append("BPM confidence is heuristic because librosa's beat tracker does not provide calibrated confidence.")
    return RhythmResult(round(bpm, 3), beat_timestamps, round(confidence, 3), warnings)
