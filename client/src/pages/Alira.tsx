import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  ChevronsRight,
  LoaderCircle,
  MessageCircle,
  Mic,
  Send,
  Shield,
  Sparkles,
  Square,
  Target,
  Volume2,
} from "lucide-react";
import { useLocation, useSearch } from "wouter";
import RecoveryShell from "@/components/RecoveryShell";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createAliraSpeech, silentSpeech } from "@/lib/alira-speech";
import {
  FROM_HOME_KEY,
  answerLabel,
  applicableQuestions,
  concernStarter,
  exclusiveAnswers,
  fillRandomAnswers,
  loadOnboardingAnswers,
  onboardingAcks,
  onboardingCopy as copy,
  onboardingQuestions,
  saveOnboardingAnswers,
  starterSets,
  type OnboardingAnswers,
  type OnboardingAnswerValue,
  type OnboardingOption,
  type OnboardingQuestion,
  type Starter,
} from "@/lib/alira-onboarding";
import { loadAliraVisit, rememberAliraVisit } from "@/lib/alira-visit";
import "./alira-onboarding.css";

type Char = { ch: string; d: number };
type Message = { id: number; from: "Alira" | "you"; text: string; chars?: Char[] };
type Chips = "none" | "intro" | "intro2";
type Dictation = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type Conversation = {
  msgs: Message[];
  typing: boolean;
  typingId: number | null;
  chips: Chips;
  started: boolean;
  done: boolean;
  qi: number;
  showQ: boolean;
  showDone: boolean;
  showSteps: boolean;
  answers: OnboardingAnswers;
  sel: string[];
  otherOpen: boolean;
  otherText: string;
  draft: string;
  phIndex: number;
  starterSet: number;
  starterTick: number;
  reveal: number;
};

function initialConversation(answers: OnboardingAnswers, showImmediately = false, continueQuestions = false): Conversation {
  const initial: Conversation = {
    msgs: [], typing: false, typingId: null, chips: "none", started: false, done: false, qi: -1,
    showQ: false, showDone: false, showSteps: false, answers, sel: [], otherOpen: false, otherText: "",
    draft: "", phIndex: 0, starterSet: 0, starterTick: 0, reveal: 0,
  };
  if (!showImmediately) return initial;
  const qi = applicableQuestions(answers).find(i => answers[onboardingQuestions[i].k] === undefined) ?? -1;
  const done = continueQuestions && qi < 0;
  const texts = continueQuestions
    ? done ? [copy.done] : [copy.start, onboardingQuestions[qi].t]
    : [copy.intro1, copy.intro2];
  return {
    ...initial, reveal: 4, started: continueQuestions, done, showDone: done,
    qi: continueQuestions ? qi : -1, showQ: continueQuestions && !done,
    chips: continueQuestions ? "none" : "intro",
    msgs: texts.map((text, i) => ({ id: i + 1, from: "Alira", text })),
  };
}

// Lay a message out one character at a time: each character carries the moment it appears,
// with a small breath after commas and a longer one after full stops and question marks.
function charsOf(text: string): { chars: Char[]; total: number } {
  const chars: Char[] = [];
  let t = 0;
  for (const ch of text) {
    chars.push({ ch, d: t });
    t += ch === "." || ch === "?" || ch === "!" ? 300 : ch === "," ? 150 : 24;
  }
  return { chars, total: t };
}

// True when the patient arrived by pressing "Yes, let's get to know each other" on the home page.
function cameFromHome(search: string): boolean {
  let hit = new URLSearchParams(search).get("from") === "home";
  try {
    if (sessionStorage.getItem(FROM_HOME_KEY)) {
      hit = true;
      sessionStorage.removeItem(FROM_HOME_KEY);
    }
  } catch {
    /* Session storage can be blocked; the greeting simply plays in full. */
  }
  return hit;
}

function CompanionMark({ size = 32 }: { size?: number }) {
  return (
    <span className="ao-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.44} height={size * 0.44} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12h4l2-5 4 10 2-5h6" />
      </svg>
    </span>
  );
}

function Arrow() {
  return <ArrowRight size={16} aria-hidden="true" />;
}

function AdminChip({ small = false, onClick }: { small?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`ao-admin ${small ? "is-small" : ""}`}
      onClick={onClick}
      title="Test only: fills the remaining questions at random and jumps to the movement check"
    >
      <ChevronsRight size={small ? 13 : 15} aria-hidden="true" /> Administrative control
    </button>
  );
}

export default function Alira() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const onboarding = new URLSearchParams(search).get("onboarding") === "1";
  const [visit] = useState(loadAliraVisit);
  const [animateEntrance, setAnimateEntrance] = useState(() => visit === null);
  const [s, setS] = useState<Conversation>(() => {
    const answers = loadOnboardingAnswers();
    const continueQuestions = new URLSearchParams(search).get("from") === "home"
      || visit?.started === true || Object.keys(answers).length > 0;
    return initialConversation(answers, !animateEntrance, continueQuestions);
  });
  const sRef = useRef(s);
  sRef.current = s;
  const [speechState, setSpeechState] = useState(silentSpeech);
  const [isListening, setIsListening] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState("");
  const [dialog, setDialog] = useState<"safety" | null>(null);
  const speech = useRef<ReturnType<typeof createAliraSpeech> | null>(null);
  const voiceConfigured = useRef<boolean | null>(null);
  const browserUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const recognition = useRef<Dictation | null>(null);
  const timers = useRef<number[]>([]);
  const typeTimer = useRef<number | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLInputElement>(null);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const fromHome = useRef(false);
  const nextId = useRef(s.msgs.length + 1);

  const patch = (p: Partial<Conversation>) => setS(current => ({ ...current, ...p }));
  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timers.current.forEach(t => clearTimeout(t));
    timers.current = [];
    if (typeTimer.current !== null) clearTimeout(typeTimer.current);
    typeTimer.current = null;
  };

  // ---- conversation -------------------------------------------------------------------------

  function say(text: string, extra: Partial<Conversation> = {}, onDone?: () => void) {
    const id = nextId.current++;
    const laid = charsOf(text);
    setS(current => ({ ...current, ...extra, msgs: [...current.msgs, { id, from: "Alira", text, chars: laid.chars }], typingId: id }));
    if (typeTimer.current !== null) clearTimeout(typeTimer.current);
    typeTimer.current = window.setTimeout(() => {
      typeTimer.current = null;
      setS(current => (current.typingId === id ? { ...current, typingId: null } : current));
      onDone?.();
    }, laid.total + 150);
  }

  function userSays(text: string) {
    const id = nextId.current++;
    setS(current => ({
      ...current, msgs: [...current.msgs, { id, from: "you", text }],
      chips: "none", typing: false, showSteps: false, showQ: false, showDone: false, draft: "",
    }));
  }

  function reply(userText: string, aliraText: string, extra: Partial<Conversation> = {}, delay = 1400, onDone?: () => void) {
    userSays(userText);
    later(350, () => patch({ typing: true }));
    later(delay, () => say(aliraText, { typing: false, ...extra }, onDone));
  }

  function firstUnanswered(answers: OnboardingAnswers): number {
    const list = applicableQuestions(answers);
    const pending = list.find(i => answers[onboardingQuestions[i].k] === undefined);
    return pending ?? -1;
  }

  function ask(i: number) {
    const q = onboardingQuestions[i];
    const prev = sRef.current.answers[q.k];
    const sel = q.type === "multi" ? (Array.isArray(prev) ? prev.slice() : []) : typeof prev === "string" ? [prev] : [];
    patch({ qi: i, showQ: false, chips: "none", showDone: false, otherOpen: false, otherText: "", sel });
    later(300, () => patch({ typing: true }));
    later(1100, () => say(q.t, { typing: false }, () => patch({ showQ: true })));
  }

  function beginQuestions() {
    const answers = sRef.current.answers;
    const i = firstUnanswered(answers);
    if (i >= 0) ask(i);
    else finish();
  }

  function next(i: number, answers: OnboardingAnswers) {
    const following = applicableQuestions(answers).filter(j => j > i);
    if (following.length) ask(following[0]);
    else finish();
  }

  function finish() {
    later(300, () => patch({ typing: true }));
    later(1300, () => say(copy.done, { typing: false, done: true, qi: -1 }, () => patch({ showDone: true })));
  }

  // Store an answer, echo it in the chat, then move on (with Alira's aside where there is one).
  function record(q: OnboardingQuestion, value: OnboardingAnswerValue, otherText: string, shown: string) {
    const answers: OnboardingAnswers = { ...sRef.current.answers, [q.k]: value };
    if (q.otherKey) answers[q.otherKey] = otherText || undefined;
    saveOnboardingAnswers(answers);
    const i = sRef.current.qi;
    setS(current => ({ ...current, answers, otherOpen: false, otherText: "", sel: [] }));
    userSays(shown);
    const ack = onboardingAcks[q.k];
    if (ack) {
      later(350, () => patch({ typing: true }));
      later(1200, () => say(ack, { typing: false }, () => later(500, () => next(i, answers))));
    } else {
      later(250, () => next(i, answers));
    }
  }

  const currentQ = (): OnboardingQuestion | null => (s.qi >= 0 ? onboardingQuestions[s.qi] : null);

  function pickSingle(q: OnboardingQuestion, opt: OnboardingOption) {
    if (q.other && opt.v === q.other) {
      patch({ otherOpen: true, sel: [opt.v] });
      return;
    }
    patch({ sel: [opt.v] });
    record(q, opt.v, "", opt.l);
  }

  // Multi choice: "none" / "not sure" clear everything else; a typed "other" opens a text field.
  function toggleMulti(q: OnboardingQuestion, opt: OnboardingOption) {
    const sel = sRef.current.sel.slice();
    const active = sel.includes(opt.v);
    if (q.other && opt.v === q.other) {
      if (active) patch({ sel: sel.filter(v => v !== opt.v), otherText: "", otherOpen: false });
      else patch({ otherOpen: true });
      return;
    }
    if (exclusiveAnswers.includes(opt.v)) {
      patch({ sel: active ? [] : [opt.v], otherText: "", otherOpen: false });
    } else {
      patch({ sel: active ? sel.filter(v => v !== opt.v) : sel.filter(v => !exclusiveAnswers.includes(v)).concat(opt.v) });
    }
  }

  function submitMulti(q: OnboardingQuestion) {
    const sel = sRef.current.sel;
    if (!sel.length) {
      if (q.optional) record(q, [], "", "Skip this one for now");
      return;
    }
    record(q, sel, sRef.current.otherText, answerLabel(q, sel, sRef.current.otherText));
  }

  function submitOther(q: OnboardingQuestion) {
    const text = sRef.current.otherText.trim();
    if (!text) return;
    if (q.type === "multi") {
      const sel = sRef.current.sel.filter(v => !exclusiveAnswers.includes(v));
      if (q.other && !sel.includes(q.other)) sel.push(q.other);
      patch({ sel, otherOpen: false, otherText: text });
    } else if (q.other) {
      record(q, q.other, text, text);
    }
  }

  function back() {
    const before = applicableQuestions(sRef.current.answers).filter(j => j < sRef.current.qi);
    if (before.length) ask(before[before.length - 1]);
  }

  // Test control: answers every remaining question at random, saves them, and jumps to the movement-check card.
  function adminSkip() {
    const answers = fillRandomAnswers(sRef.current.answers);
    saveOnboardingAnswers(answers);
    const picked = onboardingQuestions.map(q => answerLabel(q, answers[q.k], String(answers[q.otherKey ?? ""] ?? "")) || String(answers[q.k]));
    userSays("Administrative control");
    patch({ answers, started: true, done: false, qi: -1, showQ: false, otherOpen: false, otherText: "", sel: [] });
    later(350, () => patch({ typing: true }));
    later(1300, () =>
      say(
        `${copy.adminPrefix} ${onboardingQuestions.length} questions at random and saved them (${picked.join(" · ")}). Jumping straight to the movement check.`,
        { typing: false, done: true },
        () => patch({ showDone: true })
      )
    );
  }

  function start() {
    reply("Let's start", copy.start, { started: true }, 1300, () => later(400, beginQuestions));
  }

  function askStarter(st: Starter) {
    const wasQ = sRef.current.showQ;
    reply(st.q, st.a, {}, 1500, () => {
      const current = sRef.current;
      if (wasQ && !current.done) patch({ showQ: true });
      else if (!current.started) patch({ chips: "intro2" });
      else if (current.done) patch({ showDone: true });
    });
  }

  function send(event: FormEvent) {
    event.preventDefault();
    const text = s.draft.trim();
    if (!text || s.showQ) return;
    recognition.current?.stop();
    stopReading();
    if (s.started) {
      reply(text, copy.noted, {}, 1300, () => {
        if (sRef.current.done) patch({ showDone: true });
      });
    } else {
      reply(text, copy.keepInMind, {}, 1500, () => patch({ chips: "intro2" }));
    }
    setVoiceNotice("");
    composer.current?.focus();
  }

  // The page settles in layers: Alira herself, the cards around the edge, and the conversation last,
  // so that when her first words type out there is nothing else still moving.
  function begin(fromHomePage: boolean) {
    later(500, () => patch({ reveal: 1 }));
    later(1100, () => patch({ reveal: 2 }));
    later(1700, () => patch({ reveal: 3 }));
    later(2400, () => patch({ reveal: 4 }));
    later(3100, () => patch({ typing: true }));
    if (fromHomePage) {
      // They already said yes on the home page, so Alira picks up from there and begins the questions.
      later(3900, () => say(copy.start, { typing: false, started: true }, () => later(500, beginQuestions)));
    } else {
      later(3900, () =>
        say(copy.intro1, { typing: false }, () => {
          later(500, () => patch({ typing: true }));
          later(1600, () => say(copy.intro2, { typing: false }, () => patch({ chips: "intro" })));
        })
      );
    }
  }

  function restart() {
    clearTimers();
    stopReading();
    setAnimateEntrance(true);
    setS(initialConversation(loadOnboardingAnswers()));
    begin(fromHome.current);
  }

  // ---- speech ---------------------------------------------------------------------------------

  useEffect(() => {
    speech.current = createAliraSpeech(setSpeechState);
    const controller = new AbortController();
    void fetch("/api/alira/voice/status", { signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(status => {
        voiceConfigured.current = status?.configured === true;
      })
      .catch(() => {
        voiceConfigured.current = false;
      });
    fromHome.current = cameFromHome(search);
    if (animateEntrance) begin(fromHome.current);
    const placeholderTimer = window.setInterval(() => {
      setS(current =>
        current.started || current.draft ? current : { ...current, phIndex: (current.phIndex + 1) % copy.placeholders.length }
      );
    }, 4200);
    const starterTimer = window.setInterval(() => {
      setS(current => ({ ...current, starterSet: (current.starterSet + 1) % starterSets.length, starterTick: current.starterTick + 1 }));
    }, 9000);
    return () => {
      controller.abort();
      clearTimers();
      clearInterval(placeholderTimer);
      clearInterval(starterTimer);
      speech.current?.stop(false);
      if (browserUtterance.current) {
        browserUtterance.current.onstart = browserUtterance.current.onend = browserUtterance.current.onerror = null;
        window.speechSynthesis?.cancel();
      }
      if (recognition.current) {
        recognition.current.onresult = recognition.current.onerror = recognition.current.onend = null;
        recognition.current.abort();
      }
    };
    // Automatic entrance motion plays only on the first visit; manual replay stays available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rememberAliraVisit(s.started);
  }, [s.started]);

  useEffect(() => {
    thread.current?.scrollTo({
      top: thread.current.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }, [s.msgs, s.typing, s.typingId, s.chips, s.showQ, s.showDone, s.showSteps]);

  function stopReading() {
    speech.current?.stop();
    if (browserUtterance.current) {
      browserUtterance.current.onstart = browserUtterance.current.onend = browserUtterance.current.onerror = null;
      window.speechSynthesis?.cancel();
      browserUtterance.current = null;
    }
    setSpeechState(silentSpeech);
  }

  function readMessage(id: string, text: string) {
    const wasActive = speechState.activeId === id;
    stopReading();
    if (wasActive) return;
    recognition.current?.abort();
    setIsListening(false);
    if (voiceConfigured.current !== false || !("speechSynthesis" in window)) {
      void speech.current?.play(id, text);
      return;
    }
    // Read only fixed Alira copy. Personal replies never enter either speech provider.
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB";
    utterance.rate = 0.94;
    utterance.voice = window.speechSynthesis.getVoices().find(voice => voice.lang === "en-GB") ?? null;
    browserUtterance.current = utterance;
    setSpeechState({ activeId: id, speaking: false, loading: true, error: "" });
    utterance.onstart = () => setSpeechState({ activeId: id, speaking: true, loading: false, error: "" });
    utterance.onend = () => {
      browserUtterance.current = null;
      setSpeechState(silentSpeech);
    };
    utterance.onerror = () => {
      browserUtterance.current = null;
      setSpeechState({ ...silentSpeech, error: "Audio could not play. You can still read every message here." });
    };
    window.speechSynthesis.speak(utterance);
  }

  function dictate() {
    if (isListening) {
      recognition.current?.stop();
      return;
    }
    const speechWindow = window as unknown as { SpeechRecognition?: new () => Dictation; webkitSpeechRecognition?: new () => Dictation };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceNotice("Voice typing isn’t supported in this browser. You can type your message below.");
      composer.current?.focus();
      return;
    }
    stopReading();
    const session = new Recognition();
    recognition.current = session;
    session.lang = "en-GB";
    session.continuous = false;
    session.interimResults = false;
    session.onresult = event => {
      const transcript = Array.from(event.results).map(result => result[0].transcript).join(" ").trim();
      setS(current => ({ ...current, draft: [current.draft.trim(), transcript].filter(Boolean).join(" ") }));
      setVoiceNotice("Your words are in the message box. Check them before sending.");
      composer.current?.focus();
    };
    session.onerror = event =>
      setVoiceNotice(
        event.error === "not-allowed"
          ? "Microphone access was not allowed. You can still type your message."
          : "Voice typing could not hear you. Try again, or type your message."
      );
    session.onend = () => {
      setIsListening(false);
      recognition.current = null;
    };
    try {
      session.start();
      setIsListening(true);
      setVoiceNotice("");
    } catch {
      recognition.current = null;
      setVoiceNotice("Voice typing could not start. You can type your message below.");
    }
  }

  function openSafety() {
    stopReading();
    dialogTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialog("safety");
  }

  function startMovementCheck() {
    stopReading();
    recognition.current?.abort();
    navigate(onboarding ? "/assessment?onboarding=1" : "/assessment");
  }

  // ---- derived ---------------------------------------------------------------------------------

  const cur = currentQ();
  const list = applicableQuestions(s.answers);
  const pos = cur ? list.indexOf(s.qi) : -1;
  const progressPct = s.done ? 100 : Math.round(((pos >= 0 ? pos : 0) / list.length) * 100);
  const isMulti = cur?.type === "multi";
  const starters = [...starterSets[s.starterSet % starterSets.length], concernStarter];
  const placeholder = s.showQ ? "Answer in the card above" : s.started ? copy.placeholders[0] : copy.placeholders[s.phIndex];
  const avatarBusy = s.typing || s.typingId !== null;
  const homePath = onboarding ? "/welcome" : "/";

  return (
    <RecoveryShell active="Alira" dateLabel="" className="ao-shell">
      <div className="ao-page" data-entrance-motion={animateEntrance ? "staged" : "static"}>
        <header className="ao-header">
          <div className="ao-identity">
            <button type="button" className={`ao-avatar ${avatarBusy ? "is-busy" : ""}`} onClick={restart} aria-label="Replay Alira's welcome" title="Replay Alira's welcome">
              <span className="ao-orbit" aria-hidden="true" />
              <span className="ao-core" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path className="ao-ecg" d="M3 12h4l2-5 4 10 2-5h6" />
                </svg>
              </span>
              <span className="ao-presence" aria-hidden="true" />
            </button>
            <div className="ao-title">
              <h1>Alira</h1>
              <span className="ao-subtitle">Your recovery companion · here now</span>
              <button type="button" className="ao-home" onClick={() => navigate(homePath)}>
                <ArrowLeft size={13} aria-hidden="true" /> Back to home
              </button>
            </div>
          </div>

        </header>

        <div className="ao-layout">
          <section className={`ao-chat ao-reveal ${s.reveal >= 4 ? "in" : ""}`} aria-label="Conversation with Alira">
            <div className="ao-thread" ref={thread}>
              <div className="ao-date"><span>Today</span></div>
              <div className="ao-messages" role="log" aria-live="polite" aria-relevant="additions" aria-label="Messages with Alira">
                {s.msgs.map(message =>
                  message.from === "Alira" ? (
                    <div key={message.id} className="ao-message ao-rise">
                      <CompanionMark />
                      <p>
                        <span className="sr-only">Alira: {message.text}</span>
                        {message.id === s.typingId && message.chars ? (
                          <span aria-hidden="true">
                            {message.chars.map((c, i) => (
                              <span key={i} className="ao-ch" style={{ animationDelay: `${c.d}ms` }}>{c.ch}</span>
                            ))}
                          </span>
                        ) : (
                          <span aria-hidden="true">{message.text}</span>
                        )}
                      </p>
                      <button
                        type="button"
                        className={`ao-listen ${speechState.activeId === `message-${message.id}` ? "is-speaking" : ""}`}
                        aria-label={speechState.activeId === `message-${message.id}` ? "Stop reading message" : "Read Alira’s message aloud"}
                        onClick={() => readMessage(`message-${message.id}`, message.text)}
                      >
                        {speechState.activeId === `message-${message.id}` ? (
                          speechState.loading ? <LoaderCircle size={13} className="ao-spinner" /> : <Square size={12} />
                        ) : (
                          <Volume2 size={14} />
                        )}
                      </button>
                    </div>
                  ) : (
                    <div key={message.id} className="ao-message is-yours ao-rise">
                      <p><span className="sr-only">You: </span>{message.text}</p>
                    </div>
                  )
                )}
              </div>

              {s.typing && (
                <div className="ao-typing ao-rise" role="status">
                  <CompanionMark />
                  <span className="ao-dots" aria-hidden="true"><i /><i /><i /></span>
                  <span>Alira is typing</span>
                </div>
              )}

              {s.showSteps && (
                <div className="ao-steps">
                  <div className="ao-step ao-rise"><span className="ao-step-icon"><MessageCircle size={15} /></span><b>1 · About you</b><span>A chat like this one · 3 min</span></div>
                  <div className="ao-step ao-rise d1"><span className="ao-step-icon"><Camera size={15} /></span><b>2 · How you move</b><span>Gentle movements, camera on · 10 min</span></div>
                  <div className="ao-step ao-rise d2"><span className="ao-step-icon"><Target size={15} /></span><b>3 · Your goals</b><span>In your own words · 2 min</span></div>
                </div>
              )}

              {s.chips === "intro" && (
                <div className="ao-choices-wrap">
                  <div className="ao-choices">
                    <button type="button" className="ao-chip is-primary ao-pulse" onClick={start}>Let's start <Arrow /></button>
                    <button type="button" className="ao-chip ao-rise d1" onClick={() => reply("How does it work?", copy.how, {}, 1600, () => patch({ showSteps: true, chips: "intro2" }))}>How does it work?</button>
                    <button type="button" className="ao-chip ao-rise d2" onClick={() => reply("Not right now", copy.notNow, {}, 1300)}>Not right now</button>
                    <AdminChip onClick={adminSkip} />
                  </div>
                  <p className="ao-hint ao-rise d3"><Sparkles size={14} aria-hidden="true" /> Finish today and I'll show you your first movement straight away.</p>
                </div>
              )}

              {s.chips === "intro2" && (
                <div className="ao-choices">
                  <button type="button" className="ao-chip is-primary ao-pulse" onClick={start}>Let's start <Arrow /></button>
                  <button type="button" className="ao-chip ao-rise d1" onClick={() => reply("Not right now", copy.notNow, {}, 1300)}>Not right now</button>
                  <AdminChip onClick={adminSkip} />
                </div>
              )}

              {s.showQ && cur && (
                <div className="ao-card-wrap ao-pop">
                  <div className="ao-question">
                    <div className="ao-status-row"><span className="ao-eyebrow is-green">{cur.s}</span><span className="ao-muted">Question {pos + 1} of {list.length}</span></div>
                    <div className="ao-track is-thin"><div className="ao-bar" style={{ width: `${progressPct}%` }} /></div>
                    <div className="ao-options" role={isMulti ? "group" : "radiogroup"} aria-label={cur.t}>
                      {cur.o.map(opt => {
                        const selected = s.sel.includes(opt.v);
                        return (
                          <button
                            key={opt.v}
                            type="button"
                            className={`ao-opt ao-rise ${selected ? "is-selected" : ""}`}
                            role={isMulti ? "checkbox" : "radio"}
                            aria-checked={selected}
                            onClick={() => (isMulti ? toggleMulti(cur, opt) : pickSingle(cur, opt))}
                          >
                            <span className="ao-radio" aria-hidden="true" />{opt.l}
                          </button>
                        );
                      })}
                    </div>
                    {s.otherOpen && (
                      <form
                        className="ao-other ao-rise"
                        onSubmit={event => {
                          event.preventDefault();
                          submitOther(cur);
                        }}
                      >
                        <label htmlFor="ao-other" className="sr-only">Your answer</label>
                        <input id="ao-other" type="text" value={s.otherText} onChange={event => patch({ otherText: event.target.value })} placeholder="Tell me in your own words" maxLength={300} autoFocus />
                        <button type="submit" className="ao-cta is-compact" disabled={!s.otherText.trim()}>Done <Arrow /></button>
                      </form>
                    )}
                    {isMulti && (
                      <div className="ao-multi-row">
                        <button type="button" className="ao-cta is-compact" disabled={!s.sel.length && !cur.optional} onClick={() => submitMulti(cur)}>Continue <Arrow /></button>
                        <span className="ao-muted">{cur.optional ? "Choose any that apply, or skip" : "Choose all that apply"}</span>
                      </div>
                    )}
                    <div className="ao-question-foot">
                      {pos > 0 && <button type="button" className="ao-link" onClick={back}>Back</button>}
                      <span className="ao-grow" />
                      {cur.optional && <button type="button" className="ao-link" onClick={() => record(cur, [], "", "Skip this one for now")}>Skip this one</button>}
                      <AdminChip small onClick={adminSkip} />
                    </div>
                  </div>
                </div>
              )}

              {s.showDone && (
                <div className="ao-card-wrap ao-pop">
                  <div className="ao-done">
                    <div className="ao-done-top">
                      <span className="ao-done-art" aria-hidden="true">
                        <svg viewBox="0 0 80 80" width="80" height="80" fill="none" stroke="#1e4a3d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="40" cy="40" r="37" fill="#e4eee2" stroke="none" />
                          <rect x="20" y="30" width="40" height="28" rx="5" />
                          <circle cx="40" cy="44" r="7" />
                          <path d="M31 30l3-5h12l3 5" />
                        </svg>
                      </span>
                      <div>
                        <span className="ao-done-title">Your movement check</span>
                        <p>A few gentle movements in front of your camera, so Alira can see how you move today. Sit or stand wherever feels safe, with a little room around you.</p>
                      </div>
                    </div>
                    <div className="ao-done-actions">
                      <button type="button" className="ao-cta is-compact ao-pulse" onClick={startMovementCheck}>Start now <Arrow /></button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="ao-composer-area">
              {(speechState.error || voiceNotice || isListening) && (
                <p className="ao-notice" role="status">
                  {isListening ? "Listening… speak your message, then press stop." : voiceNotice || speechState.error}
                </p>
              )}
              <form className="ao-composer" onSubmit={send}>
                <CompanionMark size={34} />
                <label htmlFor="ao-message" className="sr-only">Message Alira</label>
                <input
                  id="ao-message"
                  ref={composer}
                  value={s.draft}
                  onChange={event => patch({ draft: event.target.value })}
                  placeholder={placeholder}
                  disabled={s.showQ}
                  maxLength={2000}
                  autoComplete="off"
                />
                <button type="button" className={`ao-mic ${isListening ? "is-listening" : ""}`} aria-label={isListening ? "Stop voice typing" : "Type a message with your voice"} aria-pressed={isListening} onClick={dictate} disabled={s.showQ}>
                  {isListening ? <Square size={16} /> : <Mic size={17} />}
                </button>
                <button type="submit" className="ao-send" aria-label="Send message" disabled={!s.draft.trim() || s.showQ}>
                  <ArrowUp size={18} />
                </button>
              </form>
            </div>
          </section>

          <aside className="ao-side">
            <section className={`ao-panel ao-reveal ${s.reveal >= 1 ? "in" : ""}`} aria-labelledby="ao-starters-title">
              <h2 id="ao-starters-title">Not sure where to begin?</h2>
              <div className="ao-starters" key={s.starterTick}>
                {starters.map(st => (
                  <button key={st.q} type="button" className="ao-starter ao-rise" onClick={() => askStarter(st)}>
                    <span>{st.q}</span>
                    <Send size={18} strokeWidth={1.6} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
            <section className={`ao-panel ao-safety ao-reveal ${s.reveal >= 2 ? "in" : ""}`} aria-labelledby="ao-safety-title">
              <div className="ao-safety-head">
                <span className="ao-safety-icon"><Shield size={16} strokeWidth={1.7} aria-hidden="true" /></span>
                <h2 className="ao-eyebrow" id="ao-safety-title">Good to know</h2>
              </div>
              <p>Alira is a recovery companion, not a doctor. If anything feels sudden or wrong, get help first, then tell Alira.</p>
              <button type="button" className="ao-textlink" onClick={openSafety}>See the warning signs <Arrow /></button>
            </section>
          </aside>
        </div>
      </div>

      <Dialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}>
        <DialogContent
          className="ao-dialog"
          onCloseAutoFocus={event => {
            event.preventDefault();
            dialogTrigger.current?.focus();
          }}
        >
          <DialogTitle>Know the signs. Act fast.</DialogTitle>
          <DialogDescription>If someone may be having a stroke, call your local emergency number right away. Do not wait for symptoms to pass.</DialogDescription>
          <div className="ao-warning-list">
            <p><b>Face:</b> Is one side drooping?</p>
            <p><b>Arms:</b> Is one arm weak or numb?</p>
            <p><b>Speech:</b> Is speech slurred or hard to understand?</p>
            <p><b>Time:</b> Call emergency services immediately.</p>
          </div>
          <DialogClose asChild>
            <button type="button" className="ao-cta">I understand</button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </RecoveryShell>
  );
}
