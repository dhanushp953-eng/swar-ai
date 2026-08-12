import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PracticePanel, Summary } from "./PracticePanel";
import { WebMidiController } from "@/lib/midi/web-midi";
import { makeMidiHarness } from "@/lib/midi/midi-test-utils";
import { PRACTICE_PRESETS, scorePerformance, type PerformedNote, type ScoreNoteEvent } from "@/lib/practice/scoring";
import { MicInputController } from "@/lib/mic/mic-input";
import type { MicAnalysis, MicAnalyzerLike } from "@/lib/mic/mic-analyzer";

const EVENTS: ScoreNoteEvent[] = [{ id: "e1", midi: 60, name: "C4", start: 0, duration: 0.5 }];

function renderPanel(defaultEnabled = false): string {
  const harness = makeMidiHarness();
  const controller = new WebMidiController(harness.controllerDeps);
  return renderToString(
    <PracticePanel events={EVENTS} controller={controller} getLessonTime={() => 0} status="idle" duration={1} onRestart={() => undefined} defaultEnabled={defaultEnabled} />,
  ).replace(/<!--[\s\S]*?-->/g, "");
}

const EMPTY_ANALYSIS: MicAnalysis = { level: 0, peak: 0, frequency: null, confidence: 0, midi: null, cents: null };

class ScriptedAnalyzer implements MicAnalyzerLike {
  private analysis: MicAnalysis = { ...EMPTY_ANALYSIS };

  attach(): void {
    // no-op
  }

  detach(): void {
    // no-op
  }

  set(partial: Partial<MicAnalysis>): void {
    this.analysis = { ...EMPTY_ANALYSIS, ...partial };
  }

  analyse(): MicAnalysis {
    return { ...this.analysis };
  }
}

function makeMicHarness(getUserMedia?: () => Promise<MediaStream>) {
  const analyzer = new ScriptedAnalyzer();
  const controller = new MicInputController({
    analyzer,
    getUserMedia:
      getUserMedia ??
      (() =>
        Promise.resolve({
          getAudioTracks: () => [{ stop: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined }],
          getTracks: () => [],
        } as unknown as MediaStream)),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => undefined,
    subscribeWindowBlur: () => () => undefined,
    subscribeVisibilityChange: () => () => undefined,
    subscribeDeviceChange: () => () => undefined,
  });
  return { controller, analyzer };
}

describe("PracticePanel", () => {
  it("renders the heading, options, and the disabled hint", () => {
    const html = renderPanel();
    expect(html).toContain("Practice scoring");
    expect(html).toContain("Score my playing");
    expect(html).toContain("Strictness");
    expect(html).toContain("Standard");
    expect(html).toContain("Latency compensation");
    expect(html).toContain("Turn on scoring");
    expect(html).toContain("computed locally");
  });

  it("offers MIDI and Microphone inputs and defaults to MIDI without the mic panel", () => {
    const html = renderPanel();
    expect(html).toContain('name="practice-input"');
    expect(html).toContain("MIDI keyboard");
    expect(html).toContain("Microphone");
    expect(html).toContain('checked="" value="midi"');
    expect(html).not.toContain("Enable microphone");
  });

  it("shows the mic controls, status, and privacy note when microphone is selected", () => {
    const { controller } = makeMicHarness();
    const html = renderToString(
      <PracticePanel events={EVENTS} micController={controller} getLessonTime={() => 0} status="idle" duration={1} onRestart={() => undefined} defaultInput="microphone" />,
    ).replace(/<!--[\s\S]*?-->/g, "");
    expect(html).toContain("Enable microphone");
    expect(html).toContain("Calibrate noise");
    expect(html).toContain("Audio is analysed locally");
    expect(html).toContain("never recorded");
    expect(html).toContain("MIDI keyboards are more accurate");
    expect(html).toContain("on your microphone");
  });

  it("shows live mic readings while listening", async () => {
    const { controller, analyzer } = makeMicHarness();
    await controller.start();
    analyzer.set({ level: 0.6, peak: 0.8, frequency: 261.63, confidence: 0.97, midi: 60, cents: 5 });
    for (let i = 0; i < 6; i += 1) controller.tick();
    const html = renderToString(
      <PracticePanel events={EVENTS} micController={controller} getLessonTime={() => 0} status="idle" duration={1} onRestart={() => undefined} defaultInput="microphone" />,
    ).replace(/<!--[\s\S]*?-->/g, "");
    expect(html).toContain("Disable microphone");
    expect(html).toContain("Listening for notes");
    expect(html).toContain("C4");
    expect(html).toContain("97%");
    expect(html).toContain("+5¢");
    expect(html).toContain('aria-valuenow="60"');
  });

  it("reports a denied microphone permission", async () => {
    const { controller } = makeMicHarness(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    await controller.start();
    const html = renderToString(
      <PracticePanel events={EVENTS} micController={controller} getLessonTime={() => 0} status="idle" duration={1} onRestart={() => undefined} defaultInput="microphone" />,
    ).replace(/<!--[\s\S]*?-->/g, "");
    expect(html).toContain("Permission denied");
    expect(html).toContain("Allow the microphone");
  });

  it("shows live feedback instead of the hint when enabled by default", () => {
    const html = renderPanel(true);
    expect(html).toContain("Live feedback");
    expect(html).toContain("Play a note to begin");
    expect(html).not.toContain("Turn on scoring");
  });

  it("exposes accessible landmarks and labeled controls", () => {
    const html = renderPanel(true);
    expect(html).toContain('aria-labelledby="practice-title"');
    expect(html).toContain('aria-label="Scoring strictness"');
    expect(html).toContain('aria-label="Latency compensation"');
    expect(html).toContain('aria-live="polite"');
  });

  it("explains when an enabled run ends with no scored notes", () => {
    const harness = makeMidiHarness();
    const controller = new WebMidiController(harness.controllerDeps);
    const html = renderToString(
      <PracticePanel events={EVENTS} controller={controller} getLessonTime={() => 1} status="complete" duration={1} onRestart={() => undefined} defaultEnabled />,
    ).replace(/<!--[\s\S]*?-->/g, "");
    expect(html).toContain("No notes were scored during this attempt");
  });

  it("offers practice focus modes and the wait toggle", () => {
    const html = renderPanel();
    expect(html).toContain("Focus");
    expect(html).toContain("Full");
    expect(html).toContain("Melody");
    expect(html).toContain("Rhythm");
    expect(html).toContain("Pause at each note");
    expect(html).toContain("any pitch counts");
  });

  it("disables the wait toggle when no lesson engine is attached", () => {
    const html = renderPanel();
    expect(html).toContain('aria-label="Pause at each note"');
    expect(html).toContain('disabled=""');
  });

  it("shows a waiting banner when the lesson is paused on a note", () => {
    const html = renderToString(
      <PracticePanel events={EVENTS} controller={new WebMidiController(makeMidiHarness().controllerDeps)} getLessonTime={() => 0} status="waiting" duration={1} onRestart={() => undefined} />,
    ).replace(/<!--[\s\S]*?-->/g, "");
    expect(html).toContain("Waiting — play the next note to continue");
    expect(html).toContain("Skip to next");
  });

  it("shows the focus selector and wait toggle with an engine attached", () => {
    const engine = {
      status: "idle" as const,
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 1,
      loopIteration: 0,
      play: () => undefined,
      seek: () => undefined,
      resume: () => undefined,
      setWaitMode: () => undefined,
      setWaitTargets: () => undefined,
    };
    const html = renderToString(
      <PracticePanel events={EVENTS} engine={engine} getLessonTime={() => 0} status="idle" duration={1} onRestart={() => undefined} />,
    ).replace(/<!--[\s\S]*?-->/g, "");
    expect(html).toContain('aria-label="Pause at each note"');
    expect(html).not.toContain('aria-label="Pause at each note" disabled=""');
  });
});

describe("Summary", () => {
  const performed: PerformedNote[] = [{ id: "p1", midi: 60, name: "C4", onset: 0.02, offset: 0.5 }];
  const result = scorePerformance(EVENTS, performed, PRACTICE_PRESETS.standard, { endTime: 1 });

  it("shows the overall score, sub-scores, counts, and reasons", () => {
    const html = renderToString(<Summary result={result} onRestart={() => undefined} />).replace(/<!--[\s\S]*?-->/g, "");
    expect(html).toContain("Final attempt");
    expect(html).toContain("overall / 100");
    expect(html).toContain("Correct notes");
    expect(html).toContain("Pitch");
    expect(html).toContain("Timing");
    expect(html).toContain("Duration");
    expect(html).toContain("Practise again");
    expect(html).toContain(String(Math.round(result.scores.overall.value)));
    expect(html).toContain("Weighted");
  });
});
