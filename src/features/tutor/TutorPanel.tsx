"use client";

import { AlertCircle, CheckCircle2, CircleHelp, LoaderCircle, MessageCircle, RefreshCw, Send, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  buildTutorAdviceRequest,
  getTutorProviderStatus,
  requestTutorAdvice,
  TutorApiError,
  type TutorAdviceResponse,
  type TutorPracticeSnapshot,
  type TutorProviderStatus,
} from "@/lib/tutor-api";
import type { LessonExercise } from "@/types/lesson";

type TutorPanelProps = {
  lesson: LessonExercise;
  practiceSnapshot: TutorPracticeSnapshot | null;
};

type TutorPanelState = "empty" | "loading" | "success" | "fallback" | "offline" | "timeout" | "error";

type TutorMessage = {
  id: string;
  question: string;
  response: TutorAdviceResponse;
};

const QUICK_ACTIONS = [
  { label: "Ask about my performance", question: "What should I focus on in my next practice attempt?" },
  { label: "Explain my mistakes", question: "Explain my mistakes in simple terms and tell me how to fix them." },
  { label: "Create a practice plan", question: "Create a short practice plan for my next session." },
] as const;

function providerLabel(provider: TutorAdviceResponse["provider"], usedFallback: boolean): string {
  if (provider === "mock") return "Local mock fallback";
  if (usedFallback) return `Fallback via ${provider === "groq" ? "Groq" : "Gemini"}`;
  return provider === "gemini" ? "Gemini" : "Groq";
}

function availabilityLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function stateMessage(state: TutorPanelState): string {
  if (state === "loading") return "Building grounded advice from this practice result…";
  if (state === "offline") return "The tutor is offline. Advice was not sent. Check that FastAPI is running, then try again.";
  if (state === "timeout") return "The tutor took too long to respond. Try the request again.";
  if (state === "error") return "The tutor could not respond safely. Your practice context was not displayed as advice.";
  return "";
}

function AdviceCard({ response }: { response: TutorAdviceResponse }) {
  const advice = response.advice;
  return (
    <article className="tutor-advice-card">
      <div className="tutor-advice-card-heading">
        <span className={`tutor-provider-badge ${response.used_fallback ? "is-fallback" : ""}`}>
          {response.used_fallback ? <Sparkles size={13} /> : <CheckCircle2 size={13} />}
          {providerLabel(response.provider, response.used_fallback)}
        </span>
        {response.used_fallback && <span className="tutor-fallback-note">Fallback advice</span>}
      </div>
      <div className="tutor-advice-summary">
        <span className="tutor-section-label">Summary</span>
        <p>{advice.summary}</p>
      </div>
      <div className="tutor-advice-columns">
        <div>
          <span className="tutor-section-label">Strengths</span>
          <ul>{advice.strengths.map((strength) => <li key={strength}>{strength}</li>)}</ul>
        </div>
        <div>
          <span className="tutor-section-label">Priorities</span>
          <ul>{advice.improvement_priorities.map((priority) => <li key={priority}>{priority}</li>)}</ul>
        </div>
      </div>
      <div className="tutor-feedback-grid">
        <div><span>Pitch</span><p>{advice.pitch_feedback}</p></div>
        <div><span>Timing</span><p>{advice.timing_feedback}</p></div>
        <div><span>Rhythm</span><p>{advice.rhythm_feedback}</p></div>
      </div>
      <div className="tutor-exercises">
        <span className="tutor-section-label">Try next</span>
        <ol>{advice.exercises.map((exercise) => <li key={`${exercise.title}-${exercise.instructions}`}><strong>{exercise.title}</strong><span>{exercise.instructions}</span></li>)}</ol>
      </div>
    </article>
  );
}

function ProviderAvailability({ status }: { status: TutorProviderStatus | null }) {
  const providers = status?.providers ?? { gemini: "unavailable", groq: "unavailable", mock: "available" };
  return (
    <div className="tutor-provider-status" aria-label="AI provider availability">
      <span>Provider availability</span>
      <ul>
        <li><i className={`tutor-status-dot status-${providers.gemini}`} /> Gemini: {availabilityLabel(providers.gemini)}</li>
        <li><i className={`tutor-status-dot status-${providers.groq}`} /> Groq: {availabilityLabel(providers.groq)}</li>
        <li><i className={`tutor-status-dot status-${providers.mock}`} /> Mock: {availabilityLabel(providers.mock)}</li>
      </ul>
    </div>
  );
}

export function TutorPanel({ lesson, practiceSnapshot }: TutorPanelProps) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [state, setState] = useState<TutorPanelState>("empty");
  const [error, setError] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<TutorProviderStatus | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const lastQuestionRef = useRef("");

  useEffect(() => {
    mountedRef.current = true;
    void getTutorProviderStatus().then((status) => {
      if (mountedRef.current) setProviderStatus(status);
    });
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
    };
  }, []);

  const submit = (rawQuestion: string) => {
    if (!practiceSnapshot || requestRef.current) return;
    const built = buildTutorAdviceRequest(lesson, practiceSnapshot, rawQuestion);
    if (built.error || !built.request) {
      setError(built.error ?? "Ask a short music-practice question.");
      setState("error");
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    lastQuestionRef.current = rawQuestion.trim();
    setError(null);
    setState("loading");
    void requestTutorAdvice(built.request, controller.signal)
      .then((response) => {
        if (!mountedRef.current) return;
        setMessages((current) => [...current, { id: `${Date.now()}-${current.length}`, question: rawQuestion.trim(), response }]);
        setQuestion("");
        setState(response.used_fallback || response.provider === "mock" ? "fallback" : "success");
      })
      .catch((requestError: unknown) => {
        if (!mountedRef.current || (requestError instanceof TutorApiError && requestError.kind === "cancelled")) return;
        setError(requestError instanceof TutorApiError ? requestError.message : "The tutor could not respond. Try again.");
        setState(requestError instanceof TutorApiError && requestError.kind === "offline" ? "offline" : requestError instanceof TutorApiError && requestError.kind === "timeout" ? "timeout" : "error");
      })
      .finally(() => {
        if (requestRef.current === controller) requestRef.current = null;
      });
  };

  const retry = () => submit(lastQuestionRef.current || question);
  const busy = state === "loading";
  const hasAdvice = messages.length > 0;

  return (
    <section className="tutor-panel" aria-labelledby="tutor-title">
      <div className="tutor-heading">
        <div>
          <p className="eyebrow">Grounded guidance / 06C</p>
          <h2 id="tutor-title">Ask your tutor.</h2>
        </div>
        <p className="tutor-intro">A private, temporary practice conversation grounded only in this lesson and your latest local score.</p>
      </div>
      <div className="tutor-safety-row">
        <span className="tutor-safe-note"><ShieldCheck size={14} /> Only lesson notes and score summaries are sent. No audio, MIDI, files, or personal data.</span>
        <ProviderAvailability status={providerStatus} />
      </div>

      {!practiceSnapshot && (
        <div className="tutor-empty" role="status">
          <span className="tutor-empty-icon"><CircleHelp size={19} /></span>
          <strong>Complete a scored practice attempt first.</strong>
          <p>Your tutor will use the latest sanitized score summary to make specific suggestions. Nothing is saved as chat history.</p>
        </div>
      )}

      {practiceSnapshot && (
        <>
          <div className="tutor-quick-actions" aria-label="Tutor quick actions">
            {QUICK_ACTIONS.map((action) => <button key={action.label} type="button" onClick={() => submit(action.question)} disabled={busy}>{action.label}</button>)}
          </div>
          <form className="tutor-question-form" onSubmit={(event) => { event.preventDefault(); submit(question); }}>
            <label htmlFor="tutor-question">Ask a short music-practice question</label>
            <div className="tutor-question-row">
              <input id="tutor-question" value={question} maxLength={300} onChange={(event) => setQuestion(event.target.value)} placeholder="What should I practise next?" disabled={busy} />
              <button type="submit" className="tutor-send-button" disabled={busy || !question.trim()} aria-label="Ask tutor"><Send size={15} /> <span>Ask</span></button>
            </div>
            <div className="tutor-question-meta"><span>Music practice only</span><output>{question.length}/300</output></div>
          </form>
        </>
      )}

      <div className="tutor-live-region" aria-live="polite">
        {busy && <p className="tutor-state tutor-state-loading"><LoaderCircle className="tutor-spin" size={16} /> {stateMessage(state)}</p>}
        {(state === "offline" || state === "timeout" || state === "error") && <div className="tutor-state tutor-state-error" role="alert"><AlertCircle size={16} /><span>{error ?? stateMessage(state)}</span><button type="button" onClick={retry} disabled={busy || !practiceSnapshot}><RefreshCw size={13} /> Retry</button></div>}
        {state === "fallback" && <p className="tutor-state tutor-state-fallback"><Sparkles size={15} /> This is deterministic local fallback advice. Provider responses were unavailable.</p>}
        {state === "success" && <p className="tutor-state tutor-state-success"><CheckCircle2 size={15} /> Advice is grounded in the supplied lesson result.</p>}
        {state === "error" && error && !practiceSnapshot && <p className="tutor-state tutor-state-error" role="alert">{error}</p>}
      </div>

      {hasAdvice && <div className="tutor-conversation" aria-label="Temporary tutor conversation">
        <div className="tutor-conversation-heading"><span><MessageCircle size={14} /> Current session</span><small>Clears when this lesson changes or the page refreshes.</small></div>
        {messages.map((message) => <div key={message.id} className="tutor-message"><div className="tutor-question-bubble"><span>You asked</span><p>{message.question}</p></div><AdviceCard response={message.response} /></div>)}
      </div>}
    </section>
  );
}
