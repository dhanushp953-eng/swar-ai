"use client";

import React from "react";
import type { UkuleleChordDef } from "@/types/song-sheet";
import { formatChordWithSymbols } from "@/lib/song-sheet/transpose";

interface UkuleleChordSvgProps {
  chord: UkuleleChordDef;
  size?: "sm" | "md" | "lg";
}

export function UkuleleChordSvg({ chord, size = "md" }: UkuleleChordSvgProps) {
  const width = size === "sm" ? 76 : size === "lg" ? 126 : 96;
  const height = size === "sm" ? 98 : size === "lg" ? 154 : 122;

  const leftPad = 20;
  const topPad = 30;
  const gridWidth = width - leftPad * 2;
  const gridHeight = height - topPad - 18;

  const stringCount = 4; // G C E A
  const fretCount = 5;
  const stringSpacing = gridWidth / (stringCount - 1);
  const fretSpacing = gridHeight / fretCount;

  const formattedName = formatChordWithSymbols(chord.name);

  return (
    <div className="chord-svg-container" data-testid={`ukulele-chord-${chord.name}`}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Ukulele chord diagram for ${chord.name}`}
        className="chord-svg ukulele-chord-svg"
      >
        {/* Chord Title */}
        <text
          x={width / 2}
          y={17}
          textAnchor="middle"
          fill="var(--text, #f5f1f7)"
          fontSize={size === "sm" ? "13" : "15"}
          fontWeight="bold"
          fontFamily="inherit"
        >
          {formattedName}
        </text>

        {/* Nut (fret 1) or Base Fret */}
        {chord.baseFret === 1 ? (
          <line
            x1={leftPad}
            y1={topPad}
            x2={leftPad + gridWidth}
            y2={topPad}
            stroke="var(--violet, #b795ff)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        ) : (
          <text
            x={leftPad - 13}
            y={topPad + fretSpacing / 2 + 4}
            fill="var(--violet, #b795ff)"
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

        {/* Strings (4 vertical lines) */}
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
          const startX = leftPad + (4 - barre.fromString) * stringSpacing;
          const endX = leftPad + (4 - barre.toString) * stringSpacing;
          const y = topPad + (barre.fret - chord.baseFret + 0.5) * fretSpacing;
          return (
            <rect
              key={`barre-${idx}`}
              x={Math.min(startX, endX) - 5}
              y={y - 5}
              width={Math.abs(endX - startX) + 10}
              height={10}
              rx={5}
              fill="var(--violet, #b795ff)"
              opacity={0.85}
            />
          );
        })}

        {/* String status markers & dots */}
        {chord.frets.map((fret, stringIdx) => {
          const x = leftPad + stringIdx * stringSpacing;
          const finger = chord.fingers[stringIdx];

          if (fret === -1) {
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
            return (
              <circle
                key={`open-${stringIdx}`}
                cx={x}
                cy={topPad - 8}
                r="3.2"
                fill="none"
                stroke="var(--violet, #b795ff)"
                strokeWidth="1.4"
              />
            );
          }

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
                fill="var(--violet, #b795ff)"
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
