"use client";

import { useSyncExternalStore } from "react";
import type { SongSheet } from "@/types/song-sheet";

let currentSheet: SongSheet | null = null;
const listeners = new Set<() => void>();

export function getAnalyzedSheet(): SongSheet | null {
  return currentSheet;
}

export function subscribeAnalyzedSheet(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setAnalyzedSheet(sheet: SongSheet | null): void {
  const next = sheet ?? null;
  if (next === currentSheet) return;
  currentSheet = next;
  for (const listener of listeners) listener();
}

export function clearAnalyzedSheet(): void {
  setAnalyzedSheet(null);
}

/** React binding for the analyzed-song-sheet store. Falls back to `null` on the server. */
export function useAnalyzedSheet(): SongSheet | null {
  return useSyncExternalStore(subscribeAnalyzedSheet, getAnalyzedSheet, () => null);
}