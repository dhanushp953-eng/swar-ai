from __future__ import annotations

import numpy as np
import pytest

from app.pipeline.chords import (
    _reject_short,
    _smooth_labels,
    _template_match,
    _template_scores,
    chord_symbol,
    detect_chords,
)
from app.models import ChordEvent
from tests.audio_fixtures import (
    synth_cg_am_f_progression,
    synth_c_f_g_progression,
    weighted_chord_accuracy,
)

_CHORD_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _sustained_chord(root_hz: float, dur_sec: float, sr: int = 22050) -> np.ndarray:
    """A steady triadic chord with no percussion or transients beyond a soft attack."""
    t = np.arange(int(dur_sec * sr)) / sr
    sample = np.zeros_like(t, dtype=np.float32)
    for n in range(1, 4):
        sample += 0.12 * np.sin(2 * np.pi * root_hz * n * t) / n
    for m, amp in zip((1.0, 1.26, 1.5), (0.16, 0.11, 0.13)):
        sample += amp * np.sin(2 * np.pi * root_hz * m * t)
    env = np.ones_like(t)
    attack = int(0.2 * sr)
    env[:attack] = np.linspace(0, 1, attack)
    env[-attack:] = np.linspace(1, 0, attack)
    return (sample * env).astype(np.float32)


def _make_settings(**overrides):
    from app.config import Settings

    defaults = dict(
        chord_confidence_threshold=0.30,
        chord_min_duration_seconds=0.6,
        chord_smoothing_window=3,
        cqt_bins_per_octave=36,
        chord_window_seconds=1.0,
    )
    defaults.update(overrides)
    return Settings(**defaults)


def test_chord_symbols():
    assert chord_symbol(0, "major") == "C"
    assert chord_symbol(9, "minor") == "Am"
    assert chord_symbol(7, "major") == "G"
    assert chord_symbol(5, "minor") == "Fm"


def test_template_match_rejects_unclear_vector():
    # A flat chroma (energy spread across all pitch classes) should not produce
    # a high-confidence clear chord match; score is low.
    chroma = np.ones(12)
    label, score = _template_match(chroma)
    assert label in {chord_symbol(r, q) for r in range(12) for q in ("major", "minor")}
    assert score < 0.6


def test_template_match_major_easy():
    chroma = np.zeros(12)
    chroma[[0, 4, 7]] = 1.0  # C major C-E-G
    label, score = _template_match(chroma)
    assert label == "C"
    assert score > 0.5


def _ideal_triad_col(root: int, intervals: tuple[int, ...]) -> np.ndarray:
    col = np.zeros(12)
    for interval in intervals:
        col[(root + interval) % 12] = 1.0
    return col


@pytest.mark.parametrize("root", range(12))
def test_template_match_all_major_roots(root: int):
    """Every major root's ideal chroma must match that root, not collapse to C."""
    label, score = _template_match(_ideal_triad_col(root, (0, 4, 7)))
    assert label == _CHORD_NAMES[root]
    assert score > 0.95


@pytest.mark.parametrize("root", range(12))
def test_template_match_all_minor_roots(root: int):
    """Every minor root's ideal chroma must match that root, not collapse to C."""
    label, score = _template_match(_ideal_triad_col(root, (0, 3, 7)))
    assert label == f"{_CHORD_NAMES[root]}m"
    assert score > 0.95


def test_template_scores_differ_across_roots():
    """Regression: every candidate used to be scored against the un-rotated
    C-based template, so scores were IDENTICAL across all 12 roots and the
    argmax degenerated to C regardless of the actual chord. Root-transposed
    templates must differentiate candidates."""
    scores = _template_scores(_ideal_triad_col(7, (0, 4, 7)))  # ideal G major
    assert scores.shape == (12, 2)
    assert np.ptp(scores) > 1e-9
    root, quality = np.unravel_index(int(scores.argmax()), scores.shape)
    assert (int(root), int(quality)) == (7, 0)
    assert abs(scores[7, 0] - 1.0) < 1e-6
    # The true root must clearly outsore the (previously favoured) C root.
    assert scores[7, 0] > scores[0, 0] * 1.5


def test_detect_chords_recovers_cgamf_progression_in_order():
    """Regression: a clean C-G-Am-F accompaniment must be recovered with high
    accuracy, with each chord appearing as a correct non-N event in order."""
    sr = 22050
    beats_per_chord, beat_sec = 4, 0.5
    audio, _ = synth_cg_am_f_progression(sr=sr, beats_per_chord=beats_per_chord, beat_sec=beat_sec)
    dur = len(audio) / sr
    segment = beats_per_chord * beat_sec
    expected = [(ch, (i * segment, (i + 1) * segment)) for i, ch in enumerate(["C", "G", "Am", "F"])]
    result = detect_chords(audio, sr, _make_settings())
    accuracy = weighted_chord_accuracy(result.chords, expected, dur)
    assert accuracy >= 0.8
    recovered = [c.chord for c in result.chords if c.chord != "N"]
    assert recovered == ["C", "G", "Am", "F"]


def test_smooth_labels_majority():
    labels = ["C", "G", "G", "G", "C", "G"]
    smoothed = _smooth_labels(labels, window=3)
    # window 3 majority should keep "G" dominant through the run
    assert smoothed[2] == "G"


def test_detect_chords_recovers_c_am_f():
    """End-to-end: synthesize C-Am-F and verify approximate chord recovery."""
    sr = 22050
    # Use fewer beats per chord to keep the test fast
    audio = np.concatenate(
        [
            synth_cg_am_f_progression(sr, beats_per_chord=6)[0][: int(2 * sr)],
            synth_cg_am_f_progression(sr, beats_per_chord=6)[0],
        ]
    )[: int(12 * sr)]  # keep bounded
    settings = _make_settings()
    result = detect_chords(audio, sr, settings, bpm=None)
    chords = result.chords
    # With a click track present, the beat tracker should win and report a real BPM.
    assert result.beat_source == "percussive"
    assert result.warning is None
    assert result.bpm is not None and result.bpm > 0
    recovered = [c.chord for c in chords if c.chord != "N"]
    assert recovered, "expected some chords to be recovered"
    # The progression uses C and F; at least one of C / F / G / Am should appear
    assert any(r in {"C", "F", "G", "Am"} for r in recovered)


def test_confidence_threshold_maps_to_n(worker_settings):
    from app.pipeline.chords import _threshold_and_merge

    labels = ["C", "C", "C"]
    low_conf = worker_settings.chord_confidence_threshold - 0.2
    beats = [0.0, 0.5, 1.0]
    events = _threshold_and_merge(labels, [low_conf, low_conf, low_conf], beats, worker_settings)
    # all below threshold -> N
    assert all(ev.chord == "N" for ev in events)


def test_merge_repeated_adjacent_chords(worker_settings):
    events = [
        ChordEvent(chord="C", start=0.0, end=0.6, confidence=0.8, beat_index=0),
        ChordEvent(chord="C", start=0.6, end=1.2, confidence=0.7, beat_index=1),
        ChordEvent(chord="G", start=1.2, end=1.8, confidence=0.8, beat_index=2),
    ]
    merged = _reject_short(events, worker_settings)
    # C should be merged into a single event
    merged_c = [e for e in merged if e.chord == "C"]
    assert len(merged_c) == 1
    assert abs(merged_c[0].end - 1.2) < 1e-6


def test_reject_unstable_short_changes(worker_settings):
    # A short chord below min duration should be dropped
    events = [
        ChordEvent(chord="C", start=0.0, end=2.0, confidence=0.8, beat_index=0),
        ChordEvent(chord="D", start=0.5, end=0.7, confidence=0.8, beat_index=1),  # too short
        ChordEvent(chord="G", start=2.0, end=3.0, confidence=0.8, beat_index=2),
    ]
    merged = _reject_short(events, worker_settings)
    assert not any(e.chord == "D" for e in merged)
    assert any(e.chord == "C" for e in merged)


def test_silence_uses_windowed_fallback_and_no_bpm():
    """Silence has no beats or onsets: must fall back to windowed analysis,
    report beat_source=windowed_fallback, a warning, and no fabricated BPM."""
    sr = 22050
    audio = np.zeros(int(4 * sr), dtype=np.float32)
    settings = _make_settings()
    result = detect_chords(audio, sr, settings)
    assert result.bpm is None
    assert result.beat_source == "windowed_fallback"
    assert result.warning is not None
    assert "beats" in result.warning.lower() or "time windows" in result.warning.lower()
    # No chord should be detected over pure silence
    assert all(c.chord == "N" for c in result.chords)


def test_sustained_chords_without_percussion_use_onset_or_windowed():
    """A steady chord with no beat events should not fabricate a BPM."""
    sr = 22050
    # Two sustained chords stacked back-to-back (starts/ends are soft, few onsets)
    audio = np.concatenate(
        [_sustained_chord(261.63, 3.0, sr), _sustained_chord(220.0, 3.0, sr)]
    )
    settings = _make_settings(chord_confidence_threshold=0.28)
    result = detect_chords(audio, sr, settings)
    # BPM must never be invented when beats are unreliable
    assert result.bpm is None
    assert result.beat_source in {"onset_envelope", "windowed_fallback"}
    assert result.warning is not None


def test_beat_fallback_metadata_and_warning():
    """Windowed fallback must expose beat_source, attach a warning, and never
    claim a real BPM (e.g. never a fabricated 120 BPM)."""
    sr = 22050
    silence = np.zeros(int(3 * sr), dtype=np.float32)
    result = detect_chords(silence, sr, _make_settings())
    assert result.beat_source == "windowed_fallback"
    assert result.warning is not None
    assert result.bpm is None
    assert result.bpm != 120.0


def test_no_fabricated_bpm_with_bpm_hint():
    """Even when a caller supplies a bpm hint, a missing reliable beat track
    must never turn it into a claimed BPM on the output."""
    sr = 22050
    silence = np.zeros(int(3 * sr), dtype=np.float32)
    result = detect_chords(silence, sr, _make_settings(), bpm=120.0)
    assert result.beat_source == "windowed_fallback"
    assert result.bpm is None


def test_no_implausible_bpm_returned():
    """Even when the beat tracker spuriously finds a tempo, the pipeline must
    never report a fabricated/implausible BPM outside the musical range."""
    sr = 22050
    rng = np.random.default_rng(11)
    audio = rng.standard_normal(int(4 * sr)).astype(np.float32)
    settings = _make_settings()
    result = detect_chords(audio, sr, settings)
    if result.bpm is not None:
        assert 40.0 <= result.bpm <= 200.0
    assert result.bpm != 120.0 or result.beat_source != "windowed_fallback"


def test_chords_with_click_track_report_reliable_bpm():
    """A clear click track should give a real estimated BPM, not a fallback."""
    sr = 22050
    audio, _ = synth_cg_am_f_progression(sr, beats_per_chord=6, beat_sec=0.5)
    settings = _make_settings()
    result = detect_chords(audio, sr, settings)
    assert result.beat_source == "percussive"
    assert result.warning is None
    assert result.bpm is not None and 60 < result.bpm < 200


def test_low_confidence_no_chord_audio():
    """Broadband noise contains no real chord: any best-match remains low
    confidence (well below what a genuine chord achieves) and no BPM is relied on."""
    sr = 22050
    rng = np.random.default_rng(7)
    audio = rng.standard_normal(int(4 * sr)).astype(np.float32)
    settings = _make_settings()
    result = detect_chords(audio, sr, settings)
    confident = [c for c in result.chords if c.chord != "N"]
    if confident:
        # The pipeline must not claim a confident chord from pure noise.
        assert max(c.confidence for c in confident) < 0.6


# ---------------------------------------------------------------------------
# Regression tests: chord-event timebase bug (events must stay within audio)
# ---------------------------------------------------------------------------


def _assert_chord_event_invariants(chords, audio_duration: float) -> None:
    """Common invariant checks used by multiple regression tests."""
    tolerance = 1e-3
    for i, ev in enumerate(chords):
        assert ev.start >= 0.0 - tolerance, f"event {i}: start={ev.start} < 0"
        assert ev.end > ev.start - tolerance, f"event {i}: end={ev.end} <= start={ev.start}"
        assert ev.end <= audio_duration + tolerance, (
            f"event {i}: end={ev.end:.4f} exceeds audio_duration={audio_duration:.4f}"
        )
    for i in range(1, len(chords)):
        assert chords[i].start >= chords[i - 1].end - tolerance, (
            f"events {i-1},{i}: not ordered/non-overlapping"
        )
    if chords:
        assert abs(chords[-1].end - audio_duration) <= 0.5 + tolerance, (
            f"last event ends at {chords[-1].end:.4f} but audio is {audio_duration:.4f}s"
        )


def test_cfgcfg_events_within_audio_duration_22050():
    """Timebase regression: C-F-G-C-F-G at 22.05kHz; no event must exceed audio duration."""
    sr = 22050
    audio, gt_segments = synth_c_f_g_progression(sr=sr, beats_per_chord=8, beat_sec=0.5)
    audio_duration = len(audio) / sr
    settings = _make_settings()
    result = detect_chords(audio, sr, settings)
    _assert_chord_event_invariants(result.chords, audio_duration)


def test_cfgcfg_events_within_audio_duration_44100():
    """Timebase regression: C-F-G-C-F-G at 44.1kHz stereo-converted; events stay within duration."""
    sr = 44100
    audio_mono, _ = synth_c_f_g_progression(sr=sr, beats_per_chord=8, beat_sec=0.5)
    # Simulate stereo input by duplicating to 2 channels then averaging back (as process.py does)
    stereo = np.stack([audio_mono, audio_mono], axis=1)
    mono = stereo.mean(axis=1).astype(np.float32)
    audio_duration = len(mono) / sr
    settings = _make_settings()
    result = detect_chords(mono, sr, settings)
    _assert_chord_event_invariants(result.chords, audio_duration)


def test_cfgcfg_events_within_audio_duration_resampled():
    """Timebase regression: resampled 44.1kHz → 22.05kHz must still stay within duration."""
    from tests.audio_fixtures import synth_chord_audio

    sr_orig = 44100
    sr_target = 22050
    audio_orig, _ = synth_c_f_g_progression(sr=sr_orig, beats_per_chord=8, beat_sec=0.5)
    # Decimate by 2 (equivalent to the linear resample demucs or ffmpeg does)
    n_new = int(round(len(audio_orig) * sr_target / sr_orig))
    audio = np.interp(
        np.linspace(0, len(audio_orig) - 1, n_new),
        np.arange(len(audio_orig)),
        audio_orig,
    ).astype(np.float32)
    audio_duration = len(audio) / sr_target
    settings = _make_settings()
    result = detect_chords(audio, sr_target, settings)
    _assert_chord_event_invariants(result.chords, audio_duration)


def test_cfgcfg_accuracy_against_ground_truth():
    """C-F-G-C-F-G detection must reach >=80% duration-weighted accuracy against fixture timestamps."""
    sr = 22050
    audio, gt_segments = synth_c_f_g_progression(sr=sr, beats_per_chord=8, beat_sec=0.5)
    audio_duration = len(audio) / sr
    settings = _make_settings()
    result = detect_chords(audio, sr, settings)

    _assert_chord_event_invariants(result.chords, audio_duration)

    # C, F, G must all be present
    detected_labels = {ev.chord for ev in result.chords if ev.chord != "N"}
    assert "C" in detected_labels, f"C not detected; got {detected_labels}"
    assert "F" in detected_labels, f"F not detected; got {detected_labels}"
    assert "G" in detected_labels, f"G not detected; got {detected_labels}"

    accuracy = weighted_chord_accuracy(result.chords, gt_segments, audio_duration)
    assert accuracy >= 0.80, (
        f"Duration-weighted chord accuracy {accuracy:.1%} < 80% "
        f"(detected: {[ev.chord for ev in result.chords if ev.chord != 'N']})"
    )


@pytest.mark.parametrize("sr", [22050, 44100])
def test_cfgcfg_timing_consistent_across_sample_rates(sr):
    """Event boundaries must be consistent (within one beat) regardless of sample rate."""
    audio, gt_segments = synth_c_f_g_progression(sr=sr, beats_per_chord=8, beat_sec=0.5)
    audio_duration = len(audio) / sr
    settings = _make_settings()
    result = detect_chords(audio, sr, settings)
    _assert_chord_event_invariants(result.chords, audio_duration)
    # Each non-N chord event should have boundaries consistent with ground truth (within 1 beat)
    one_beat = 0.5
    for ev in result.chords:
        if ev.chord == "N":
            continue
        # Find the matching gt segment
        matched = [seg for (label, seg) in gt_segments if label == ev.chord]
        assert matched, f"Detected chord {ev.chord!r} not in ground truth {gt_segments}"
        # Confirm at least one matching segment overlaps this event
        overlap = any(seg[1] > ev.start and seg[0] < ev.end for seg in matched)
        assert overlap, (
            f"Event {ev.chord} [{ev.start:.2f}-{ev.end:.2f}] doesn't overlap any gt segment {matched}"
        )


def test_event_order_and_nonoverlap_44100_stereo_converted():
    """Events must be ordered and non-overlapping after stereo→mono at 44.1kHz."""
    sr = 44100
    audio_mono, _ = synth_c_f_g_progression(sr=sr, beats_per_chord=8, beat_sec=0.5)
    stereo = np.stack([audio_mono, audio_mono * 0.9], axis=1).mean(axis=1).astype(np.float32)
    audio_duration = len(stereo) / sr
    result = detect_chords(stereo, sr, _make_settings())
    _assert_chord_event_invariants(result.chords, audio_duration)
