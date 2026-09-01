from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import numpy as np

from app.config import Settings
from app.errors import CapabilityError, WorkerError

logger = logging.getLogger("fs1.adapters.demucs")

ProgressCallback = Callable[[float, str], None]


class DemucsAdapter:
    """Vocal/accompaniment separation using Demucs.

    Models are loaded lazily on first use to keep worker startup fast and to
    avoid downloading weights until a job actually needs them. Weights are
    never committed and this adapter never fabricates a fallback result: if the
    capability is unavailable it raises :class:`CapabilityError`.
    """

    def __init__(self, settings: Settings, progress: ProgressCallback | None = None):
        self.settings = settings
        self.progress = progress

    def available(self) -> bool:
        if not self.settings.demucs_enabled:
            return False
        try:
            import demucs  # noqa: F401
            import torch  # noqa: F401
        except Exception:  # noqa: BLE001
            return False
        return True

    def _report(self, fraction: float, message: str) -> None:
        if self.progress is not None:
            self.progress(fraction, message)

    def separate(self, wav_path: Path, out_dir: Path) -> dict[str, np.ndarray]:
        """Return a dict of {'vocals': ndarray, 'accompaniment': ndarray}.

        Each array is mono float32 in [-1, 1] at the Demucs model sample rate.
        """
        if not self.available():
            raise CapabilityError(
                "demucs",
                "Demucs vocal separation is unavailable in this environment. "
                "Install the worker with demucs+torch dependencies; the prototype will not fabricate a separation result.",
            )
        out_dir.mkdir(parents=True, exist_ok=True)
        self._report(0.0, "Initializing Demucs model")
        model = self._load_model()
        sample_rate = model.samplerate
        try:
            self._report(0.2, "Loading audio for separation")
            sources = self._apply(model, wav_path, out_dir)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Demucs separation failed")
            raise WorkerError("separation_failed", f"Demucs separation failed: {exc}", 500) from exc
        self._report(1.0, "Separation complete")
        return self._collate(sources, sample_rate)

    def _load_model(self):
        import demucs.pretrained
        import demucs.separate

        del demucs.separate
        self._report(0.02, "Downloading/loading Demucs weights (first run only)")
        return demucs.pretrained.get_model(self.settings.demucs_model)

    def _apply(self, model, wav_path: Path, out_dir: Path) -> dict[str, np.ndarray]:
        import torch

        model.cpu()
        model.eval()
        sources = model.apply_model(
            torch.from_numpy(self._read_audio(wav_path, model.samplerate))[None],
            split=True,
            overlap=0.25,
            device="cpu",
        )[0]
        tracks = {}
        for i, name in enumerate(model.sources):
            tracks[name] = sources[i].numpy()
        return tracks

    @staticmethod
    def _read_audio(wav_path: Path, sample_rate: int) -> np.ndarray:
        import soundfile as sf

        data, sr = sf.read(str(wav_path), dtype="float32", always_2d=True)
        if data.shape[1] > 1:
            data = data.mean(axis=1, keepdims=True)
        data = data[:, 0]
        if sr != sample_rate:
            data = _resample_linear(data, sr, sample_rate)
        return data.astype(np.float32)

    @staticmethod
    def _collate(sources: dict[str, np.ndarray], sample_rate: int) -> dict[str, np.ndarray]:
        inputs = list(sources.values())
        vocals = sources.get("vocals", np.zeros_like(inputs[0]) if inputs else np.zeros(1, dtype=np.float32))
        stems = [v for k, v in sources.items() if k != "vocals"]
        if stems:
            accompaniment = np.clip(np.sum(stems, axis=0), -1.0, 1.0).astype(np.float32)
        else:
            accompaniment = np.zeros_like(vocals, dtype=np.float32)
        return {
            "vocals": vocals.astype(np.float32),
            "accompaniment": accompaniment.astype(np.float32),
            "sample_rate": np.float64(sample_rate),
        }


def _resample_linear(data: np.ndarray, orig_rate: int, new_rate: int) -> np.ndarray:
    n_new = int(round(len(data) * new_rate / orig_rate))
    return np.interp(np.linspace(0, len(data) - 1, n_new), np.arange(len(data)), data).astype(np.float32)


class DemucsCliAdapter:
    """Reference CLI-based Demucs adapter using the ``demucs`` console script.

    Kept for completeness; the in-process adapter is preferred.
    """

    def __init__(self, settings: Settings, progress: ProgressCallback | None = None):
        self.settings = settings
        self.progress = progress

    def available(self) -> bool:
        return shutil.which("demucs") is not None and self.settings.demucs_enabled

    def separate(self, wav_path: Path, out_dir: Path) -> dict[str, np.ndarray]:
        if not self.available():
            raise CapabilityError(
                "demucs",
                "Demucs CLI vocal separation is unavailable in this environment. Install the worker with demucs+torch dependencies.",
            )
        cmd = [
            "demucs",
            "--two-stems", "vocals",
            "--out", str(out_dir),
            "--mp3", "false",
            str(wav_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        if result.returncode != 0:
            raise WorkerError("separation_failed", f"Demucs CLI failed: {result.stderr[-2000:]}", 500)
        raise WorkerError("separation_failed", "Demucs CLI output loading not implemented.", 500)
