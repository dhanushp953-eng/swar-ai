"use client";

import { useAnalyzedSheet, setAnalyzedSheet } from "@/lib/song-sheet/analyzed-sheet-store";
import { twinkleLittleStarSongSheet } from "@/data/twinkle-song-sheet";
import { SongEditorPanel } from "@/features/correction/SongEditorPanel";
import { SongSheetReader } from "./SongSheetReader";

/**
 * Renders SongSheetReader with the live analyzed sheet when one exists, falling
 * back to the built-in public-domain demo song otherwise. Kept as a thin client
 * wrapper so SongSheetReader itself stays a pure presentational component. When
 * a full-song analysis is loaded, the correction editor appears below the
 * reader and publishes corrected sheets back into the store.
 */
export function SongSheetReaderConnected() {
  const analyzedSheet = useAnalyzedSheet();
  return (
    <>
      <SongSheetReader songSheet={analyzedSheet ?? twinkleLittleStarSongSheet} />
      {analyzedSheet && <SongEditorPanel songSheet={analyzedSheet} onPublish={(sheet) => setAnalyzedSheet(sheet)} />}
    </>
  );
}