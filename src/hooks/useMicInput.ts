"use client";

import { useEffect, useState } from "react";
import type { MicInputController } from "@/lib/mic/mic-input";
import type { MicConnectionState } from "@/lib/mic/mic-types";

/** Reactive mirror of a mic controller's connection state for React components. */
export function useMicInput(controller: MicInputController): MicConnectionState {
  const [state, setState] = useState<MicConnectionState>(() => controller.getState());

  useEffect(() => {
    const unsubscribe = controller.subscribeState(() => {
      setState(controller.getState());
    });
    return unsubscribe;
  }, [controller]);

  return state;
}
