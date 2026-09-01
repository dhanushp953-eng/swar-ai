"use client";

import { AlertTriangle, KeyboardMusic, Lock, RefreshCw, Square, Volume2 } from "lucide-react";
import { useEffect } from "react";
import { useWebMidi } from "@/hooks/useWebMidi";
import { type WebMidiController } from "@/lib/midi/web-midi";
import type { MidiConnectionStatus } from "@/lib/midi/midi-types";

const STATUS_LABELS: Record<MidiConnectionStatus, string> = {
  unsupported: "Unsupported",
  "permission-required": "Permission required",
  connecting: "Connecting",
  connected: "Connected",
  "permission-denied": "Permission denied",
  "device-disconnected": "No device",
  error: "Error",
};

export function MidiKeyboardPanel({ controller }: { controller?: WebMidiController }) {
  const { state, connect, disconnect, refresh, selectDevice, releaseAll } = useWebMidi(controller);

  useEffect(() => () => { releaseAll(); }, [releaseAll]);

  const status = state.status;
  const isConnecting = status === "connecting";
  const showConnect = status === "permission-required" || status === "permission-denied" || status === "device-disconnected" || status === "error";
  const connected = status === "connected";

  return <section className="midi-panel" aria-labelledby="midi-title">
    <div className="midi-heading">
      <div>
        <p className="eyebrow">Hardware input / 01B</p>
        <h2 id="midi-title">MIDI keyboard</h2>
      </div>
      <p className="midi-privacy"><Lock size={13} /> MIDI stays in your browser — nothing is recorded or sent anywhere</p>
    </div>

    <div className="midi-status-region">
      <div className="midi-status" role="status" aria-live="polite">
        <span className={`midi-status-dot status-${status}`} aria-hidden="true" />
        <strong>{STATUS_LABELS[status]}</strong>
        {connected && state.selectedDeviceId ? <span className="midi-status-device">{state.devices.find((device) => device.id === state.selectedDeviceId)?.name}</span> : null}
        <span className={`midi-activity ${state.activity > 0 ? "is-active" : ""}`} key={state.activity} aria-hidden="true" />
      </div>
      {state.error && status !== "permission-denied" && status !== "unsupported" && <p className="midi-error" role="status"><AlertTriangle size={13} />{state.error}</p>}
    </div>

    {showConnect && <div className="midi-actions">
      <button type="button" className="midi-connect" disabled={isConnecting} aria-busy={isConnecting} onClick={connect}>
        {isConnecting ? <span className="midi-spinner" aria-hidden="true" /> : <KeyboardMusic size={14} />}
        {isConnecting ? "Connecting…" : "Connect MIDI keyboard"}
      </button>
    </div>}

    {connected && <div className="midi-actions">
      <label className="midi-select">Device
        <select value={state.selectedDeviceId ?? ""} onChange={(event) => selectDevice(event.target.value)} aria-label="MIDI input device">
          {state.devices.map((device) => <option key={device.id} value={device.id}>{device.manufacturer ? `${device.manufacturer} — ` : ""}{device.name}</option>)}
        </select>
      </label>
      <button type="button" className="midi-icon-button" onClick={refresh} aria-label="Refresh MIDI devices"><RefreshCw size={14} /></button>
      <button type="button" className="midi-release" onClick={() => releaseAll()}><Square size={12} /> Release all notes</button>
      <button type="button" className="midi-disconnect" onClick={disconnect}>Disconnect</button>
    </div>}

    {connected && <div className="midi-controls">
      <span className={`midi-pedal ${state.sustainActive ? "is-active" : ""}`} aria-hidden="true">Sustain pedal {state.sustainActive ? "on" : "off"}</span>
    </div>}

    {connected && <div className="midi-held" aria-live="polite">
      <span className="midi-held-label">Held notes</span>
      {state.heldNotes.length === 0 ? <span className="midi-held-empty">No notes held</span> : <ul className="midi-held-list">{state.heldNotes.map((note) => <li key={`${note.channel}:${note.noteNumber}`}><strong>{note.noteName}</strong><span>ch {note.channel + 1} · vel {Math.round(note.velocity * 127)}</span>{note.sustained && <em>sustained</em>}</li>)}</ul>}
    </div>}

    {status === "unsupported" && <p className="midi-explain" role="status">Web MIDI is not supported by this browser. Use a current desktop browser such as Chrome or Edge for MIDI keyboard input.</p>}
    {status === "permission-denied" && <p className="midi-explain" role="alert"><AlertTriangle size={14} />MIDI access was denied. Allow MIDI for this site in your browser permissions (usually behind the padlock icon) and click Connect again.</p>}
    {status === "device-disconnected" && !state.error && <p className="midi-explain" role="status">Connect a MIDI keyboard to your computer, then click Refresh.</p>}

    <p className="midi-local-note"><Volume2 size={12} /> All MIDI processing happens locally in this page. No note data is stored or sent to SwarAI servers.</p>
  </section>;
}
