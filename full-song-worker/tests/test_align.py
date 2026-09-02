from __future__ import annotations

import pytest

from app.adapters.whisper import _group_words_into_lines
from app.models import LyricWord
from app.pipeline.align import (
    anchor_chords_to_words,
    build_song_sheet,
    find_active_chord,
    lyrics_to_sections,
)
from app.models import ChordEvent


def _w(text, start, end, conf=0.9):
    return LyricWord(text=text, start=start, end=end, confidence=conf, uncertain=conf < 0.45)


def _events():
    return [
        ChordEvent(chord="C", start=0.0, end=2.0, confidence=0.9, beat_index=0),
        ChordEvent(chord="G", start=2.0, end=4.0, confidence=0.9, beat_index=2),
    ]


def test_find_active_chord():
    evs = _events()
    assert find_active_chord(evs, 0.5).chord == "C"
    assert find_active_chord(evs, 2.5).chord == "G"
    assert find_active_chord(evs, 4.5) is None


def test_line_grouping_by_pause():
    words = [
        _w("hello", 0.0, 0.3),
        _w("world", 0.35, 0.6),
        _w("next", 1.5, 1.8),  # big gap -> new line
        _w("line", 1.85, 2.0),
    ]
    lines = _group_words_into_lines(words, max_chars=80, pause_seconds=0.55, uncertain_confidence=0.45)
    assert len(lines) == 2
    assert lines[0].text == "hello world"
    assert lines[1].text == "next line"


def test_line_grouping_by_max_length():
    words = [
        _w("aaa", 0.0, 0.2),
        _w("bbb", 0.22, 0.4),
        _w("ccc", 0.42, 0.6),
        _w("ddd", 0.62, 0.8),
    ]
    lines = _group_words_into_lines(words, max_chars=10, pause_seconds=99.0, uncertain_confidence=0.45)
    # Each group of words stays under 10 chars -> "aaa bbb" (7) fits, "ccc ddd" fits
    assert len(lines) in (2,)


def test_line_uncertain_flag():
    words = [_w("maybe", 0.0, 0.3, conf=0.2)]
    lines = _group_words_into_lines(words, max_chars=80, pause_seconds=0.55, uncertain_confidence=0.45)
    assert lines[0].uncertain is True


def test_word_uncertain_flag():
    w = _w("fuzzy", 0.0, 0.3, conf=0.3)
    assert w.uncertain is True
    w2 = _w("clear", 0.4, 0.6, conf=0.9)
    assert w2.uncertain is False


def test_anchor_chords_to_words():
    words = [_w("one", 0.5, 0.7), _w("two", 2.5, 2.7)]
    anchors = anchor_chords_to_words(words, _events())
    assert anchors[0].chord == "C"
    assert anchors[0].time == 0.5
    assert anchors[1].chord == "G"


def test_lyrics_to_sections_embeds_chords_not_in_text():
    words = [_w("twinkle", 0.1, 0.4, conf=0.9), _w("star", 0.5, 0.8, conf=0.9)]
    lines = [
        __import__("app.models", fromlist=["LyricLine"]).LyricLine(
            text="twinkle star", start=0.1, end=0.8, confidence=0.9, uncertain=False, words=words
        )
    ]
    sections = lyrics_to_sections(lines, _events())
    seg = sections[0].lines[0].segments[0]
    assert seg.chord == "C"
    assert seg.text == "twinkle"
    # chord text is NOT spliced into the lyric word
    assert seg.text != "C twinkle"
    assert seg.text == "twinkle"


def test_build_song_sheet_shape():
    words = [_w("twinkle", 0.1, 0.4, conf=0.9), _w("star", 0.5, 0.8, conf=0.9)]
    lines = [
        __import__("app.models", fromlist=["LyricLine"]).LyricLine(
            text="twinkle star", start=0.1, end=0.8, confidence=0.9, uncertain=False, words=words
        )
    ]
    sheet = build_song_sheet(
        song_id="s1",
        title="Twinkle",
        lyric_lines=lines,
        chord_events=_events(),
        chords_used=["C", "G"],
        key="C",
    )
    assert sheet.id == "s1"
    assert sheet.chordsUsed == ["C", "G"]
    assert sheet.metadata["title"] == "Twinkle"
    assert sheet.sections[0].lines[0].segments[0].chord == "C"
    # JSON-serialisable via pydantic
    import json

    payload = json.loads(sheet.model_dump_json())
    assert payload["chordsUsed"] == ["C", "G"]
    assert payload["sections"][0]["lines"][0]["segments"][0]["chord"] == "C"
