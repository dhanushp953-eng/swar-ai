"use client";

import { getNoteState, getVisibleEvents } from "@/utils/lesson-timing";
import { getPianoRollPosition } from "@/utils/music";
import type { HandMode, NoteEvent } from "@/types/lesson";

type PianoRollProps = {
  events: NoteEvent[];
  currentTime: number;
  handMode: HandMode;
  showNoteNames: boolean;
  showFingerNumbers: boolean;
  countInBeat: number;
  isPlaying: boolean;
};

const ROLL_HEIGHT = 250;
const HIT_LINE = 222;
const PIXELS_PER_SECOND = 44;

export function PianoRoll({ events, currentTime, handMode, showNoteNames, showFingerNumbers, countInBeat, isPlaying }: PianoRollProps) {
  const visibleEvents = getVisibleEvents(events, currentTime).filter((event) => handMode === "both" || event.hand === handMode);
  return <div className="lesson-roll" aria-label="Falling note piano roll">
    <div className="roll-grid" style={{ height: ROLL_HEIGHT }}>
      {Array.from({ length: 37 }, (_, index) => <span className="roll-grid-line" key={index} style={{ left: `${(index / 36) * 100}%` }} />)}
      <div className="roll-horizon" style={{ top: HIT_LINE }}><span>play line</span></div>
      {visibleEvents.map((event) => {
        const position = getPianoRollPosition(event.midi);
        const height = Math.max(14, event.duration * PIXELS_PER_SECOND);
        const top = HIT_LINE - ((event.start - currentTime) * PIXELS_PER_SECOND) - height;
        const state = getNoteState(event, currentTime);
        return <div key={event.id} className={`falling-note ${event.hand === "left" ? "left-hand" : "right-hand"} ${isPlaying && state === "active" ? "note-playing" : ""}`} style={{ left: `${position.left}%`, top, width: `${position.width}%`, height }} aria-label={`${event.name}, ${event.hand} hand${event.finger ? `, finger ${event.finger}` : ""}`}>
          {showNoteNames && <span>{event.name}</span>}
          {showFingerNumbers && event.finger && <b>{event.finger}</b>}
        </div>;
      })}
      {countInBeat > 0 && <div className="count-in-overlay"><span>get ready</span><strong>{countInBeat}</strong></div>}
    </div>
    <div className="roll-key-labels"><span>low</span><span>high</span></div>
  </div>;
}
