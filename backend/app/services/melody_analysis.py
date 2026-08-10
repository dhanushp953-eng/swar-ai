from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np

from app.core.config import Settings
from app.schemas.analysis import MelodyAnalysis, MelodyNoteEvent
from app.services.audio import AudioDecoder, DecodedAudio
from app.services.event_conversion import midi_to_name


@dataclass(frozen=True)
class PitchFrame:
    index: int
    timestamp: float
    midi: float
    voiced_probability: float
    strength: float


@dataclass(frozen=True)
class PitchSegment:
    midi: int
    start: float
    end: float
    frames: tuple[PitchFrame, ...]


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _as_frame_array(values: object, size: int, fill: float) -> np.ndarray:
    array = np.asarray(values if values is not None else [], dtype=float).reshape(-1)
    if array.size < size:
        array = np.pad(array, (0, size - array.size), constant_values=fill)
    return array[:size]


def _aligned_rms(audio: DecodedAudio, settings: Settings, frame_count: int) -> np.ndarray:
    rms = librosa.feature.rms(y=audio.samples, frame_length=settings.melody_frame_length, hop_length=settings.melody_hop_length)[0]
    if rms.size == 0:
        return np.zeros(frame_count, dtype=float)
    if rms.size < frame_count:
        rms = np.pad(rms, (0, frame_count - rms.size), mode="edge")
    return np.asarray(rms[:frame_count], dtype=float)


def _detect_with_pyin(audio: DecodedAudio, settings: Settings) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    detection_min = max(20.0, settings.melody_min_frequency / 2)
    detection_max = min(audio.sample_rate / 2 - 1, settings.melody_max_frequency * 2)
    return librosa.pyin(
        audio.samples,
        fmin=detection_min,
        fmax=detection_max,
        sr=audio.sample_rate,
        frame_length=settings.melody_frame_length,
        hop_length=settings.melody_hop_length,
        fill_na=np.nan,
    )


def _detect_with_yin(audio: DecodedAudio, settings: Settings) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    detection_min = max(20.0, settings.melody_min_frequency / 2)
    detection_max = min(audio.sample_rate / 2 - 1, settings.melody_max_frequency * 2)
    f0 = librosa.yin(
        audio.samples,
        fmin=detection_min,
        fmax=detection_max,
        sr=audio.sample_rate,
        frame_length=settings.melody_frame_length,
        hop_length=settings.melody_hop_length,
    )
    voiced = np.isfinite(f0)
    probability = np.where(voiced, 1.0, 0.0)
    return f0, voiced, probability


def _make_segments(frames: list[PitchFrame], audio_duration: float, settings: Settings) -> list[PitchSegment]:
    if not frames:
        return []
    frame_step = settings.melody_hop_length / settings.analysis_sample_rate
    segments: list[PitchSegment] = []
    current: list[PitchFrame] = [frames[0]]

    def append_current(items: list[PitchFrame]) -> None:
        start = max(0.0, items[0].timestamp)
        end = min(audio_duration, items[-1].timestamp + frame_step)
        if end > start:
            midi = int(round(float(np.median([item.midi for item in items]))))
            segments.append(PitchSegment(midi=midi, start=start, end=end, frames=tuple(items)))

    for frame in frames[1:]:
        previous = current[-1]
        same_pitch = int(round(frame.midi)) == int(round(previous.midi))
        contiguous = frame.index == previous.index + 1
        if same_pitch and contiguous:
            current.append(frame)
            continue
        append_current(current)
        current = [frame]
    append_current(current)
    return segments


def _combine_segments(first: PitchSegment, second: PitchSegment, midi: int | None = None) -> PitchSegment:
    return PitchSegment(
        midi=first.midi if midi is None else midi,
        start=first.start,
        end=second.end,
        frames=first.frames + second.frames,
    )


def _merge_segments(segments: list[PitchSegment], settings: Settings) -> list[PitchSegment]:
    if not segments:
        return []
    merged: list[PitchSegment] = []
    for segment in segments:
        if merged and segment.midi == merged[-1].midi and segment.start - merged[-1].end <= settings.melody_merge_gap_seconds:
            merged[-1] = _combine_segments(merged[-1], segment)
        else:
            merged.append(segment)

    changed = True
    while changed:
        changed = False
        for index in range(1, len(merged) - 1):
            previous, current, following = merged[index - 1 : index + 2]
            if current.end - current.start <= settings.melody_merge_gap_seconds and previous.midi == following.midi:
                merged[index - 1 : index + 2] = [_combine_segments(previous, following)]
                changed = True
                break

    filtered: list[PitchSegment] = []
    for segment in merged:
        if segment.end - segment.start >= settings.melody_min_note_duration_seconds:
            filtered.append(segment)
    return filtered


def _likely_mixed(audio: DecodedAudio, settings: Settings) -> bool:
    flatness = librosa.feature.spectral_flatness(y=audio.samples, n_fft=settings.melody_frame_length, hop_length=settings.melody_hop_length)[0]
    return bool(flatness.size and float(np.mean(flatness)) > 0.18)


class MelodyTranscriptionService:
    engine_name = "librosa.pyin"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.decoder = AudioDecoder(settings)

    def _empty(self, warnings: list[str], engine: str = "librosa.pyin") -> MelodyAnalysis:
        return MelodyAnalysis(
            note_events=[],
            melody_confidence=0.0,
            warnings=list(dict.fromkeys(warnings)),
            melody_engine=engine,
            melody_analysis_version=self.settings.melody_analysis_version,
        )

    def analyze(self, path: Path) -> MelodyAnalysis:
        audio = self.decoder.decode(path)
        warnings = ["This detector assumes isolated monophonic audio; dense or polyphonic recordings may produce incomplete or merged notes."]
        if audio.duration < self.settings.melody_min_note_duration_seconds * 2:
            return self._empty(warnings + ["Audio is too short for reliable melody transcription."])

        rms = librosa.feature.rms(y=audio.samples, frame_length=self.settings.melody_frame_length, hop_length=self.settings.melody_hop_length)[0]
        peak_rms = float(np.max(rms, initial=0.0)) if rms.size else 0.0
        if peak_rms <= 1e-7:
            return self._empty(warnings + ["Audio is silent; no melody notes were detected."])
        if peak_rms < self.settings.melody_min_rms:
            return self._empty(warnings + ["Audio is too weak for reliable melody transcription."])
        if peak_rms < self.settings.melody_min_rms * 6:
            warnings.append("Audio is weak; melody confidence may be unreliable.")
        if _likely_mixed(audio, self.settings):
            warnings.append("Audio may contain noise or polyphonic content; melody confidence is reduced.")

        engine = self.engine_name
        try:
            f0, voiced_flag, voiced_probability = _detect_with_pyin(audio, self.settings)
        except Exception as pyin_error:
            engine = "librosa.yin"
            warnings.append(f"librosa.pyin was unavailable; used the librosa.yin fallback ({type(pyin_error).__name__}).")
            try:
                f0, voiced_flag, voiced_probability = _detect_with_yin(audio, self.settings)
            except Exception as yin_error:
                return self._empty(warnings + [f"Melody pitch detection failed ({type(yin_error).__name__}); no notes were fabricated."], engine)

        f0 = np.asarray(f0, dtype=float).reshape(-1)
        voiced = _as_frame_array(voiced_flag, f0.size, 0.0) >= 0.5
        probabilities = _as_frame_array(voiced_probability, f0.size, 0.0)
        frame_rms = _aligned_rms(audio, self.settings, f0.size)
        frame_step = self.settings.melody_hop_length / audio.sample_rate
        silence_floor = max(peak_rms * 0.05, self.settings.melody_min_rms * 0.2)
        frames: list[PitchFrame] = []
        out_of_range = 0
        for index, frequency in enumerate(f0):
            if not np.isfinite(frequency) or not voiced[index] or probabilities[index] < self.settings.melody_min_voiced_probability or frame_rms[index] < silence_floor:
                continue
            if frequency < self.settings.melody_min_frequency or frequency > self.settings.melody_max_frequency:
                out_of_range += 1
                continue
            midi = float(librosa.hz_to_midi(float(frequency)))
            if not np.isfinite(midi):
                continue
            frames.append(PitchFrame(index=index, timestamp=index * frame_step, midi=midi, voiced_probability=_clamp(float(probabilities[index]), 0.0, 1.0), strength=_clamp(float(frame_rms[index] / peak_rms), 0.0, 1.0)))

        if out_of_range:
            warnings.append(f"Ignored {out_of_range} voiced frames outside the configured frequency range.")
        if not frames:
            return self._empty(warnings + ["No reliable voiced melody frames were detected; no notes were fabricated."], engine)

        segments = _merge_segments(_make_segments(frames, audio.duration, self.settings), self.settings)
        events: list[MelodyNoteEvent] = []
        for index, segment in enumerate(segments, start=1):
            values = np.asarray([frame.midi for frame in segment.frames], dtype=float)
            probability = float(np.mean([frame.voiced_probability for frame in segment.frames]))
            stability = _clamp(float(np.exp(-2.0 * np.std(values))), 0.0, 1.0)
            strength = float(np.mean([frame.strength for frame in segment.frames]))
            confidence = _clamp(0.5 * probability + 0.3 * stability + 0.2 * strength, 0.0, 1.0)
            start = round(max(0.0, segment.start), 6)
            duration = round(max(self.settings.melody_min_note_duration_seconds, segment.end - segment.start), 6)
            events.append(MelodyNoteEvent(id=f"melody-note-{index:04d}", midi_note=max(0, min(127, segment.midi)), note_name=midi_to_name(max(0, min(127, segment.midi))), start_time=start, duration=duration, velocity=max(1, min(127, int(round(20 + 107 * strength)))), confidence=round(confidence, 3), hand=None, finger=None))

        if not events:
            return self._empty(warnings + ["No notes passed the minimum duration threshold; no notes were fabricated."], engine)
        confidence = round(float(np.mean([event.confidence for event in events])), 3)
        if confidence < 0.5:
            warnings.append("Melody confidence is low; note timing and pitch may be unreliable.")
        return MelodyAnalysis(note_events=events, melody_confidence=confidence, warnings=list(dict.fromkeys(warnings)), melody_engine=engine, melody_analysis_version=self.settings.melody_analysis_version)
