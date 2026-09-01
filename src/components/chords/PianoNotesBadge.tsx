"use client";

import React from "react";
import type { PianoChordDef } from "@/types/song-sheet";
import { formatChordWithSymbols } from "@/lib/song-sheet/transpose";

interface PianoNotesBadgeProps {
  chord: PianoChordDef;
  size?: "sm" | "md" | "lg";
}

export function PianoNotesBadge({ chord, size = "md" }: PianoNotesBadgeProps) {
  const formattedName = formatChordWithSymbols(chord.name);

  return (
    <div
      className={`piano-notes-card size-${size}`}
      data-testid={`piano-notes-${chord.name}`}
      role="region"
      aria-label={`Piano notes for ${chord.name} chord`}
    >
      <div className="piano-chord-title">
        <strong>{formattedName}</strong>
        <span className="piano-chord-badge-pill">{chord.badge}</span>
      </div>

      <div className="piano-notes-list">
        {chord.notes.map((note, idx) => (
          <div key={`${note}-${idx}`} className="piano-note-chip">
            <span className="note-name">{formatChordWithSymbols(note)}</span>
            {chord.intervals[idx] && (
              <span className="note-interval">{chord.intervals[idx]}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
