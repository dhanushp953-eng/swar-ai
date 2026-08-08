from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import librosa
import numpy as np

from app.services.audio import DecodedAudio


@dataclass(frozen=True)
class RawNote:
    midi: int
    start: float
    end: float
    velocity: int
    confidence: float


class TranscriptionService(Protocol):
    @property
    def name(self) -> str: ...

    @property
    def available(self) -> bool: ...

    @property
    def reason(self) -> str | None: ...

    def transcribe(self, path: Path, audio: DecodedAudio) -> list[RawNote]: ...


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


class LibrosaPitchTranscriptionService:
    name = "librosa-yin-fallback"
    available = True
    reason = "Local monophonic fallback using librosa.yin."

    def transcribe(self, path: Path, audio: DecodedAudio) -> list[RawNote]:
        del path
        hop_length = 256
        frame_length = 2048
        if audio.samples.size < frame_length:
            return []
        f0 = librosa.yin(audio.samples, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C7"), sr=audio.sample_rate, frame_length=frame_length, hop_length=hop_length)
        rms = librosa.feature.rms(y=audio.samples, frame_length=frame_length, hop_length=hop_length)[0]
        frame_times = librosa.frames_to_time(np.arange(f0.size), sr=audio.sample_rate, hop_length=hop_length)
        rms = np.pad(rms, (0, max(0, f0.size - rms.size)), mode="edge")[: f0.size]
        peak = float(np.max(rms, initial=0.0))
        if peak <= 1e-7:
            return []
        silence_floor = max(peak * 0.08, 1e-5)
        frames: list[tuple[int, float, float]] = []
        for index, frequency in enumerate(f0):
            if not np.isfinite(frequency) or rms[index] < silence_floor:
                continue
            midi = int(round(float(librosa.hz_to_midi(frequency))))
            if 0 <= midi <= 127:
                frames.append((midi, float(frame_times[index]), _clamp(float(rms[index] / peak), 0.05, 1.0)))
        if not frames:
            return []
        frame_step = hop_length / audio.sample_rate
        notes: list[RawNote] = []
        current_midi, start, strength = frames[0]
        previous_time = frames[0][1]
        strength_values = [strength]
        for midi, timestamp, frame_strength in frames[1:]:
            contiguous = timestamp - previous_time <= frame_step * 1.75
            if midi != current_midi or not contiguous:
                end = min(audio.duration, previous_time + frame_step)
                if end - start >= frame_step * 1.5:
                    notes.append(RawNote(current_midi, max(0.0, start), end, int(round(45 + 82 * float(np.mean(strength_values)))), float(np.mean(strength_values))))
                current_midi, start, strength_values = midi, timestamp, [frame_strength]
            else:
                strength_values.append(frame_strength)
            previous_time = timestamp
        end = min(audio.duration, previous_time + frame_step)
        if end - start >= frame_step * 1.5:
            notes.append(RawNote(current_midi, max(0.0, start), end, int(round(45 + 82 * float(np.mean(strength_values)))), float(np.mean(strength_values))))
        return notes


class BasicPitchTranscriptionService:
    name = "basic-pitch"

    def __init__(self) -> None:
        self._predict = None
        self.reason: str | None = None
        try:
            from basic_pitch.inference import predict

            self._predict = predict
        except Exception as error:  # import failures can come from optional model runtimes
            self.reason = f"Basic Pitch is unavailable: {type(error).__name__}: {error}"

    @property
    def available(self) -> bool:
        return self._predict is not None

    def transcribe(self, path: Path, audio: DecodedAudio) -> list[RawNote]:
        del audio
        if self._predict is None:
            raise RuntimeError(self.reason or "Basic Pitch is unavailable.")
        _, _, note_events = self._predict(str(path))
        result: list[RawNote] = []
        for event in note_events:
            if isinstance(event, dict):
                start = float(event.get("start_time", event.get("start", 0)))
                end = float(event.get("end_time", event.get("end", start)))
                midi = int(round(float(event.get("midi", 0))))
                amplitude = float(event.get("amplitude", event.get("confidence", 0.5)))
            else:
                values = list(event)
                if len(values) < 4:
                    continue
                start, end, midi, amplitude = float(values[0]), float(values[1]), int(round(float(values[2]))), float(values[3])
            if 0 <= midi <= 127 and end > start:
                confidence = _clamp(amplitude, 0.0, 1.0)
                result.append(RawNote(midi, max(0.0, start), end, max(1, min(127, int(round(127 * confidence)))), confidence))
        return result
