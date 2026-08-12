"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
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

type PracticeResultsState = {
  storage: StorageLike | null;
  results: StoredPracticeResult[];
  hydrated: boolean;
};

const INITIAL_STATE: PracticeResultsState = {
  storage: null,
  results: [],
  hydrated: false,
};

const DEFAULT_OPTIONS: UsePracticeResultsOptions = {};

function resolveStorage(injectedStorage?: StorageLike): StorageLike | null {
  if (injectedStorage) return injectedStorage;
  try {
    if (typeof globalThis.localStorage !== "undefined") return globalThis.localStorage;
  } catch {
    // localStorage access can throw in some privacy modes
  }
  return null;
}

/** Keeps hydration idempotent when an effect is replayed by React Strict Mode. */
export function hydratePracticeResultsState(
  current: PracticeResultsState,
  storage: StorageLike | null,
  results: StoredPracticeResult[],
): PracticeResultsState {
  if (current.hydrated && current.storage === storage) return current;
  if (current.results.length === 0) return { storage, results, hydrated: true };
  const merged = [...current.results, ...results].sort((left, right) => right.createdAt - left.createdAt);
  const deduped = merged.filter((result, index, all) => all.findIndex((candidate) => candidate.id === result.id) === index);
  return { storage, results: deduped, hydrated: true };
}

/** Loads the practice-results history and exposes save/delete/clear mutations
 *  that keep React state and localStorage in sync. */
export function usePracticeResults({ storage: injectedStorage }: UsePracticeResultsOptions = DEFAULT_OPTIONS) {
  const [state, setState] = useState<PracticeResultsState>(INITIAL_STATE);
  const hydratedStorage = useRef<StorageLike | null | undefined>(undefined);

  useEffect(() => {
    const storage = resolveStorage(injectedStorage);
    if (hydratedStorage.current === storage) return;
    hydratedStorage.current = storage;
    const results = readResults(storage);
    startTransition(() => {
      setState((current) => hydratePracticeResultsState(current, storage, results));
    });
  }, [injectedStorage]);

  const saveResult = useCallback(
    (input: Omit<NewStoredResult, "id" | "createdAt">) => {
      const stored = createStoredResult(input);
      setState((current) => ({ ...current, results: addResult(current.storage, stored) }));
    },
    [],
  );

  const deleteResultById = useCallback(
    (id: string) => {
      setState((current) => ({ ...current, results: deleteResult(current.storage, id) }));
    },
    [],
  );

  const clearResultsAll = useCallback(() => {
    setState((current) => ({ ...current, results: clearResults(current.storage) }));
  }, []);

  return {
    results: state.results,
    hydrated: state.hydrated,
    hasStorage: state.hydrated && state.storage !== null,
    saveResult,
    deleteResult: deleteResultById,
    clearResults: clearResultsAll,
  };
}
