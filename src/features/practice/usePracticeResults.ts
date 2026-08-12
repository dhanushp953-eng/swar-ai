"use client";

import { useCallback, useState } from "react";
import {
  addResult,
  clearResults,
  createStoredResult,
  deleteResult,
  readResults,
  type NewStoredResult,
  type StorageLike,
  type StoredPracticeResult,
} from "./results-store";

export type UsePracticeResultsOptions = {
  /** Injectable storage for tests; defaults to browser localStorage. */
  storage?: StorageLike;
};

function resolveStorage(options: UsePracticeResultsOptions): StorageLike | null {
  if (options.storage) return options.storage;
  try {
    if (typeof globalThis.localStorage !== "undefined") return globalThis.localStorage;
  } catch {
    // localStorage access can throw in some privacy modes
  }
  return null;
}

/** Loads the practice-results history and exposes save/delete/clear mutations
 *  that keep React state and localStorage in sync. */
export function usePracticeResults(options: UsePracticeResultsOptions = {}) {
  const [storage] = useState<StorageLike | null>(() => resolveStorage(options));
  const [results, setResults] = useState<StoredPracticeResult[]>(() => readResults(storage));

  const saveResult = useCallback(
    (input: Omit<NewStoredResult, "id" | "createdAt">) => {
      const stored = createStoredResult(input);
      setResults(addResult(storage, stored));
    },
    [storage],
  );

  const deleteResultById = useCallback(
    (id: string) => {
      setResults(deleteResult(storage, id));
    },
    [storage],
  );

  const clearResultsAll = useCallback(() => {
    setResults(clearResults(storage));
  }, [storage]);

  return {
    results,
    hasStorage: storage !== null,
    saveResult,
    deleteResult: deleteResultById,
    clearResults: clearResultsAll,
  };
}
