from app.schemas.analysis import NoteEvent
from app.services.transcription import RawNote

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def midi_to_name(midi: int) -> str:
    return f"{NOTE_NAMES[midi % 12]}{midi // 12 - 1}"


def raw_notes_to_events(notes: list[RawNote]) -> list[NoteEvent]:
    events: list[NoteEvent] = []
    for index, note in enumerate(sorted(notes, key=lambda item: (item.start, item.midi, item.end))):
        duration = max(0.01, note.end - note.start)
        events.append(NoteEvent(id=f"note-{index + 1:04d}", midi=note.midi, name=midi_to_name(note.midi), start=round(max(0.0, note.start), 6), duration=round(duration, 6), velocity=max(1, min(127, note.velocity)), confidence=max(0.0, min(1.0, note.confidence)), hand=None, finger=None))
    return events
