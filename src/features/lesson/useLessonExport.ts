"use client";

import { useCallback, useState } from "react";
import { runLessonExport } from "./lesson-export";
import type { LessonExportKind, LessonExportProviders, LessonExportState } from "./lesson-export";

export type LessonExportControls = {
  state: LessonExportState;
  exportOriginal: () => void;
  exportCurrent: () => void;
  clear: () => void;
};

/**
 * Drives the export UI state machine. The result is applied on the next
 * macrotask so the loading state actually renders between the click and the
 * download/success/error transition instead of being batched away.
 */
export function useLessonExport(providers: LessonExportProviders): LessonExportControls {
  const [state, setState] = useState<LessonExportState>({ status: "idle", kind: null });

  const clear = useCallback(() => setState({ status: "idle", kind: null }), []);

  const runExport = useCallback(
    (kind: LessonExportKind) => {
      setState({ status: "loading", kind });
      globalThis.setTimeout(() => {
        setState(runLessonExport(kind, providers));
      }, 0);
    },
    [providers],
  );

  const exportOriginal = useCallback(() => runExport("original"), [runExport]);
  const exportCurrent = useCallback(() => runExport("current"), [runExport]);

  return { state, exportOriginal, exportCurrent, clear };
}
