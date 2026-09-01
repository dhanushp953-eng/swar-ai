"use client";

import React from "react";
import type { GuitarChordDef } from "@/types/song-sheet";
import { formatChordWithSymbols } from "@/lib/song-sheet/transpose";

interface GuitarChordSvgProps {
  chord: GuitarChordDef;
  size?: "sm" | "md" | "lg";
}

export function GuitarChordSvg({ chord, size = "md" }: GuitarChordSvgProps) {
  const width = size === "sm" ? 84 : size === "lg" ? 140 : 108;
  const height = size === "sm" ? 104 : size === "lg" ? 168 : 132;

  // Grid coordinates
  const leftPad = 22;
  const topPad = 32;
  const gridWidth = width - leftPad * 2;
  const gridHeight = height - topPad - 20;

  const stringCount = 6;
  const fretCount = 5;
  const stringSpacing = gridWidth / (stringCount - 1);
  const fretSpacing = gridHeight / fretCount;

  const formattedName = formatChordWithSymbols(chord.name);

  return (
    <div className="chord-svg-container" data-testid={`guitar-chord-${chord.name}`}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Guitar chord diagram for ${chord.name}`}
        className="chord-svg guitar-chord-svg"
      >
        {/* Chord Title */}
        <text
          x={width / 2}
          y={18}
          textAnchor="middle"
          fill="var(--text, #f5f1f7)"
          fontSize={size === "sm" ? "13" : "16"}
          fontWeight="bold"
          fontFamily="inherit"
        >
          {formattedName}
        </text>

        {/* Nut (fret 1) or Base Fret Number */}
        {chord.baseFret === 1 ? (
          <line
            x1={leftPad}
            y1={topPad}
            x2={leftPad + gridWidth}
            y2={topPad}
            stroke="var(--amber, #f3b66d)"
            strokeWidth="4"
            strokeLinecap="round"
          />
        ) : (
          <text
            x={leftPad - 14}
            y={topPad + fretSpacing / 2 + 4}
            fill="var(--amber, #f3b66d)"
            fontSize="10"
            fontFamily="inherit"
            fontWeight="bold"
          >
            {chord.baseFret}fr
          </text>
        )}

        {/* Frets (horizontal lines) */}
        {Array.from({ length: fretCount + 1 }, (_, i) => {
          const y = topPad + i * fretSpacing;
          return (
            <line
              key={`fret-${i}`}
              x1={leftPad}
              y1={y}
              x2={leftPad + gridWidth}
              y2={y}
              stroke="var(--line, #2c2732)"
              strokeWidth="1.2"
            />
          );
        })}

        {/* Strings (vertical lines) */}
        {Array.from({ length: stringCount }, (_, i) => {
          const x = leftPad + i * stringSpacing;
          return (
            <line
              key={`string-${i}`}
              x1={x}
              y1={topPad}
              x2={x}
              y2={topPad + gridHeight}
              stroke="var(--muted, #a49cae)"
              strokeWidth="1.2"
            />
          );
        })}

        {/* Barre indicators */}
        {chord.barres?.map((barre, idx) => {
          const startX = leftPad + (6 - barre.fromString) * stringSpacing;
          const endX = leftPad + (6 - barre.toString) * stringSpacing;
          const y = topPad + (barre.fret - chord.baseFret + 0.5) * fretSpacing;
          return (
            <rect
              key={`barre-${idx}`}
              x={Math.min(startX, endX) - 5}
              y={y - 5}
              width={Math.abs(endX - startX) + 10}
              height={10}
              rx={5}
              fill="var(--amber, #f3b66d)"
              opacity={0.85}
            />
          );
        })}

        {/* String status markers (Top: X / O) & Finger Dots */}
        {chord.frets.map((fret, stringIdx) => {
          const x = leftPad + stringIdx * stringSpacing;
          const finger = chord.fingers[stringIdx];

          if (fret === -1) {
            // Muted string X
            return (
              <text
                key={`mute-${stringIdx}`}
                x={x}
                y={topPad - 6}
                textAnchor="middle"
                fill="var(--muted, #a49cae)"
                fontSize="11"
                fontFamily="inherit"
              >
                ✕
              </text>
            );
          }

          if (fret === 0) {
            // Open string O
            return (
              <circle
                key={`open-${stringIdx}`}
                cx={x}
                cy={topPad - 9}
                r="3.5"
                fill="none"
                stroke="var(--amber, #f3b66d)"
                strokeWidth="1.5"
              />
            );
          }

          // Fretted note dot
          const adjustedFret = fret - chord.baseFret + 1;
          if (adjustedFret < 1 || adjustedFret > fretCount) return null;

          const dotY = topPad + (adjustedFret - 0.5) * fretSpacing;
          const dotRadius = size === "sm" ? 5 : size === "lg" ? 8 : 6.5;

          return (
            <g key={`dot-${stringIdx}`}>
              <circle
                cx={x}
                cy={dotY}
                r={dotRadius}
                fill="var(--amber, #f3b66d)"
              />
              {finger && (
                <text
                  x={x}
                  y={dotY + (size === "sm" ? 3 : 4)}
                  textAnchor="middle"
                  fill="#0c0b0f"
                  fontSize={size === "sm" ? "8" : "10"}
                  fontWeight="bold"
                  fontFamily="inherit"
                >
                  {finger}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
