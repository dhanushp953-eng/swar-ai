from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import Settings  # noqa: E402


@pytest.fixture()
def worker_settings(tmp_path) -> Settings:
    """Isolated settings with temp and model dirs under the test directory."""
    return Settings(
        temp_root=Path(tmp_path) / "runtime",
        model_dir=Path(tmp_path) / "models",
        max_concurrent_jobs=1,
        line_max_chars=80,
        line_pause_seconds=0.55,
        uncertain_word_confidence=0.45,
        chord_confidence_threshold=0.45,
        chord_min_duration_seconds=0.40,
        chord_smoothing_window=3,
    )
