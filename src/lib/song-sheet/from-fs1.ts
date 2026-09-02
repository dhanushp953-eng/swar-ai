import type { Fs1Result } from "@/lib/fs1-api";
import type { SongMetadata, SongSheet } from "@/types/song-sheet";

function metadataText(metadata: Record<string, unknown>, key: string, fallback: string): string {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * Maps a Phase FS1 worker result onto the frontend SongSheet type so it can be
 * rendered by SongSheetReader and edited by the Phase CL2 chord/lyrics editor.
 */
export function fs1ResultToSongSheet(result: Fs1Result): SongSheet {
  const source = result.song_sheet;
  const metadata = source.metadata;
  const defaultedKey = metadataText(metadata, "key", "C major");
  const difficulty = metadata.difficulty === "Intermediate" || metadata.difficulty === "Advanced" ? metadata.difficulty : "Beginner";
  const metadataTyped: SongMetadata = {
    title: metadataText(metadata, "title", "Untitled song"),
    composer: metadataText(metadata, "composer", "Detected"),
    periodOrOrigin: metadataText(metadata, "periodOrOrigin", "Full-song analysis"),
    attribution: metadataText(metadata, "attribution", "AI-detected — verify before publication"),
    difficulty,
    key: defaultedKey,
    originalKey: metadataText(metadata, "originalKey", defaultedKey),
    timeSignature: metadataText(metadata, "timeSignature", "4/4"),
    tuning: metadataText(metadata, "tuning", "E A D G B E"),
    defaultCapo: typeof metadata.defaultCapo === "number" && Number.isFinite(metadata.defaultCapo) ? Math.max(0, Math.min(12, Math.round(metadata.defaultCapo))) : 0,
    description: metadataText(metadata, "description", "Lyrics and chords were estimated by full-song analysis and may contain errors."),
    isPublicDomain: metadata.isPublicDomain === true,
  };
  return {
    id: source.id,
    metadata: metadataTyped,
    chordsUsed: Array.from(new Set(source.chordsUsed)),
    sections: source.sections.map((section) => ({
      id: section.id,
      title: section.title,
      type: section.type,
      lines: section.lines.map((line) => ({
        id: line.id ?? undefined,
        segments: line.segments.map((segment) => ({
          chord: segment.chord ?? null,
          text: segment.text,
        })),
      })),
    })),
  };
}