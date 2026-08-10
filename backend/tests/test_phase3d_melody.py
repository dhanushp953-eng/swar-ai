import io
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


SAMPLE_RATE = 22050
NOTE_FREQUENCIES = {
    40: 20.6017,
    60: 261.6256,
    64: 329.6276,
    67: 391.9954,
    69: 440.0,
    71: 493.8833,
    72: 523.2511,
    76: 659.2551,
    91: 2093.0045,
}


def make_wav(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> bytes:
    output = io.BytesIO()
    sf.write(output, samples.astype(np.float32), sample_rate, format="WAV", subtype="PCM_16")
    return output.getvalue()


def make_tone(frequency: float, duration: float, amplitude: float = 0.65, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    count = round(duration * sample_rate)
    time = np.arange(count, dtype=np.float32) / sample_rate
    envelope = np.ones(count, dtype=np.float32)
    fade = min(round(0.03 * sample_rate), count // 4)
    if fade:
        envelope[:fade] = np.linspace(0, 1, fade, dtype=np.float32)
        envelope[-fade:] = np.linspace(1, 0, fade, dtype=np.float32)
    return amplitude * np.sin(2 * np.pi * frequency * time) * envelope


def make_melody(midi_notes: list[int], duration: float = 0.45, amplitude: float = 0.65) -> bytes:
    return make_wav(np.concatenate([make_tone(440.0 * 2 ** ((midi - 69) / 12), duration, amplitude) for midi in midi_notes]))


@pytest.fixture
def app_factory(tmp_path: Path):
    def factory():
        return create_app(
            Settings(
                temp_root=tmp_path,
                analysis_sample_rate=SAMPLE_RATE,
                melody_min_note_duration_seconds=0.08,
                melody_merge_gap_seconds=0.08,
            )
        )

    return factory


def post_audio(client: TestClient, audio: bytes, filename: str = "melody.wav"):
    return client.post(
        "/api/analyze",
        data={"authorized": "true"},
        files={"file": (filename, audio, "audio/wav")},
    )


@pytest.mark.parametrize("midi", [69, 60, 76])
def test_single_notes_are_within_one_semitone(app_factory, midi: int):
    with TestClient(app_factory()) as client:
        response = post_audio(client, make_wav(make_tone(NOTE_FREQUENCIES[midi], 1.0)))
    payload = response.json()
    assert response.status_code == 201
    assert payload["melody_engine"] in {"librosa.pyin", "librosa.yin"}
    assert payload["melody_analysis_version"] == "3.1.0"
    assert payload["note_events"]
    event = min(payload["note_events"], key=lambda item: abs(item["midi_note"] - midi))
    assert abs(event["midi_note"] - midi) <= 1
    assert event["start_time"] <= 0.15
    assert event["duration"] >= 0.7
    assert event["hand"] is None
    assert event["finger"] is None
    assert 1 <= event["velocity"] <= 127
    assert 0 <= event["confidence"] <= 1


def test_ascending_scale_is_ordered_and_timed(app_factory):
    expected = list(range(60, 73))
    with TestClient(app_factory()) as client:
        response = post_audio(client, make_melody(expected, duration=0.4))

    payload = response.json()
    assert response.status_code == 201
    events = payload["note_events"]
    assert events == sorted(events, key=lambda item: item["start_time"])
    assert all(left["start_time"] + left["duration"] <= right["start_time"] + 0.08 for left, right in zip(events, events[1:]))
    cursor = 0
    for target in expected:
        match = next((index for index in range(cursor, len(events)) if abs(events[index]["midi_note"] - target) <= 1), None)
        assert match is not None
        cursor = match + 1
    assert payload["duration"] == pytest.approx(5.2, abs=0.02)


def test_short_original_melody_returns_note_sequence(app_factory):
    with TestClient(app_factory()) as client:
        response = post_audio(client, make_melody([60, 64, 67, 64], duration=0.35))

    payload = response.json()
    assert response.status_code == 201
    assert len(payload["note_events"]) >= 3
    assert all(event["duration"] >= 0.08 for event in payload["note_events"])


def test_silence_returns_no_fabricated_notes(app_factory):
    with TestClient(app_factory()) as client:
        response = post_audio(client, make_wav(np.zeros(SAMPLE_RATE * 2)))

    payload = response.json()
    assert payload["note_events"] == []
    assert payload["melody_confidence"] == 0
    assert any("silent" in warning.lower() for warning in payload["warnings"])


def test_weak_noisy_audio_returns_warning(app_factory):
    rng = np.random.default_rng(7)
    samples = make_tone(440, 1.0, amplitude=0.001) + rng.normal(0, 0.0002, SAMPLE_RATE).astype(np.float32)
    with TestClient(app_factory()) as client:
        response = post_audio(client, make_wav(samples))

    payload = response.json()
    assert payload["note_events"] == []
    assert any("weak" in warning.lower() for warning in payload["warnings"])


def test_pitch_transitions_are_ordered_and_non_overlapping(app_factory):
    with TestClient(app_factory()) as client:
        response = post_audio(client, make_melody([69, 71], duration=0.6))

    events = response.json()["note_events"]
    assert len(events) >= 2
    assert events[0]["midi_note"] in {68, 69, 70}
    assert events[-1]["midi_note"] in {70, 71, 72}
    assert all(left["start_time"] + left["duration"] <= right["start_time"] + 0.08 for left, right in zip(events, events[1:]))


def test_very_short_tone_is_removed(app_factory):
    with TestClient(app_factory()) as client:
        response = post_audio(client, make_wav(make_tone(440, 0.04)))

    payload = response.json()
    assert payload["note_events"] == []
    assert any("short" in warning.lower() for warning in payload["warnings"])


@pytest.mark.parametrize("midi", [40, 91])
def test_out_of_range_tone_is_not_reported(app_factory, midi: int):
    frequency = 20.6017 if midi == 40 else 3000.0
    with TestClient(app_factory()) as client:
        response = post_audio(client, make_wav(make_tone(frequency, 1.0)))

    payload = response.json()
    assert response.status_code == 201
    assert all(60 <= event["midi_note"] <= 84 for event in payload["note_events"])
    assert not payload["note_events"] or any("range" in warning.lower() for warning in payload["warnings"])


def test_success_cleanup(app_factory, tmp_path: Path):
    with TestClient(app_factory()) as client:
        response = post_audio(client, make_melody([69], duration=1.0))

    assert response.status_code == 201
    assert list(tmp_path.iterdir()) == []


def test_melody_failure_marks_job_failed_and_cleans_up(app_factory, tmp_path: Path, monkeypatch):
    app = app_factory()

    def fail(_path):
        raise RuntimeError("synthetic melody failure")

    monkeypatch.setattr(app.state.melody_analyzer, "analyze", fail)
    with TestClient(app) as client:
        response = post_audio(client, make_melody([69], duration=1.0))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "analysis_failed"
    record = next(iter(app.state.jobs._jobs.values()))
    assert record.status == "failed"
    assert record.progress == 100
    assert list(tmp_path.iterdir()) == []
