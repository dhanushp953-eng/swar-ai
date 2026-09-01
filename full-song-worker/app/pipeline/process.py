from __future__ import annotations

import time
from pathlib import Path
from typing import Callable, Optional

from app.adapters.demucs import DemucsAdapter
from app.adapters.ffmpeg import FFmpegAdapter
from app.adapters.whisper import WhisperAdapter
from app.capabilities import demucs_capability, ffmpeg_capability, whisper_capability
from app.config import Settings
from app.errors import CapabilityError, WorkerError
from app.models import ChordEvent, FullSongResult, ModelInfo, SongSheetCompat
from app.pipeline import align as align_mod
from app.pipeline.chords import detect_chords


class JobCancelled(Exception):
    pass


ProgressCallback = Callable[[float, str], None]


def _check_cancelled(cancel_token: Optional[Callable[[], bool]]) -> None:
    if cancel_token is not None and cancel_token():
        raise JobCancelled()


def process_full_song(
    *,
    settings: Settings,
    staged_wav: Path,
    duration_seconds: float,
    ffmpeg: FFmpegAdapter,
    song_id: str,
    title: str,
    progress: ProgressCallback | None = None,
    cancel_token: Optional[Callable[[], bool]] = None,
) -> FullSongResult:
    started = time.monotonic()

    def report(fraction: float, message: str) -> None:
        if progress is not None:
            progress(fraction, message)

    report(0.05, "Decoding audio with FFmpeg")
    _check_cancelled(cancel_token)
    decode_dir = settings.temp_root / "decode"
    decode_dir.mkdir(parents=True, exist_ok=True)
    mixture_path = decode_dir / f"{song_id}-mixture.wav"
    ffmpeg.decode_to_wav(staged_wav, mixture_path, sample_rate=settings.target_sample_rate)
    _check_cancelled(cancel_token)

    # Vocal separation
    report(0.25, "Separating vocals from accompaniment")
    accompaniment = None
    vocals_path: Path | None = None
    accompaniment_sr: int = settings.target_sample_rate  # will be updated after separation
    try:
        separate_dir = settings.temp_root / "stems"
        separate_dir.mkdir(parents=True, exist_ok=True)
        demucs = DemucsAdapter(settings, progress=lambda f, m: report(0.25 + f * 0.25, m))
        _check_cancelled(cancel_token)
        stems = demucs.separate(mixture_path, separate_dir)
        accompaniment_sr = int(stems["sample_rate"])
        accompaniment = stems["accompaniment"]
        vocals_path = separate_dir / f"{song_id}-vocals.wav"
        _write_pcm(vocals_path, stems["vocals"], accompaniment_sr)
    except CapabilityError:
        # Separation unavailable; lyrics may still be transcribed from the mixture.
        report(0.35, "Demucs unavailable; will transcribe from the full mixture")
        accompaniment = None

    _check_cancelled(cancel_token)

    # Lyrics transcription
    report(0.5, "Transcribing timed lyrics")
    transcribe_input = vocals_path or mixture_path
    whisper = WhisperAdapter(settings, progress=lambda f, m: report(0.5 + f * 0.2, m))
    transcript = whisper.transcribe(transcribe_input, duration_seconds)
    _check_cancelled(cancel_token)

    # Chord detection on accompaniment (or mixture if separation unavailable)
    report(0.72, "Detecting chords")
    chord_events: list[ChordEvent] = []
    bpm = None
    beat_source: str | None = None
    warnings: list[str] = list(transcript.warnings)
    try:
        _check_cancelled(cancel_token)
        chord_source = accompaniment
        chord_sr: int
        if chord_source is None:
            import soundfile as sf

            data, chord_sr = sf.read(str(mixture_path), dtype="float32")
            if data.ndim > 1:
                data = data.mean(axis=1)
            chord_source = data
        else:
            chord_sr = accompaniment_sr
        chord_result = detect_chords(
            chord_source,
            chord_sr,
            settings,
        )
        chord_events = chord_result.chords
        beat_times = chord_result.beat_times
        if chord_result.bpm and chord_result.bpm > 0:
            bpm = chord_result.bpm
        beat_source = chord_result.beat_source
        if chord_result.warning:
            warnings.append(chord_result.warning)
    except Exception:  # noqa: BLE001 - chord detection must not fail lyrics-only results
        report(0.85, "Chord detection degraded")
        beat_times = []

    _check_cancelled(cancel_token)
    report(0.85, "Aligning chords with lyrics and building result")

    anchors = align_mod.anchor_chords_to_words(transcript.words, chord_events)
    song_sheet = align_mod.build_song_sheet(
        song_id=song_id,
        title=title,
        lyric_lines=transcript.lines,
        chord_events=chord_events,
        chords_used=[c.chord for c in chord_events if c.chord != "N"],
        key=_estimate_key(chord_events),
    )
    del beat_times

    # Determine used/available capabilities
    ffmpeg_info = ffmpeg_capability(settings)
    demucs_info = demucs_capability(settings)
    if accompaniment is None and demucs_info.available:
        demucs_info.available = False
    whisper_info = whisper_capability(settings)

    processing_seconds = time.monotonic() - started
    if accompaniment is None:
        warnings.append("Vocal separation was unavailable; chords and full-song sheet reflect the full mix, reducing accuracy.")
    if not chord_events:
        warnings.append("No reliable chords were detected below the confidence threshold.")
    if len(chord_events) == 0 and not transcript.words:
        warnings.append("Neither lyrics nor chords were confidently detected.")

    return FullSongResult(
        analysis_version=settings.analysis_version,
        duration=duration_seconds,
        language=transcript.language,
        language_confidence=transcript.language_confidence,
        bpm=bpm,
        beat_source=beat_source,
        lyric_words=transcript.words,
        lyric_lines=transcript.lines,
        chord_events=chord_events,
        chord_anchors=anchors,
        song_sheet=song_sheet,
        warnings=list(dict.fromkeys(warnings)),
        model_info=ModelInfo(demucs=demucs_info, whisper=whisper_info, ffmpeg=ffmpeg_info),
        processing_time_seconds=processing_seconds,
    )


def _write_pcm(path: Path, audio, sample_rate: int) -> None:
    import soundfile as sf

    sf.write(str(path), audio, samplerate=sample_rate, subtype="PCM_16")


def _estimate_key(chord_events: list[ChordEvent]) -> str:
    if not chord_events:
        return "C"
    root_counts: dict[str, int] = {}
    for ev in chord_events:
        if ev.chord == "N":
            continue
        root = ev.chord[:-1] if ev.chord.endswith("m") else ev.chord
        root_counts[root] = root_counts.get(root, 0) + 1
    if not root_counts:
        return "C"
    return max(root_counts, key=root_counts.get)
