"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type { InstrumentTab, SongSheet } from "@/types/song-sheet";
import {
  getGuitarChord,
  getPianoNotes,
  getUkuleleChord,
} from "@/lib/song-sheet/chord-definitions";
import {
  formatChordWithSymbols,
  getSoundingKey,
  transposeChord,
} from "@/lib/song-sheet/transpose";
import { GuitarChordSvg } from "./GuitarChordSvg";
import { UkuleleChordSvg } from "./UkuleleChordSvg";
import { PianoNotesBadge } from "./PianoNotesBadge";

interface SongSheetReaderProps {
  songSheet: SongSheet;
}

export function SongSheetReader({ songSheet }: SongSheetReaderProps) {
  const [activeTab, setActiveTab] = useState<InstrumentTab>("guitar");
  const [transposeSemitones, setTransposeSemitones] = useState<number>(0);
  const [capoFret, setCapoFret] = useState<number>(songSheet.metadata.defaultCapo || 0);
  const [fontSizeIndex, setFontSizeIndex] = useState<number>(1); // 0=sm, 1=md, 2=lg, 3=xl
  const [isAutoScrolling, setIsAutoScrolling] = useState<boolean>(false);
  const [scrollSpeed, setScrollSpeed] = useState<number>(1.5); // 1 to 5 speed multiplier

  const songContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollAnimIdRef = useRef<number | null>(null);
  const lastScrollTimeRef = useRef<number>(0);
  const scrollSpeedRef = useRef<number>(scrollSpeed);

  useEffect(() => {
    scrollSpeedRef.current = scrollSpeed;
  }, [scrollSpeed]);

  const fontSizes = ["font-sm", "font-md", "font-lg", "font-xl"];
  const fontSizeLabels = ["Small", "Medium", "Large", "Extra Large"];


  // Transpose bounds: -6 to +6
  const handleTranspose = (delta: number) => {
    setTransposeSemitones((prev) => {
      const next = prev + delta;
      return Math.max(-6, Math.min(6, next));
    });
  };

  const handleResetTranspose = () => {
    setTransposeSemitones(0);
  };

  // Sounding key calculation
  const currentKey = useMemo(() => {
    const baseKey = transposeChord(songSheet.metadata.key, transposeSemitones);
    if (capoFret > 0) {
      return `${baseKey} (Capo ${capoFret} sounds in ${getSoundingKey(baseKey, capoFret)})`;
    }
    return baseKey;
  }, [songSheet.metadata.key, transposeSemitones, capoFret]);

  // Transposed chord names list for summary
  const transposedChords = useMemo(() => {
    return songSheet.chordsUsed.map((chord) => transposeChord(chord, transposeSemitones));
  }, [songSheet.chordsUsed, transposeSemitones]);

  // Auto-scroll loop with requestAnimationFrame and proper cleanup
  const stopAutoScroll = useCallback(() => {
    setIsAutoScrolling(false);
    if (scrollAnimIdRef.current !== null) {
      cancelAnimationFrame(scrollAnimIdRef.current);
      scrollAnimIdRef.current = null;
    }
  }, []);

  const startAutoScroll = useCallback(() => {
    setIsAutoScrolling(true);
    lastScrollTimeRef.current = performance.now();

    const step = (now: number) => {
      const delta = (now - lastScrollTimeRef.current) / 1000;
      lastScrollTimeRef.current = now;

      // Scroll speed: pixels per second (e.g. 28px/s at 1x)
      const pixelsToScroll = 28 * scrollSpeedRef.current * delta;

      const container = songContainerRef.current;
      if (container) {
        container.scrollTop += pixelsToScroll;

        // Check if reached the bottom
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
          setIsAutoScrolling(false);
          scrollAnimIdRef.current = null;
          return;
        }
      } else {
        window.scrollBy({ top: pixelsToScroll, behavior: "auto" });
      }

      scrollAnimIdRef.current = requestAnimationFrame(step);
    };

    scrollAnimIdRef.current = requestAnimationFrame(step);
  }, []);

  const toggleAutoScroll = () => {
    if (isAutoScrolling) {
      stopAutoScroll();
    } else {
      startAutoScroll();
    }
  };

  const restartScroll = () => {
    if (songContainerRef.current) {
      if (typeof songContainerRef.current.scrollTo === "function") {
        songContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        songContainerRef.current.scrollTop = 0;
      }
    } else if (typeof window.scrollTo === "function") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Clean up auto scroll on unmount
  useEffect(() => {
    return () => {
      if (scrollAnimIdRef.current !== null) {
        cancelAnimationFrame(scrollAnimIdRef.current);
      }
    };
  }, []);


  return (
    <section id="song-chords" className="chord-learning-workspace" aria-label="Song Chords Learning Workspace">
      <span id="chords" className="sr-only" aria-hidden="true" />
      {/* Header & Metadata */}

      <div className="chord-workspace-header">
        <div className="song-title-row">
          <div>
            <div className="song-badge-row">
              <span className="public-domain-badge">
                <Sparkles size={13} aria-hidden="true" />
                {songSheet.metadata.attribution}
              </span>
              <span className="difficulty-badge">{songSheet.metadata.difficulty}</span>
            </div>
            <h1 className="song-title">{songSheet.metadata.title}</h1>
            <p className="song-origin">{songSheet.metadata.periodOrOrigin}</p>
          </div>

          {/* Instrument Tab Switcher */}
          <div className="instrument-tab-group" role="tablist" aria-label="Instrument chord view tabs">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "guitar"}
              aria-controls="chord-view-panel"
              className={`instrument-tab ${activeTab === "guitar" ? "is-active" : ""}`}
              onClick={() => setActiveTab("guitar")}
            >
              <span className="tab-icon">🎸</span>
              <span>Guitar</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "ukulele"}
              aria-controls="chord-view-panel"
              className={`instrument-tab ${activeTab === "ukulele" ? "is-active" : ""}`}
              onClick={() => setActiveTab("ukulele")}
            >
              <span className="tab-icon">🪕</span>
              <span>Ukulele</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "piano-notes"}
              aria-controls="chord-view-panel"
              className={`instrument-tab ${activeTab === "piano-notes" ? "is-active" : ""}`}
              onClick={() => setActiveTab("piano-notes")}
            >
              <span className="tab-icon">🎹</span>
              <span>Piano Notes</span>
            </button>
          </div>
        </div>

        {/* Metadata Details Strip */}
        <div className="song-meta-strip" role="region" aria-label="Song specifications">
          <div className="meta-item">
            <span className="meta-label">Key</span>
            <strong className="meta-value">{currentKey}</strong>
          </div>
          <div className="meta-item">
            <span className="meta-label">Time</span>
            <strong className="meta-value">{songSheet.metadata.timeSignature}</strong>
          </div>
          <div className="meta-item">
            <span className="meta-label">Tuning</span>
            <strong className="meta-value">
              {activeTab === "ukulele" ? "G C E A" : songSheet.metadata.tuning}
            </strong>
          </div>
          <div className="meta-item">
            <span className="meta-label">Capo</span>
            <strong className="meta-value">{capoFret === 0 ? "None (0)" : `Fret ${capoFret}`}</strong>
          </div>
        </div>
      </div>

      {/* Interactive Controls Toolbar */}
      <div className="chord-controls-toolbar" role="toolbar" aria-label="Song sheet controls">
        {/* Auto Scroll Controls */}
        <div className="control-group auto-scroll-group" aria-label="Auto-scroll controls">
          <span className="control-group-title">Auto-Scroll</span>
          <div className="control-btn-row">
            <button
              type="button"
              className={`control-btn play-scroll-btn ${isAutoScrolling ? "is-active" : ""}`}
              onClick={toggleAutoScroll}
              aria-label={isAutoScrolling ? "Pause auto-scroll" : "Start auto-scroll"}
            >
              {isAutoScrolling ? <Pause size={14} /> : <Play size={14} />}
              <span>{isAutoScrolling ? "Pause" : "Scroll"}</span>
            </button>

            <button
              type="button"
              className="control-btn icon-btn"
              onClick={restartScroll}
              aria-label="Restart scroll to top"
              title="Restart to top"
            >
              <RotateCcw size={14} />
            </button>

            <div className="speed-selector" aria-label="Scroll speed options">
              {[1, 1.5, 2, 3].map((speed) => (
                <button
                  key={speed}
                  type="button"
                  className={`speed-btn ${scrollSpeed === speed ? "is-selected" : ""}`}
                  onClick={() => setScrollSpeed(speed)}
                  aria-label={`Scroll speed ${speed}x`}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Transpose Controls */}
        <div className="control-group transpose-group" aria-label="Transpose controls">
          <span className="control-group-title">Transpose</span>
          <div className="control-btn-row">
            <button
              type="button"
              className="control-btn icon-btn"
              onClick={() => handleTranspose(-1)}
              disabled={transposeSemitones <= -6}
              aria-label="Transpose down 1 semitone"
            >
              <Minus size={14} />
            </button>

            <span className="transpose-display" aria-live="polite" aria-label={`Transpose: ${transposeSemitones > 0 ? `+${transposeSemitones}` : transposeSemitones} semitones`}>
              {transposeSemitones === 0
                ? "0 (Original)"
                : `${transposeSemitones > 0 ? `+${transposeSemitones}` : transposeSemitones} st`}
            </span>

            <button
              type="button"
              className="control-btn icon-btn"
              onClick={() => handleTranspose(1)}
              disabled={transposeSemitones >= 6}
              aria-label="Transpose up 1 semitone"
            >
              <Plus size={14} />
            </button>

            {transposeSemitones !== 0 && (
              <button
                type="button"
                className="control-btn reset-btn"
                onClick={handleResetTranspose}
                aria-label="Reset transpose to original key"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Capo Controls */}
        <div className="control-group capo-group" aria-label="Capo placement controls">
          <span className="control-group-title">Capo</span>
          <div className="control-btn-row">
            <select
              id="capo-select"
              aria-label="Select capo fret"
              className="capo-select"
              value={capoFret}
              onChange={(e) => setCapoFret(Number(e.target.value))}
            >
              <option value={0}>No Capo (0)</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((fret) => (
                <option key={fret} value={fret}>
                  Fret {fret}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Font Size Controls */}
        <div className="control-group font-group" aria-label="Font size controls">
          <span className="control-group-title">Font Size</span>
          <div className="control-btn-row">
            <button
              type="button"
              className="control-btn icon-btn"
              onClick={() => setFontSizeIndex((prev) => Math.max(0, prev - 1))}
              disabled={fontSizeIndex <= 0}
              aria-label="Decrease font size"
            >
              <Minus size={13} />
            </button>

            <span className="font-size-label">{fontSizeLabels[fontSizeIndex]}</span>

            <button
              type="button"
              className="control-btn icon-btn"
              onClick={() => setFontSizeIndex((prev) => Math.min(fontSizes.length - 1, prev + 1))}
              disabled={fontSizeIndex >= fontSizes.length - 1}
              aria-label="Increase font size"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Chord Summary Card */}
      <div className="chord-summary-panel" id="chord-view-panel" role="region" aria-label="Chord diagrams summary">
        <div className="summary-header">
          <div className="summary-title-col">
            <span className="eyebrow">CHORD PALETTE</span>
            <h3>Chords used in this song ({transposedChords.length})</h3>
          </div>
          <span className="summary-instrument-hint">
            Showing {activeTab === "guitar" ? "Guitar" : activeTab === "ukulele" ? "Ukulele" : "Piano Notes"} voicings
          </span>
        </div>

        <div className="chord-diagrams-grid">
          {transposedChords.map((chordName) => {
            if (activeTab === "guitar") {
              const def = getGuitarChord(chordName);
              return <GuitarChordSvg key={chordName} chord={def} size="md" />;
            }
            if (activeTab === "ukulele") {
              const def = getUkuleleChord(chordName);
              return <UkuleleChordSvg key={chordName} chord={def} size="md" />;
            }
            const def = getPianoNotes(chordName);
            return <PianoNotesBadge key={chordName} chord={def} size="md" />;
          })}
        </div>
      </div>

      {/* Song Sheet Content: Chords Positioned Above Lyrics */}
      <div
        ref={songContainerRef}
        className={`song-sheet-container ${fontSizes[fontSizeIndex]}`}
        role="region"
        aria-label="Song sheet lyrics and chords"
      >
        {songSheet.sections.map((section) => (
          <div key={section.id} className={`song-section section-${section.type}`}>
            <h3 className="section-header-tag">[{section.title}]</h3>

            <div className="section-lines">
              {section.lines.map((line, lineIdx) => (
                <div key={line.id || `line-${lineIdx}`} className="song-lyric-line">
                  {line.segments.map((seg, segIdx) => {
                    const transposedSegChord = seg.chord
                      ? transposeChord(seg.chord, transposeSemitones)
                      : null;

                    return (
                      <span key={`seg-${lineIdx}-${segIdx}`} className="lyric-segment">
                        <span className="chord-anchor">
                          {transposedSegChord ? (
                            <strong className="chord-badge">
                              {formatChordWithSymbols(transposedSegChord)}
                            </strong>
                          ) : (
                            <span className="chord-spacer" aria-hidden="true" />
                          )}
                        </span>
                        <span className="lyric-text">{seg.text}</span>
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer / Educational Tip */}
      <div className="chord-learning-footer">
        <p>
          💡 <strong>Practice Tip:</strong> Strum downward on each beat (1, 2, 3, 4). On the <em>F Major</em> chord, ensure your index finger is flat against the first fret or play the 4-string beginner shape.
        </p>
      </div>
    </section>
  );
}
