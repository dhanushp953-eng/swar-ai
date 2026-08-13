import io
import math
import struct
import wave
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def make_wav(duration: float = 0.2, sample_rate: int = 8000) -> bytes:
    frames = bytearray()
    for index in range(int(duration * sample_rate)):
        sample = int(9000 * math.sin(2 * math.pi * 440 * index / sample_rate))
        frames.extend(struct.pack("<h", sample))
    out = io.BytesIO()
    with wave.open(out, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(frames)
    return out.getvalue()


def test_analysis_services_are_singleton_across_requests(tmp_path: Path):
    # The melody/rhythm analyzers (which import and initialise librosa) are
    # created once at app startup and reused for every request. This locks in
    # that behavior so a later change cannot start re-initialising librosa per
    # request.
    app = create_app(Settings(temp_root=tmp_path))
    service = app.state.melody_analyzer
    calls = {"n": 0}
    original = service.analyze

    def counting(path):
        calls["n"] += 1
        return original(path)

    service.analyze = counting
    with TestClient(app) as client:
        response = client.post(
            "/api/analyze",
            data={"authorized": "true"},
            files={"file": ("tone.wav", make_wav(), "audio/wav")},
        )
    assert response.status_code == 201
    assert calls["n"] == 1
    assert app.state.melody_analyzer is service
