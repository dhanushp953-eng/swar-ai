"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { getMidiController, type WebMidiController } from "@/lib/midi/web-midi";

export function useWebMidi(controller?: WebMidiController) {
  const midi = controller ?? getMidiController();
  const subscribe = useMemo(() => (listener: () => void) => midi.subscribeState(listener), [midi]);
  const state = useSyncExternalStore(subscribe, midi.getState, midi.getState);

  useEffect(() => {
    midi.checkSupport();
  }, [midi]);

  const connect = useCallback(() => void midi.connect(), [midi]);
  const disconnect = useCallback(() => midi.disconnect(), [midi]);
  const refresh = useCallback(() => midi.refresh(), [midi]);
  const selectDevice = useCallback((id: string) => midi.selectDevice(id), [midi]);
  const releaseAll = useCallback(() => midi.releaseAll(), [midi]);

  return { state, connect, disconnect, refresh, selectDevice, releaseAll };
}

export function useMidiHeldNotes(controller?: WebMidiController): ReadonlySet<number> {
  const midi = controller ?? getMidiController();
  const subscribe = useMemo(() => (listener: () => void) => midi.subscribeHeldNotes(listener), [midi]);
  return useSyncExternalStore(subscribe, midi.getHeldNotes, midi.getHeldNotes);
}
