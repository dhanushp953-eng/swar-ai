from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from app.config import Settings
from app.models import ChordEvent

# Root notes as pitch classes (0 = C). Chord templates:
# major = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]
# minor = [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]
_MAJOR = np.array([1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0])
_MINOR = np.array([1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0])

_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# A beat track with fewer than this many beats is not considered reliable.
_MIN_RELIABLE_BEATS = 4
# Beats outside this tempo range are treated as implausible (spurious tracking).
_PLAUSIBLE_TEMPO = (40.0, 200.0)


@dataclass
class ChordDetectResult:
    """Outcome of chord detection, including beat-derived metadata."""

    chords: list[ChordEvent]
    beat_times: list[float]
    bpm: float | None
    beat_source: str  # "percussive" | "onset_envelope" | "windowed_fallback"
    warning: str | None


def chord_symbol(root: int, quality: str) -> str:
    name = _NOTE_NAMES[root % 12]
    return name if quality == "major" else f"{name}m"


def chroma_from_audio(audio: np.ndarray, sr: int, settings: Settings) -> np.ndarray:
    """Return a 12 x T chromagram of the accompaniment using CQT + harmonic separation."""
    import librosa

    y_harmonic, _ = librosa.effects.hpss(audio)
    bins_per_octave = settings.cqt_bins_per_octave
    cqt = np.abs(
        librosa.cqt(
            y_harmonic,
            sr=sr,
            bins_per_octave=bins_per_octave,
            n_bins=bins_per_octave * 7,
        )
    )
    chroma = librosa.feature.chroma_cqt(C=cqt, sr=sr, bins_per_octave=bins_per_octave)
    return chroma


def detect_chords(
    audio: np.ndarray,
    sr: int,
    settings: Settings,
    bpm: float | None = None,
) -> ChordDetectResult:
    """Estimate beat-synchronised chord events from the accompaniment audio.

    Beat source ladder:
      1. Beat-track the percussive component.
      2. If unreliable, retry using the full-mix onset envelope.
      3. If still no reliable beats, analyse chords using fixed time windows
         (BPM is left as None and a warning is attached - a BPM is never
         fabricated).

    The ``bpm`` argument is an optional caller-provided hint and is never used
    to invent a BPM when no reliable beats are found.
    """
    import librosa

    _, y_percussive = librosa.effects.hpss(audio)
    tempo, beat_frames, beat_source = _track_beats(y_percussive, audio, sr)

    chroma = chroma_from_audio(audio, sr, settings)
    if beat_source == "none":
        beat_times, beat_sync = _windowed_analysis(audio, sr, chroma, settings)
        detected_bpm: float | None = None
        beat_source = "windowed_fallback"
        warning = "Reliable beats were not detected; chords were analysed using fixed time windows."
    else:
        fixed_frames = librosa.util.fix_frames(
            np.asarray(beat_frames), x_min=0, x_max=chroma.shape[1] - 1
        )
        beat_times = librosa.frames_to_time(fixed_frames, sr=sr).tolist()
        beat_sync = librosa.util.sync(chroma, fixed_frames, aggregate=np.mean)
        detected_bpm = float(tempo) if tempo is not None else None
        warning = None

    raw = [_template_match(col) for col in beat_sync.T]
    labels = [r[0] for r in raw]
    confs = [r[1] for r in raw]

    # Temporal smoothing of labels using a window majority vote
    smoothed = _smooth_labels(labels, settings.chord_smoothing_window)

    # Confidence threshold -> N, then merge repeated adjacent chords
    chords = _threshold_and_merge(smoothed, confs, beat_times, settings)
    return ChordDetectResult(
        chords=chords,
        beat_times=beat_times,
        bpm=detected_bpm,
        beat_source=beat_source,
        warning=warning,
    )


def _track_beats(
    percussive: np.ndarray,
    audio: np.ndarray,
    sr: int,
) -> tuple[float | None, np.ndarray, str]:
    """Return (tempo, beat_frames, source) following the documented ladder."""
    import librosa

    tempo, frames = librosa.beat.beat_track(y=percussive, sr=sr)
    tempo = float(np.atleast_1d(tempo)[0])
    if (
        len(frames) >= _MIN_RELIABLE_BEATS
        and np.isfinite(tempo)
        and _PLAUSIBLE_TEMPO[0] <= tempo <= _PLAUSIBLE_TEMPO[1]
    ):
        return tempo, frames, "percussive"

    # Retry using the full-mix onset envelope.
    envelope = librosa.onset.onset_strength(y=audio, sr=sr)
    frames = librosa.onset.onset_detect(onset_envelope=envelope, sr=sr)
    if len(frames) >= _MIN_RELIABLE_BEATS:
        # Onset-based timing gives no BPM estimate; leave it unknown.
        return None, frames, "onset_envelope"

    return None, np.array([]), "none"


def _windowed_analysis(
    audio: np.ndarray,
    sr: int,
    chroma: np.ndarray,
    settings: Settings,
) -> tuple[list[float], np.ndarray]:
    """Analyse chords using fixed time-window boundaries (no BPM)."""
    import librosa

    window_seconds = settings.chord_window_seconds
    dur = len(audio) / sr
    n_windows = max(1, int(math.ceil(dur / window_seconds)))
    frame_count = max(chroma.shape[1] - 1, 1)
    boundaries = np.linspace(0, frame_count, n_windows + 1).astype(int)
    boundaries = librosa.util.fix_frames(boundaries, x_min=0, x_max=chroma.shape[1] - 1)
    beat_times = librosa.frames_to_time(boundaries, sr=sr).tolist()
    beat_sync = librosa.util.sync(chroma, boundaries, aggregate=np.mean)
    return beat_times, beat_sync


def _template_match(chroma_col: np.ndarray) -> tuple[str, float]:
    norm = chroma_col / (np.linalg.norm(chroma_col) + 1e-9)
    best = (-1, -1.0)
    best_score = -1.0
    for root in range(12):
        for quality, template in (("major", _MAJOR), ("minor", _MINOR)):
            score = float(np.dot(norm, template) / (np.linalg.norm(template) + 1e-9))
            if score > best_score:
                best_score = score
                best = (root, quality)
    return chord_symbol(best[0], best[1]), max(0.0, min(1.0, best_score))



def _smooth_labels(labels: list[str], window: int) -> list[str]:
    if window <= 1:
        return list(labels)
    half = window // 2
    out: list[str] = []
    for i in range(len(labels)):
        lo = max(0, i - half)
        hi = min(len(labels), i + half + 1)
        windowed = labels[lo:hi]
        counts: dict[str, int] = {}
        for lab in windowed:
            counts[lab] = counts.get(lab, 0) + 1
        out.append(max(windowed, key=counts.get))
    return out


def _threshold_and_merge(
    labels: list[str],
    confs: list[float],
    beat_times: list[float],
    settings: Settings,
) -> list[ChordEvent]:
    beat_times = [float(t) for t in beat_times]
    events: list[ChordEvent] = []
    start = float(beat_times[0]) if beat_times else 0.0
    current = "N"
    current_conf = 0.0
    current_start = start
    current_beat_idx = 0

    def push(end: float, beat_idx: int) -> None:
        nonlocal current, current_conf, current_start, current_beat_idx
        if current_beat_idx >= len(beat_times) - 1 and end <= current_start:
            return
        events.append(
            ChordEvent(
                chord=current,
                start=current_start,
                end=end,
                confidence=current_conf,
                beat_index=current_beat_idx,
            )
        )
        current = "N"
        current_conf = 0.0
        current_start = end
        current_beat_idx = beat_idx

    for i, (label, conf) in enumerate(zip(labels, confs)):
        t = float(beat_times[i])
        beat_idx = i
        effective = label if conf >= settings.chord_confidence_threshold else "N"
        if effective != current:
            if len(events) > 0 or i > 0:
                push(t, beat_idx)
            current = effective
            current_conf = conf
            current_start = t
            current_beat_idx = beat_idx
        else:
            current_conf = max(current_conf, conf)

    end_time = float(beat_times[-1]) if beat_times else (current_start + settings.chord_min_duration_seconds)
    if end_time <= current_start:
        end_time = current_start + settings.chord_min_duration_seconds
    push(end_time, len(beat_times) - 1)

    # Reject short/unstable events and merge adjacent repeated chords
    return _reject_short(events, settings)


def _reject_short(events: list[ChordEvent], settings: Settings) -> list[ChordEvent]:
    kept: list[ChordEvent] = []
    for ev in events:
        dur = ev.end - ev.start
        if ev.chord == "N":
            kept.append(ev)
        elif dur >= settings.chord_min_duration_seconds:
            kept.append(ev)
        # else: drop the unstable short chord entirely
    # Merge repeated adjacent same-chord events
    merged: list[ChordEvent] = []
    for ev in kept:
        if merged and merged[-1].chord == ev.chord and abs(merged[-1].end - ev.start) < 1e-6:
            merged[-1].end = ev.end
            merged[-1].confidence = max(merged[-1].confidence, ev.confidence)
        else:
            merged.append(ChordEvent(**ev.model_dump()))
    return merged
