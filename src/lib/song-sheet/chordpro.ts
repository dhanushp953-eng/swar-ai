import type { SongSheet, SongLine, SongSection } from "@/types/song-sheet";

export type ChordProDirective = {
  key: string;
  value: string | null;
};

/**
 * Renders a line as ChordPro. A segment with a chord becomes `[Ch]text`; a
 * segment without one contributes only its text. Leading/trailing spaces on the
 * lyric text are trimmed so the chord anchor stays directly adjacent to the
 * word (ChordPro renders `[C]word` with the chord over the word).
 */
export function renderChordProLine(line: SongLine): string {
  let output = "";
  for (const segment of line.segments) {
    const text = segment.text;
    if (segment.chord) output += `[${segment.chord}]`;
    output += text.trim();
  }
  return output;
}

export function renderChordProSection(section: SongSection): string {
  const marker = section.title.trim() !== "" ? `{section:${section.title.trim().replace(/\s+/g, " ")}}` : "";
  const body = section.lines.map(renderChordProLine).filter((line) => line.trim() !== "");
  return [marker, ...body].filter((line) => line.trim() !== "").join("\n");
}

/**
 * Serializes a song sheet to ChordPro text: a `{title}` directive from the
 * metadata, then `{key}` from the detected key, then one block per section
 * (optional `{section label}` directive followed by its lines).
 */
export function songSheetToChordPro(sheet: SongSheet): string {
  const header = [`{title:${sheet.metadata.title}}`, `{key:${sheet.metadata.key}}`];
  const blocks = sheet.sections.map(renderChordProSection);
  return [...header, "", ...blocks].join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

const DIRECTIVE_LINE = /^\s*\{([A-Za-z][A-Za-z0-9_]*)(?::(.*?))?\}\s*$/;
const CHORD_INLINE = /\[([^\]\n]+)\]/g;

/**
 * Splits a ChordPro line into segments. Each `[Chord]` marker becomes a
 * segment whose text is everything up to the next marker (or end of line), so
 * `[C]hello [G]world` becomes [{chord:"C",text:"hello "},{chord:"G",text:"world"}]
 * and the reader renders each chord directly over its lyric span. Any leading
 * text before the first marker is kept as a lyric-only segment.
 */
export function parseChordProLine(line: string): SongLine {
  const markers: { index: number; end: number; chord: string }[] = [];
  let match: RegExpExecArray | null;
  CHORD_INLINE.lastIndex = 0;
  while ((match = CHORD_INLINE.exec(line)) !== null) {
    markers.push({ index: match.index, end: CHORD_INLINE.lastIndex, chord: match[1] });
  }
  if (markers.length === 0) {
    const text = line.trim();
    return { segments: text !== "" ? [{ chord: null, text }] : [] };
  }
  const segments: SongLine["segments"] = [];
  const leading = line.slice(0, markers[0].index);
  for (let k = 0; k < markers.length; k += 1) {
    const start = markers[k].end;
    const end = k + 1 < markers.length ? markers[k + 1].index : line.length;
    segments.push({ chord: markers[k].chord, text: line.slice(start, end) });
  }
  if (leading.trim() !== "") segments.unshift({ chord: null, text: leading.trim() });
  return { segments };
}

/**
 * Parses ChordPro text into sections. `{section ...}` or `{title ...}` directives
 * become an [Intro]… section label; other `{key:value}` directives (key, bpm,
 * meta, etc.) are collected and returned for the caller. Blank lines split
 * sections; repeated section labels get an index suffix to keep ids unique.
 */
export function parseChordPro(text: string): { sections: SongSection[]; directives: ChordProDirective[] } {
  const rawLines = text.split(/\r?\n/);
  const directives: ChordProDirective[] = [];
  const sections: SongSection[] = [];
  const sectionCount = new Map<string, number>();
  let current: SongSection | null = null;
  let lineIndex = 0;

  const flush = () => {
    if (current && current.lines.length > 0) sections.push(current);
    current = null;
  };

  const beginSection = (title: string): SongSection => {
    flush();
    const base = title.trim();
    const count = (sectionCount.get(base) ?? 0) + 1;
    sectionCount.set(base, count);
    const id = `section-${base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "song"}-${lineIndex}-${count}`;
    const next: SongSection = { id, title: base, type: "verse", lines: [] };
    current = next;
    return next;
  };

  for (const rawLine of rawLines) {
    lineIndex += 1;
    const trimmed = rawLine.trim();
    if (trimmed === "") {
      flush();
      continue;
    }
    const directive = DIRECTIVE_LINE.exec(trimmed);
    if (directive) {
      const key = directive[1].toLowerCase();
      const value = directive[2] ?? null;
      if (key === "section" || key === "comment") {
        beginSection(value ?? "Section");
      } else {
        directives.push({ key, value });
      }
      continue;
    }
    current = current ?? beginSection("Verse");
    current.lines.push(parseChordProLine(rawLine));
  }
  flush();
  return { sections, directives };
}
/**
 * Parses ChordPro into a full SongSheet by merging provided metadata with any
 * title/key directives found in the text. Used to preview edited sheets before
 * committing them to the reader.
 */
export function chordProToSongSheet(text: string, source: Pick<SongSheet, "metadata" | "chordsUsed">): SongSheet {
  const { sections, directives } = parseChordPro(text);
  const titleDirective = directives.find((directive) => directive.key === "title")?.value;
  const keyDirective = directives.find((directive) => directive.key === "key")?.value;
  const chordSet = new Set<string>();
  for (const section of sections) {
    for (const line of section.lines) {
      for (const segment of line.segments) {
        if (segment.chord) chordSet.add(segment.chord);
      }
    }
  }
  return {
    id: source.metadata.title === titleDirective ? `edited-${source.metadata.title}` : `edited-${titleDirective ?? source.metadata.title}`,
    metadata: {
      ...source.metadata,
      title: titleDirective ?? source.metadata.title,
      key: keyDirective ?? source.metadata.key,
    },
    chordsUsed: chordSet.size > 0 ? Array.from(chordSet) : source.chordsUsed,
    sections,
  };
}