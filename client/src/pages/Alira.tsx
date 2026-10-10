import { isValidElement, useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  ChevronsRight,
  LoaderCircle,
  MessageCircle,
  Mic,
  Pause,
  Play,
  Send,
  Sparkles,
  Square,
  Target,
  Volume2,
} from "lucide-react";
import { useLocation, useSearch } from "wouter";
import RecoveryShell from "@/components/RecoveryShell";
import HeartRateMark from "@/components/HeartRateMark";
import AliraTranscript from "@/components/AliraTranscript";
import { useOptionalSettings, type SettingsView } from "@/components/AccountSettings";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { aliraPhraseId, createAliraSpeech, silentSpeech } from "@/lib/alira-speech";
import {
  FROM_HOME_KEY,
  answerLabel,
  applicableQuestions,
  clearOnboardingAnswers,
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
import {
  answeredCount,
  describePageState,
  routeLocally,
  runAgentTurn,
  surveySummary,
  type LocalRoute,
  type RouteContext,
} from "@/lib/alira-agent";
import { aliraAgentCopy as agentCopy } from "@/lib/alira-agent-copy";
import { learningToday, learningVersion, recordWarmRepSkip, saveReport, subscribeLearning, warmRepNeeded } from "@/lib/alira-learning-store";
import { flushAlerts, planItems, reviewNow } from "@/lib/plan-review";
import { adjustedLevel, loadPlanReview, restingOn } from "@/lib/plan-review-store";
import { patientLine } from "@shared/plan-review";
import { FELT_OPTIONS, PAIN_OPTIONS } from "@shared/alira-adaptation";
import RecoverySeedling from "@/components/RecoverySeedling";
import { loadAliraVisit, rememberAliraVisit } from "@/lib/alira-visit";
import { companionTaskPlan, loadRememberedAssessment, rememberAssessment, rememberAssessmentPlan } from "@/lib/assessment";
import { journeyLockReason, journeyNow, journeyUnlocked } from "@/lib/journey";
import { patientExerciseReady } from "@/lib/exercise-engine/config";
import { ASSESSMENT_PLAN_READY_MESSAGE, assessmentCongratulations, EXERCISES_PATH, pauseAssessmentChat, randomAssessment, randomAssessmentEnabled, requestAssessmentPlan, runAssessmentConversation } from "@/lib/assessment-plan";
import { getDisplayPrefs, setDisplayPrefs } from "@/lib/display-prefs";
import { dayKey, daysToReassessment, loadLastExerciseDay } from "@/lib/home-stage";
import { MEDALS_PATH, allMedals, earnedLabel, earnedMedals, earnedOn, findMedal, findMedalGuide, medalGuides, withinReachNext } from "@/lib/medals";
import { MedalCoin } from "@/components/MedalCollection";
import { EXERCISE_JOURNAL_PATH, EXERCISE_MY_TIME_PATH, exerciseCompletionMessages, finishPreviewExercises, loadExerciseCompletion } from "@/lib/exercise-completion";
import { profileName, profileStore } from "@/lib/profile";
import { aliraReducedMotion, createAliraHold, presentAliraMessage, type AliraCharacter } from "@/lib/alira-message-style";
import { aliraChatContext, aliraChatStore, undeliveredArrivalMessages } from "@/lib/alira-chat-history";
import { EMPTY_TRANSCRIPT_POSITIONS, type TranscriptPositions } from "@/lib/alira-transcript";
import { AGENT_EXERCISES, type AgentBlock, type AgentMessage } from "@shared/alira-agent";
import "./alira-onboarding.css";

/** `generated` marks Alira's replies written in the moment; every Alira message can be read aloud in her voice. */
type Message = { id: number; from: "Alira" | "you"; text: string; chars?: AliraCharacter[]; generated?: boolean; localOnly?: boolean };
type Chips = "none" | "intro" | "intro2" | "medal" | "medalNext" | "resume";

/**
 * What a tool did: `result` goes back to Claude, `say` is Alira's own confirmation when she acted
 * without Claude, and `effect` changes the page once her reply has been shown. A "flow" effect moves
 * the conversation on (only the last one runs), and a "leave" effect opens another page.
 */
type ToolOutcome = {
  result: string;
  isError?: boolean;
  say?: string;
  effect?: { kind: "action" | "flow" | "leave"; run: () => void };
};
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

/** Alira's own lines, which the patient can pause, or her answers to what the patient asks, which never wait. */
type Lane = "flow" | "answer";

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
  /** The questions are set aside until the patient says to carry on. */
  paused: boolean;
  /** Alira is thinking about something the patient typed. */
  busy: boolean;
};

/** Today's warm-up is still to be offered at the end of the survey (never on the carer-led route). */
function warmUpInviteDue(answers: OnboardingAnswers): boolean {
  try {
    return warmRepNeeded("survey_end", answers);
  } catch {
    return false;
  }
}

function initialConversation(answers: OnboardingAnswers, showImmediately = false, continueQuestions = false, fromWarmUp = false): Conversation {
  const initial: Conversation = {
    msgs: [], typing: false, typingId: null, chips: "none", started: false, done: false, qi: -1,
    showQ: false, showDone: false, showSteps: false, answers, sel: [], otherOpen: false, otherText: "",
    draft: "", phIndex: 0, starterSet: 0, starterTick: 0, reveal: 0, paused: false, busy: false,
  };
  if (!showImmediately) return initial;
  const qi = applicableQuestions(answers).find(i => answers[onboardingQuestions[i].k] === undefined) ?? -1;
  const done = continueQuestions && qi < 0;
  let texts: string[];
  if (!continueQuestions) texts = [copy.intro1, copy.intro2];
  else if (!done) texts = [copy.start, onboardingQuestions[qi].t];
  else if (fromWarmUp) texts = [copy.afterWarmUp];
  else texts = [copy.done, ...(warmUpInviteDue(answers) ? [copy.warmUpInvite] : [])];
  return {
    ...initial, reveal: 4, started: continueQuestions, done, showDone: done,
    qi: continueQuestions ? qi : -1, showQ: continueQuestions && !done,
    chips: continueQuestions ? "none" : "intro",
    msgs: texts.map((text, i) => ({ id: i + 1, from: "Alira", text })),
  };
}

// Arriving from a medal's "Start with Alira": Alira opens on that medal and offers its next step.
function medalConversation(answers: OnboardingAnswers, intro: string): Conversation {
  return { ...initialConversation(answers), reveal: 4, chips: "medal", msgs: [{ id: 1, from: "Alira", text: intro }] };
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
      <HeartRateMark size={size * 0.44} />
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
  const fromWarmUp = new URLSearchParams(search).get("from") === "warm-up";
  const medalGuide = findMedalGuide(new URLSearchParams(search).get("medal"));
  const [visit] = useState(loadAliraVisit);
  // A fresh onboarding entry must not show a previous assessment's plan.
  const [assessment, setAssessment] = useState(() => new URLSearchParams(search).get("from") === "home" ? null : loadRememberedAssessment());
  const [exerciseCompletion, setExerciseCompletion] = useState(() => loadExerciseCompletion(search, assessment));
  const hasResult = !!assessment?.report && !medalGuide;
  const historyContext = aliraChatContext({ assessment, completion: exerciseCompletion, medalId: medalGuide?.medal.id, day: dayKey(journeyNow()) });
  const [restored] = useState(() => {
    const saved = aliraChatStore.read(historyContext);
    // Another open tab can save its old completed conversation after a review
    // account reset. Chat presentation must never complete an unanswered survey.
    if (historyContext === "survey" && saved?.presentation.done) {
      const answers = loadOnboardingAnswers();
      if (applicableQuestions(answers).some(i => answers[onboardingQuestions[i].k] === undefined)) return null;
    }
    // Returning from the warm-up is a new step the first time, then an ordinary return visit.
    return fromWarmUp && saved?.warmUpDay !== learningToday() ? null : saved;
  });
  const [planState, setPlanState] = useState<"idle" | "testing" | "responding" | "planning" | "ready" | "error">(() => exerciseCompletion ? "idle" : hasResult ? assessment?.planChatCompleted && Array.isArray(assessment.report?.rehab_plan) ? "ready" : restored?.planFailed ? "error" : "responding" : "idle");
  const [planError, setPlanError] = useState(restored?.planError ?? "");
  const [planWaiting, setPlanWaiting] = useState(false);
  const [planRetry, setPlanRetry] = useState(0);
  const [animateEntrance, setAnimateEntrance] = useState(() => !restored && visit === null && !medalGuide && !hasResult && !fromWarmUp);
  const [opening] = useState<Conversation>(() => {
    const answers = loadOnboardingAnswers();
    if (restored) {
      const saved = restored.presentation;
      const question = saved.qi >= 0 && applicableQuestions(answers).includes(saved.qi) ? onboardingQuestions[saved.qi] : null;
      return { ...initialConversation(answers), ...saved, reveal: 4, msgs: restored.messages,
        // Side chats temporarily hide the current question; it remains available after a return.
        showQ: !!(question && !saved.done && !saved.paused),
        showDone: saved.showDone || (saved.done && !hasResult),
        chips: saved.chips === "none" && !saved.started && !medalGuide ? "intro2" : saved.chips,
      };
    }
    if (medalGuide) return medalConversation(answers, medalGuide.intro);
    if (exerciseCompletion) return {
      ...initialConversation(answers), reveal: 4, done: true, started: true,
      msgs: exerciseCompletionMessages(exerciseCompletion, profileName(profileStore.load())).map((text, index) => ({ id: index + 1, from: "Alira", text, localOnly: true })),
    };
    if (assessment?.report) return {
      ...initialConversation(answers), reveal: 4, done: true, started: true,
      msgs: assessment.planChatCompleted ? [
        { id: 1, from: "Alira", localOnly: true, text: assessmentCongratulations(assessment.report) },
        { id: 2, from: "Alira", text: ASSESSMENT_PLAN_READY_MESSAGE },
      ] : [],
      typing: !assessment.planChatCompleted,
    };
    const continueQuestions = fromWarmUp || new URLSearchParams(search).get("from") === "home"
      || visit?.started === true || Object.keys(answers).length > 0;
    return initialConversation(answers, !animateEntrance, continueQuestions, fromWarmUp);
  });
  const [pendingReturn] = useState(() => {
    if (!restored) return [];
    const expected = exerciseCompletion ? exerciseCompletionMessages(exerciseCompletion, profileName(profileStore.load()))
      : hasResult && assessment?.planChatCompleted ? [ASSESSMENT_PLAN_READY_MESSAGE]
      : opening.showQ && opening.qi >= 0 ? [onboardingQuestions[opening.qi].t]
      : !opening.started && !medalGuide ? [copy.intro1, copy.intro2] : [];
    return undeliveredArrivalMessages(restored.messages, expected);
  });
  const [animateOpening] = useState(() => !restored && opening.msgs.length > 0 && !aliraReducedMotion());
  const [openingPending, setOpeningPending] = useState(animateOpening || pendingReturn.length > 0);
  const [s, setS] = useState<Conversation>(() => animateOpening ? {
    ...opening, msgs: [], typing: true, chips: "none", showQ: false, showDone: false, showSteps: false,
  } : pendingReturn.length ? { ...opening, typing: true, chips: "none", showQ: false, showDone: false, showSteps: false } : opening);
  const sRef = useRef(s);
  sRef.current = s;
  const [speechState, setSpeechState] = useState(silentSpeech);
  const [isListening, setIsListening] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState("");
  const [dialog, setDialog] = useState<"safety" | null>(null);
  const [warmUpSkipped, setWarmUpSkipped] = useState(fromWarmUp);
  // A warm-up done or skipped today changes which card follows the survey.
  useSyncExternalStore(subscribeLearning, learningVersion, learningVersion);
  const speech = useRef<ReturnType<typeof createAliraSpeech> | null>(null);
  const voiceConfigured = useRef<boolean | null>(null);
  const voicePacked = useRef<Set<string>>(new Set());
  const browserUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const recognition = useRef<Dictation | null>(null);
  const timers = useRef<number[]>([]);
  // Alira's own lines (her flow) and her answers to what the patient asks go in two lanes, each with the line in
  // progress and what to do once it completes. The patient can pause her flow (the hold) to ask something at once:
  // her answers never wait for it.
  const lanes = useRef<Record<Lane, { controller: AbortController | null; done: (() => void) | null }>>({
    flow: { controller: null, done: null }, answer: { controller: null, done: null },
  });
  const hold = useRef(createAliraHold());
  const [held, setHeld] = useState(false);
  const [answerTyping, setAnswerTyping] = useState(false);
  const [flowLive, setFlowLive] = useState(0);
  // What the patient asked that Alira is still thinking about: a new message joins it.
  const askedNotAnswered = useRef("");
  const thread = useRef<HTMLDivElement>(null);
  const transcriptPositions = useRef<TranscriptPositions>(restored?.positions ?? EMPTY_TRANSCRIPT_POSITIONS);
  const rememberPositions = useCallback((positions: TranscriptPositions) => { transcriptPositions.current = positions; }, []);
  const scrollTop = useRef(restored?.scrollTop ?? 0);
  const restoreScroll = useRef(restored?.scrollTop ?? null);
  const persistChat = useRef<() => void>(() => {});
  const composer = useRef<HTMLInputElement>(null);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const fromHome = useRef(false);
  const nextId = useRef(Math.max(0, ...s.msgs.map(message => message.id)) + 1);
  const randomRequest = useRef<AbortController | null>(null);
  const openSettings = useOptionalSettings();
  // Alira's thinking (Claude, through /api/alira/agent) when the server has it connected.
  const agentReady = useRef(false);
  const agentHistory = useRef<AgentMessage[]>([]);
  const agentActivity = useRef<string[]>([]);
  const agentAbort = useRef<AbortController | null>(null);

  const patch = (p: Partial<Conversation>) => setS(current => ({ ...current, ...p }));
  // Tools change the conversation straight away, so a second tool in the same reply sees the change.
  const commit = (p: Partial<Conversation>) => {
    sRef.current = { ...sRef.current, ...p };
    patch(p);
  };
  const later = (ms: number, fn: () => void) => {
    const timer = window.setTimeout(() => {
      timers.current = timers.current.filter(t => t !== timer);
      fn();
    }, ms);
    timers.current.push(timer);
  };
  const clearTimers = () => {
    timers.current.forEach(t => clearTimeout(t));
    timers.current = [];
    for (const lane of Object.values(lanes.current)) {
      lane.controller?.abort("cancelled");
      lane.controller = null;
      lane.done = null;
    }
    // A fresh start: nothing is paused.
    hold.current.open();
    setHeld(false);
    setAnswerTyping(false);
  };

  // ---- pausing Alira --------------------------------------------------------------------------

  /** Alira has lines on their way: one in progress, more to come, or the movement check's conversation. */
  function flowGoing() {
    return lanes.current.flow.controller !== null || timers.current.length > 0 || openingPending
      || planState === "responding" || planState === "planning";
  }

  /** The patient pauses Alira: the line she is typing shows in full, and nothing after it comes until Continue. */
  function pauseAlira() {
    if (hold.current.closed) return;
    hold.current.close();
    setHeld(true);
    stopReading();
    patch({ typing: false, typingId: null });
  }

  /** Continue: Alira carries on where she paused, in order. */
  function continueAlira() {
    hold.current.open();
    setHeld(false);
  }

  // ---- conversation -------------------------------------------------------------------------

  /** One line: in Alira's flow (which the patient can pause), or an answer to the patient (which never waits). */
  async function presentMessage(text: string, signal: AbortSignal, generated = false, localOnly = false, lane: Lane = "flow") {
    const id = nextId.current++;
    const flow = lane === "flow";
    if (flow) setFlowLive(count => count + 1);
    try {
      await presentAliraMessage(text, {
        onThinking: typing => (flow ? patch({ typing }) : setAnswerTyping(typing)),
        onMessage: chars => {
          if (!flow) setAnswerTyping(false);
          setS(current => ({ ...current, ...(flow ? { typing: false } : {}), typingId: chars.length ? id : null,
            msgs: [...current.msgs, { id, from: "Alira", text, chars, ...(generated ? { generated } : {}), ...(localOnly ? { localOnly } : {}) }],
          }));
        },
      }, signal, aliraReducedMotion(), flow ? hold.current : undefined);
    } finally {
      if (flow) setFlowLive(count => count - 1);
    }
    setS(current => current.typingId === id ? { ...current, typingId: null } : current);
  }

  // Every new line uses the same dots, character reveal, and completion gate.
  function say(text: string, extra: Partial<Conversation> = {}, onDone?: () => void, generated = false, localOnly = false, lane: Lane = "flow") {
    const slot = lanes.current[lane];
    // A line still typing in the same lane finishes its step first, so a question card is never lost.
    const pending = slot.controller ? slot.done : null;
    slot.controller?.abort("replaced");
    slot.done = null;
    pending?.();
    patch(extra);
    const controller = new AbortController();
    slot.controller = controller;
    slot.done = onDone ?? null;
    void presentMessage(text, controller.signal, generated, localOnly, lane).then(() => {
      if (slot.controller !== controller) return;
      slot.controller = null;
      const done = slot.done;
      slot.done = null;
      done?.();
    }).catch(() => { /* Leaving or replacing a message cancels its pending completion. */ });
  }

  /** Several lines, one after another. */
  function sayAll(texts: string[], extra: Partial<Conversation>, onDone: () => void, generated = false, localOnly = false, lane: Lane = "flow") {
    const [first, ...rest] = texts;
    if (!first) {
      patch(extra);
      onDone();
      return;
    }
    say(first, extra, () => (rest.length ? later(400, () => sayAll(rest, {}, onDone, generated, localOnly, lane)) : onDone()), generated, localOnly, lane);
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
    // Once a day Alira also invites a warm-up, and its card comes before the movement check's.
    const lines = warmUpInviteDue(sRef.current.answers) ? [copy.done, copy.warmUpInvite] : [copy.done];
    later(300, () => patch({ typing: true }));
    later(1300, () => sayAll(lines, { typing: false, done: true, qi: -1 }, () => patch({ showDone: true })));
  }

  // Store an answer, echo it in the chat, then move on (with Alira's aside where there is one).
  function record(q: OnboardingQuestion, value: OnboardingAnswerValue, otherText: string, shown: string) {
    const answers: OnboardingAnswers = { ...sRef.current.answers, [q.k]: value };
    if (q.otherKey) answers[q.otherKey] = otherText || undefined;
    saveOnboardingAnswers(answers);
    const i = sRef.current.qi;
    setS(current => ({ ...current, answers, otherOpen: false, otherText: "", sel: [] }));
    userSays(shown);
    afterAnswer(q, i, answers);
  }

  function afterAnswer(q: OnboardingQuestion, i: number, answers: OnboardingAnswers) {
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
  function adminSkip(echo = true) {
    if (completionBusy) return;
    setAssessment(null); setPlanState("idle"); setPlanError("");
    clearTimers();
    stopReading();
    const answers = fillRandomAnswers(sRef.current.answers);
    saveOnboardingAnswers(answers);
    if (echo) userSays("Administrative control");
    setS(current => ({
      ...current, answers, started: true, done: true, qi: -1, showQ: false,
      showDone: false, typing: false, typingId: null, reveal: 4, paused: false,
      otherOpen: false, otherText: "", sel: [],
    }));
    say(copy.adminDone, {}, () => patch({ showDone: true }));
  }

  function start() {
    reply("Let's start", copy.start, { started: true }, 1300, () => later(400, beginQuestions));
  }

  // A starter question can be asked at any time, as a typed one can: Alira pauses her lines and answers at once.
  function askStarter(st: Starter) {
    if (flowGoing()) pauseAlira();
    const chipsBefore = sRef.current.chips;
    stopReading();
    userSays(st.q);
    later(350, () => setAnswerTyping(true));
    later(1500, () => say(st.a, {}, () => resume(chipsBefore), false, false, "answer"));
  }

  // ---- Alira's tools --------------------------------------------------------------------------
  // Everything Alira can do in the app when asked in the chat, whether she recognised the request
  // herself or Claude chose the tool. Each tool changes what it must straight away and leaves what
  // the patient sees (the next question, a dialog, another page) until her reply has been shown.

  const flow = (run: () => void): ToolOutcome["effect"] => ({ kind: "flow", run });
  const action = (run: () => void): ToolOutcome["effect"] => ({ kind: "action", run });
  const leave = (path: string): ToolOutcome["effect"] => ({ kind: "leave", run: () => leaveFor(path) });
  const refuse = (result: string, say?: string): ToolOutcome => ({ result, isError: true, ...(say ? { say } : {}) });

  function questionLine(i: number, answers: OnboardingAnswers): string {
    const list = applicableQuestions(answers);
    return `question ${list.indexOf(i) + 1} of ${list.length}: "${onboardingQuestions[i].t}"`;
  }

  /** Checks answer values against a question and saves them. */
  function saveAnswer(q: OnboardingQuestion, input: Record<string, unknown>): { answers: OnboardingAnswers; label: string } | ToolOutcome {
    const valid = q.o.map(o => o.v);
    const values = Array.isArray(input.values) ? input.values.filter((v): v is string => typeof v === "string") : [];
    if (!values.length || values.some(v => !valid.includes(v))) return refuse(`Use the option values for ${q.k}: ${valid.join(", ")}.`);
    if (q.type === "single" && values.length !== 1) return refuse("This question takes exactly one answer.");
    const otherText = typeof input.other_text === "string" ? input.other_text.trim().slice(0, 300) : "";
    const isOther = Boolean(q.other && values.includes(q.other));
    if (isOther && !otherText) return refuse('Put the patient\'s own words in other_text when the answer is "other".');
    const value: OnboardingAnswerValue = q.type === "multi" ? values : values[0];
    const answers: OnboardingAnswers = { ...sRef.current.answers, [q.k]: value };
    if (q.otherKey) answers[q.otherKey] = isOther ? otherText : undefined;
    saveOnboardingAnswers(answers);
    return { answers, label: answerLabel(q, value, otherText) };
  }

  function runTool(name: string, input: Record<string, unknown>): ToolOutcome {
    const cur = sRef.current;
    const q = cur.qi >= 0 && !cur.done && !cur.paused ? onboardingQuestions[cur.qi] : null;
    switch (name) {
      case "restart_survey": {
        clearOnboardingAnswers();
        const first = applicableQuestions({})[0];
        commit({ answers: {}, started: true, done: false, paused: false, qi: first, showQ: false, showDone: false, showSteps: false, chips: "none", sel: [], otherOpen: false, otherText: "" });
        return { result: `Restarted. Every earlier answer was cleared. Next: ${questionLine(first, {})}`, say: agentCopy.restartSurvey, effect: flow(() => ask(first)) };
      }
      case "continue_survey": {
        const i = cur.qi >= 0 && !cur.done ? cur.qi : firstUnanswered(cur.answers);
        if (i < 0) {
          commit({ started: true, paused: false, done: true, qi: -1 });
          return { result: "All the questions are answered. The movement check card is showing.", say: agentCopy.surveyAlreadyDone, effect: flow(() => patch({ showDone: true })) };
        }
        commit({ started: true, paused: false, done: false, qi: i, showDone: false, chips: "none" });
        return { result: `Showing ${questionLine(i, cur.answers)}`, say: cur.started ? agentCopy.resumeSurvey : copy.start, effect: flow(() => ask(i)) };
      }
      case "answer_current_question": {
        if (!q) return refuse("No question is on screen. Use continue_survey to show one first.", agentCopy.noQuestion);
        const saved = saveAnswer(q, input);
        if ("result" in saved) return saved;
        const following = applicableQuestions(saved.answers).filter(j => j > cur.qi);
        // The next question is in play at once, so a second answer in the same reply lands on it.
        commit({ answers: saved.answers, qi: following[0] ?? -1, sel: [], otherOpen: false, otherText: "" });
        return {
          result: `Saved "${saved.label}". ${following.length ? `Next: ${questionLine(following[0], saved.answers)}` : "That was the last question; the movement check comes next."}`,
          say: `Got it: ${saved.label}.`,
          effect: flow(() => afterAnswer(q, cur.qi, saved.answers)),
        };
      }
      case "set_survey_answer": {
        const i = onboardingQuestions.findIndex(item => item.k === input.question_key);
        if (i < 0) return refuse("That question isn't available.");
        if (q && i === cur.qi) return runTool("answer_current_question", input);
        const saved = saveAnswer(onboardingQuestions[i], input);
        if ("result" in saved) return saved;
        commit({ answers: saved.answers });
        return { result: `Changed ${onboardingQuestions[i].k} to "${saved.label}".`, say: `Done. I've changed that answer to: ${saved.label}.` };
      }
      case "go_to_question": {
        const i = onboardingQuestions.findIndex(item => item.k === input.question_key);
        if (i < 0 || !applicableQuestions(cur.answers).includes(i)) return refuse("That question isn't available.");
        const target = onboardingQuestions[i];
        const current = answerLabel(target, cur.answers[target.k], String(cur.answers[target.otherKey ?? ""] ?? ""));
        commit({ started: true, done: false, paused: false, showDone: false, qi: i });
        return { result: `Showing ${questionLine(i, cur.answers)} Saved answer: ${current ? `"${current}"` : "none"}.`, say: agentCopy.showQuestion, effect: flow(() => ask(i)) };
      }
      case "go_back_one_question": {
        const list = applicableQuestions(cur.answers);
        const before = list.slice(0, cur.done || cur.qi < 0 ? list.length : Math.max(0, list.indexOf(cur.qi)));
        if (!cur.started || !before.length) return refuse("This is the first question.", agentCopy.firstQuestion);
        const i = before[before.length - 1];
        commit({ qi: i, done: false, paused: false, showDone: false });
        return { result: `Showing ${questionLine(i, cur.answers)}`, say: agentCopy.goBack, effect: flow(() => ask(i)) };
      }
      case "skip_current_question": {
        if (!q) return refuse("No question is on screen.", agentCopy.noQuestion);
        if (!q.optional) return refuse("This question needs an answer, so it can't be skipped. Offer the closest options; the answer can be changed later.", agentCopy.cantSkip);
        const answers: OnboardingAnswers = { ...cur.answers, [q.k]: [] };
        saveOnboardingAnswers(answers);
        commit({ answers, sel: [] });
        return { result: "Skipped.", effect: flow(() => afterAnswer(q, cur.qi, answers)) };
      }
      case "pause_survey": {
        if (!cur.started || cur.done) return refuse("The questions aren't in progress.");
        commit({ paused: true, showQ: false });
        return { result: "Paused. The answers so far are saved, and continue_survey carries on.", say: agentCopy.pauseSurvey };
      }
      case "get_survey_answers":
        return { result: surveySummary(cur.answers) };
      case "show_assessment_steps":
        return { result: "Showing the three parts of getting started.", say: copy.how, effect: action(() => patch({ showSteps: true })) };
      case "start_movement_check": {
        const remaining = applicableQuestions(cur.answers).length - answeredCount(cur.answers);
        return {
          result: remaining ? `Opening the movement check. ${remaining} questions are unanswered; they can be finished afterwards.` : "Opening the movement check.",
          say: remaining ? agentCopy.movementCheckEarly : agentCopy.movementCheck,
          effect: { kind: "leave", run: startMovementCheck },
        };
      }
      case "get_recovery_status": {
        const assessment = loadRememberedAssessment();
        return {
          result: JSON.stringify({
            first_movement_check_done: Boolean(assessment),
            done_on: assessment?.completedAt.slice(0, 10) ?? null,
            days_until_next_check: assessment ? daysToReassessment(assessment) : null,
            exercises_done_today: loadLastExerciseDay() === dayKey(new Date()),
          }),
        };
      }
      case "open_page": {
        const pages: Record<string, { path: string; say: string }> = {
          home: { path: homePath, say: agentCopy.openHome },
          progress: { path: "/journey?tab=progress", say: agentCopy.openProgress },
          journal: { path: "/journey?tab=journal", say: agentCopy.openJournal },
          medals: { path: MEDALS_PATH, say: agentCopy.openMedals },
          my_time: { path: "/my-time", say: agentCopy.openMyTime },
        };
        const key = String(input.page);
        if (!Object.hasOwn(pages, key)) return refuse("That page isn't available.");
        if (onboarding && !assessment && key !== "home") return refuse("Journey and My Time open after the first movement check.", agentCopy.lockedUntilCheck);
        if (["progress", "journal", "medals"].includes(key) && !journeyUnlocked(assessment)) return refuse("The Journey opens once the first movement check has scores and Alira has designed the exercise plan.", journeyLockReason(assessment) === "plan" ? agentCopy.lockedUntilPlan : agentCopy.lockedUntilCheck);
        return { result: `Opening ${key}. This leaves the chat.`, say: pages[key].say, effect: leave(pages[key].path) };
      }
      case "open_my_time": {
        if (onboarding) return refuse("My Time opens after the first movement check.", agentCopy.lockedUntilCheck);
        const activity = ["breathing", "circle", "memory_game", "sounds"].includes(String(input.activity)) ? String(input.activity) : null;
        const query = new URLSearchParams();
        if (activity) query.set("activity", activity);
        if (activity === "breathing" && [1, 3, 5].includes(Number(input.minutes))) query.set("minutes", String(input.minutes));
        const search = query.toString();
        return {
          result: `Opening My Time${activity ? ` at ${activity}` : ""}. This leaves the chat.`,
          say: activity === "breathing" ? agentCopy.openBreathing : agentCopy.openMyTime,
          effect: leave(`/my-time${search ? `?${search}` : ""}`),
        };
      }
      case "open_exercise": {
        const exercise = AGENT_EXERCISES.find(e => e.id === input.exercise_id);
        if (!exercise) return refuse("That exercise isn't available.");
        if (!patientExerciseReady(exercise.id)) {
          return refuse(`${exercise.name} is under development. Offer Graded Forward Reach instead.`, `${exercise.name} is under development. Graded Forward Reach is ready for you to try.`);
        }
        // The daily plan review may rest an exercise after a warning sign, or set today's level.
        const assessment = loadRememberedAssessment();
        const review = loadPlanReview();
        if (restingOn(exercise.id, learningToday(), assessment?.id, review)) {
          return refuse(`${exercise.name} is resting today after a warning sign (a lot of pain, or stopping because of feeling unwell). It comes back tomorrow at the earliest. Suggest another exercise or a rest.`);
        }
        const rung = 1;
        const affected = cur.answers.side_affected;
        const side = input.side === "left" || input.side === "right" ? input.side : affected === "left" || affected === "right" ? affected : null;
        return {
          result: `Opening ${exercise.name} at the ${["", "easy", "medium", "hard"][rung]} level. The patient presses Start when ready. This leaves the chat.`,
          say: `Opening ${exercise.name}. Press Start when you're ready.`,
          effect: leave(`/exercise/${exercise.id}?rung=${rung}${side ? `&side=${side}` : ""}`),
        };
      }
      case "open_settings": {
        const views: Record<string, SettingsView> = { profile: "profile", privacy: "privacy", data_and_permissions: "data", terms: "terms", exercise_engine: "exercise" };
        const key = String(input.section);
        if (!openSettings || !Object.hasOwn(views, key)) return refuse("That settings section isn't available here.");
        return { result: `Opening settings at ${key}.`, say: agentCopy.openSettings, effect: action(() => openSettings(composer.current, views[key])) };
      }
      case "get_plan_changes": {
        const assessment = loadRememberedAssessment();
        const review = loadPlanReview();
        const today = learningToday();
        return {
          result: JSON.stringify({
            today: planItems(assessment).map(item => ({
              exercise_id: item.id, exercise: item.name,
              level: adjustedLevel(item.id, item.baseLevel, assessment?.id, review),
              resting_today: restingOn(item.id, today, assessment?.id, review),
            })),
            recent_changes: review.changes.slice(-8).map(change => ({ from_results_of: change.reviewedDay, what_changed: patientLine(change, today, "popup") })),
          }),
        };
      }
      case "report_how_it_felt": {
        const felt = FELT_OPTIONS.find(option => option === input.felt);
        const pain = PAIN_OPTIONS.find(option => option === input.pain);
        const stopped = input.stopped === true;
        const exercise = AGENT_EXERCISES.find(e => e.id === input.exercise_id);
        if (!felt && !pain && !stopped) return refuse("There was nothing to save: give felt, pain or stopped.");
        saveReport({ source: "exercise", ...(exercise ? { exerciseId: exercise.id } : {}), ...(felt ? { felt } : {}), ...(pain ? { pain } : {}), ...(stopped ? { stopped } : {}) });
        // Warning signs act straight away: the exercise rests and the Rehyn team is emailed.
        const changes = reviewNow();
        void flushAlerts({ force: changes.length > 0 });
        const rested = changes.filter(change => change.warning);
        return {
          result: rested.length
            ? `Saved. ${rested.map(change => patientLine(change, learningToday(), "popup")).join(" ")} Tell the patient kindly, and remind them to call their local emergency number if anything feels sudden or severe.`
            : "Saved. The evening review uses it to set tomorrow's level.",
        };
      }
      case "get_medals":
        return {
          result: JSON.stringify({
            earned: earnedMedals.map(m => ({ name: findMedal(m.id)?.name ?? m.id, when: earnedLabel(m.on) })),
            within_reach_next: withinReachNext.map(id => ({ name: findMedal(id)?.name ?? id, how_to_earn: findMedal(id)?.description ?? "", next_step: medalGuides[id].upNext })),
            all: allMedals.map(m => ({ name: m.name, category: m.category, how_to_earn: m.description, earned: earnedOn(m.id) !== null })),
          }),
        };
      case "set_display": {
        const change: { largeText?: boolean; strongContrast?: boolean } = {};
        if (typeof input.larger_text === "boolean") change.largeText = input.larger_text;
        if (typeof input.stronger_contrast === "boolean") change.strongContrast = input.stronger_contrast;
        if (!Object.keys(change).length) return refuse("Nothing to change.");
        const after = { ...getDisplayPrefs(), ...change };
        const lines = [
          change.largeText === undefined ? "" : change.largeText ? agentCopy.largerText : agentCopy.standardText,
          change.strongContrast === undefined ? "" : change.strongContrast ? agentCopy.strongerContrast : agentCopy.standardContrast,
        ].filter(Boolean);
        return {
          result: `Larger text is ${after.largeText ? "on" : "off"}; stronger contrast is ${after.strongContrast ? "on" : "off"}.`,
          say: lines.join(" "),
          effect: action(() => setDisplayPrefs(change)),
        };
      }
      case "read_aloud": {
        const latest = [...cur.msgs].reverse().find(m => m.from === "Alira");
        if (!latest) return refuse("There is no message that can be read aloud.", agentCopy.nothingToRead);
        return { result: `Reading aloud: "${latest.text}"`, effect: action(() => readMessage(`message-${latest.id}`, latest.text)) };
      }
      case "stop_reading":
        return { result: "Stopped reading aloud.", say: agentCopy.stopReading, effect: action(stopReading) };
      case "show_warning_signs":
        return { result: "Showing the stroke warning signs.", say: agentCopy.warningSigns, effect: action(openSafety) };
      default:
        return refuse(`There is no tool called ${name}.`);
    }
  }

  /** After Alira's reply: dialogs and settings first, then either another page or the next step here. */
  function applyEffects(outcomes: ToolOutcome[], chipsBefore: Chips) {
    const effects = outcomes.flatMap(outcome => (outcome.effect ? [outcome.effect] : []));
    // What the patient asked for takes Alira somewhere new: she is no longer paused.
    if (hold.current.closed && effects.some(effect => effect.kind === "flow" || effect.kind === "leave")) continueAlira();
    effects.filter(effect => effect.kind === "action").forEach(effect => effect.run());
    const away = effects.filter(effect => effect.kind === "leave").at(-1);
    if (away) {
      later(900, away.run);
      return;
    }
    const step = effects.filter(effect => effect.kind === "flow").at(-1);
    if (step) step.run();
    else resume(chipsBefore);
  }

  /** Brings back whatever the patient's message set aside: the question, the done card or the choices. */
  function resume(chipsBefore: Chips) {
    if (hold.current.closed) {
      // Paused part way through her lines, Alira brings these back herself once she continues and finishes them, so
      // they stay after the line that introduces them. Paused with nothing of her own still to come, she need not stay so.
      if (flowGoing()) return;
      continueAlira();
    }
    const cur = sRef.current;
    if (cur.done) patch({ showDone: true });
    else if (cur.paused) patch({ chips: "resume" });
    else if (cur.started && cur.qi >= 0) patch({ showQ: true });
    else if (chipsBefore === "medal" || chipsBefore === "medalNext") patch({ chips: chipsBefore });
    else if (!cur.started) patch({ chips: "intro2" });
  }

  function noteActivity(note: string) {
    agentActivity.current = [...agentActivity.current, note].slice(-6);
  }

  function pageState(): string {
    const cur = sRef.current;
    const display = getDisplayPrefs();
    const state = describePageState({
      answers: cur.answers, qi: cur.qi, started: cur.started, done: cur.done, paused: cur.paused,
      newUser: onboarding && !assessment, medal: medalGuide?.medal.name ?? null,
      movementCheckDoneOn: loadRememberedAssessment()?.completedAt.slice(0, 10) ?? null,
      largeText: display.largeText, strongContrast: display.strongContrast,
    });
    if (exerciseCompletion) return state.replace("</page_state>", "The patient has completed an exercise. Alira has congratulated them and invited them to rest, make a journal note, or play in My Time. Journal and My Time buttons are showing.\n</page_state>");
    // While today's warm-up invitation replaces the movement check card, say so.
    if (!(cur.done && !assessment && !warmUpSkipped && warmUpInviteDue(cur.answers))) return state;
    return state.replace("</page_state>", "Instead of the movement check card, the one-minute warm-up invitation is showing (two comfortable reaches, never scored), with \"Let's warm up together\" and \"Maybe later\" buttons. The movement check card appears after the warm-up or after Maybe later.\n</page_state>");
  }

  /** A request Alira recognised herself: run the tool and confirm it in her own words. */
  function handleLocal(route: LocalRoute, text: string, chipsBefore: Chips) {
    const outcome = route.tool ? runTool(route.tool.name, route.tool.input) : null;
    const line = route.say ?? outcome?.say ?? "";
    noteActivity(`The patient wrote "${text.slice(0, 200)}". ${outcome ? `The app ran ${route.tool?.name}: ${outcome.result}` : ""} Alira replied: "${line}"`);
    const done = () => applyEffects(outcome ? [outcome] : [], chipsBefore);
    if (!line) {
      done();
      return;
    }
    later(300, () => setAnswerTyping(true));
    later(900, () => say(line, {}, done, aliraPhraseId(line) === undefined, false, "answer"));
  }

  /** Anything else goes to Claude, who can use the same tools. */
  async function askClaude(text: string, chipsBefore: Chips) {
    const controller = new AbortController();
    agentAbort.current = controller;
    askedNotAnswered.current = text;
    commit({ busy: true });
    setAnswerTyping(true);
    const outcomes: ToolOutcome[] = [];
    const notes = agentActivity.current;
    agentActivity.current = [];
    const user: AgentBlock[] = [
      { type: "text", text: pageState() },
      ...(notes.length ? [{ type: "text" as const, text: `<recent_activity>\n${notes.join("\n")}\n</recent_activity>` }] : []),
      { type: "text", text },
    ];
    let texts: string[];
    let generated = true;
    try {
      const turn = await runAgentTurn({
        history: agentHistory.current,
        user,
        signal: controller.signal,
        execute: toolCall => {
          const outcome = runTool(toolCall.name, toolCall.input);
          outcomes.push(outcome);
          return { content: outcome.result, isError: outcome.isError };
        },
      });
      if (controller.signal.aborted) return;
      agentHistory.current = turn.history;
      texts = turn.texts;
    } catch {
      if (controller.signal.aborted) return;
      // Whatever the tools already did stays done; Claude hears about it next time.
      outcomes.forEach(outcome => noteActivity(`The app ran a tool before Alira lost her connection: ${outcome.result}`));
      texts = [];
    } finally {
      if (agentAbort.current === controller) agentAbort.current = null;
    }
    if (!texts.length) {
      texts = [outcomes.map(outcome => outcome.say).filter(Boolean).at(-1) ?? agentCopy.trouble];
      generated = aliraPhraseId(texts[0]) === undefined;
    }
    askedNotAnswered.current = "";
    commit({ busy: false });
    sayAll(texts, {}, () => applyEffects(outcomes, chipsBefore), generated, false, "answer");
  }

  /** Without Claude and without a recognised request: a kind word, then back to where things were. */
  function fallbackReply(ctx: RouteContext, chipsBefore: Chips) {
    const line = ctx.question ? agentCopy.notAnswered : sRef.current.started ? copy.noted : copy.keepInMind;
    later(350, () => setAnswerTyping(true));
    later(1300, () => say(line, {}, () => resume(chipsBefore), false, false, "answer"));
  }

  // The patient can write at any time. If Alira is part way through her lines, she pauses so the question comes
  // first (Continue brings the rest); a question she is still thinking about is asked again together with this one.
  function send(event: FormEvent) {
    event.preventDefault();
    const text = s.draft.trim();
    if (!text) return;
    if (flowGoing()) pauseAlira();
    let question = text;
    if (sRef.current.busy && agentAbort.current) {
      agentAbort.current.abort("asked again");
      agentAbort.current = null;
      if (askedNotAnswered.current) question = `${askedNotAnswered.current}\n\n${text}`;
      commit({ busy: false });
    }
    const before = sRef.current;
    const ctx: RouteContext = {
      question: before.qi >= 0 && !before.done && !before.paused ? onboardingQuestions[before.qi] : null,
      started: before.started,
      done: before.done,
      speaking: speechState.activeId !== null,
    };
    recognition.current?.stop();
    stopReading();
    userSays(text);
    setVoiceNotice("");
    composer.current?.focus();
    const route = routeLocally(text, ctx);
    if (route?.admin) adminSkip(false);
    else if (route) handleLocal(route, text, before.chips);
    else if (agentReady.current) void askClaude(question, before.chips);
    else fallbackReply(ctx, before.chips);
  }

  /** The "Carry on" choice after a pause. */
  function carryOn() {
    if (sRef.current.busy || completionBusy) return;
    const chipsBefore = sRef.current.chips;
    userSays("Carry on");
    handleLocal({ tool: { name: "continue_survey", input: {} } }, "Carry on", chipsBefore);
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

  // The avatar replays Alira's welcome. It keeps the answers; "restart the survey" in the chat clears them.
  function replayWelcome() {
    if (completionBusy) return;
    agentAbort.current?.abort();
    agentAbort.current = null;
    agentHistory.current = [];
    agentActivity.current = [];
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
        voicePacked.current = new Set(Array.isArray(status?.packed) ? status.packed : []);
      })
      .catch(() => {
        voiceConfigured.current = false;
      });
    void fetch("/api/alira/agent/status", { signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(status => {
        agentReady.current = status?.configured === true;
      })
      .catch(() => {
        agentReady.current = false;
      });
    fromHome.current = cameFromHome(search);
    if (animateEntrance) begin(fromHome.current);
    else if (animateOpening || pendingReturn.length) sayAll(pendingReturn.length ? pendingReturn : opening.msgs.map(message => message.text), {}, () => {
      patch({ chips: opening.chips, showQ: opening.showQ, showDone: opening.showDone, showSteps: opening.showSteps });
      setOpeningPending(false);
    }, false, opening.msgs.every(message => message.localOnly));
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
      agentAbort.current?.abort();
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
      randomRequest.current?.abort("page-left");
    };
    // Automatic entrance motion plays only on the first visit; manual replay stays available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rememberAliraVisit(s.started);
  }, [s.started]);

  persistChat.current = () => {
    const current = sRef.current;
    aliraChatStore.save(historyContext, {
      messages: current.msgs,
      presentation: {
        chips: current.chips, started: current.started, done: current.done, qi: current.qi,
        showQ: current.showQ, showDone: current.showDone, showSteps: current.showSteps, paused: current.paused,
        sel: current.sel, otherOpen: current.otherOpen, otherText: current.otherText, draft: current.draft,
      },
      positions: { ...transcriptPositions.current, cards: [...transcriptPositions.current.cards] },
      scrollTop: scrollTop.current, warmUpDay: fromWarmUp ? learningToday() : restored?.warmUpDay ?? null,
      planFailed: planState === "error", planError,
    });
  };
  useEffect(() => {
    persistChat.current();
  }, [historyContext, s.msgs, s.chips, s.started, s.done, s.qi, s.showQ, s.showDone, s.showSteps, s.paused,
    s.sel, s.otherOpen, s.otherText, s.draft, planState, planError]);
  useEffect(() => {
    const save = () => persistChat.current();
    window.addEventListener("pagehide", save);
    return () => { window.removeEventListener("pagehide", save); save(); };
  }, []);

  useEffect(() => {
    if (restoreScroll.current !== null) {
      thread.current?.scrollTo({ top: restoreScroll.current, behavior: "instant" });
      restoreScroll.current = null;
      return;
    }
    thread.current?.scrollTo({
      top: thread.current.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }, [s.msgs, s.typing, s.typingId, s.chips, s.showQ, s.showDone, s.showSteps, planState, planWaiting]);

  useEffect(() => {
    if (!assessment?.report || medalGuide || exerciseCompletion) return;
    if (assessment.planChatCompleted && Array.isArray(assessment.report.rehab_plan)) { setPlanState("ready"); return; }
    if (restored?.context === historyContext && restored.planFailed && planRetry === 0) return;
    const controller = new AbortController();
    let requestTimeout: number | undefined;
    clearTimers();
    setPlanState("responding");
    patch({ done: true, started: true, showQ: false, showDone: false, showSteps: false, paused: false, busy: false, chips: "none" });
    void runAssessmentConversation(assessment.report, {
      onPlanWaiting: setPlanWaiting,
      showMessage: async text => {
        // A visit interrupted during plan preparation continues with new lines only.
        if (restored?.context === historyContext && sRef.current.msgs.some(message => message.from === "Alira" && message.text === text)) return;
        await presentMessage(text, controller.signal, false, true);
        await pauseAssessmentChat(500, controller.signal);
      },
      preparePlan: async () => {
        setPlanState("planning");
        requestTimeout = window.setTimeout(() => controller.abort("timeout"), 20000);
        try { return await requestAssessmentPlan(assessment, sRef.current.answers, controller.signal); }
        finally { clearTimeout(requestTimeout); }
      },
    }, controller.signal, planRetry > 0).then(report => {
      if (controller.signal.aborted) return;
      setAssessment(rememberAssessmentPlan(assessment, report, true));
      setPlanState("ready");
    }).catch(() => {
      if (controller.signal.reason !== "page-left") {
        patch({ typing: false, typingId: null });
        setPlanError("I couldn’t prepare your exercise plan just yet. Your scores are still here. Please try again.");
        setPlanState("error");
      }
    });
    return () => { clearTimeout(requestTimeout); controller.abort("page-left"); };
  }, [assessment?.id, planRetry, medalGuide, exerciseCompletion]);

  function finishRandomExercises() {
    if (completionBusy) return;
    const completion = finishPreviewExercises(assessment);
    if (!completion) return;
    clearTimers(); stopReading(); recognition.current?.abort();
    setExerciseCompletion(completion);
    setPlanState("idle");
    setPlanWaiting(false);
    setOpeningPending(true);
    patch({ done: true, started: true, showQ: false, showDone: false, showSteps: false, typing: false, typingId: null, busy: false, chips: "none",
      msgs: [],
    });
    sayAll(exerciseCompletionMessages(completion, profileName(profileStore.load())), {}, () => setOpeningPending(false), false, true);
  }

  async function finishRandomAssessment() {
    if (randomRequest.current || planState === "testing" || planState === "responding" || planState === "planning") return;
    clearTimers(); stopReading(); recognition.current?.abort();
    const controller = new AbortController();
    randomRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), 20000);
    setPlanState("testing"); setPlanError("");
    try {
      const report = await randomAssessment(sRef.current.answers, controller.signal);
      if (controller.signal.aborted) throw new Error("Timed out");
      const stored = rememberAssessment(report);
      if (!stored) throw new Error("Incomplete result");
      setS(current => ({ ...current, done: true, started: true, showQ: false, showDone: false, typing: false, typingId: null,
      }));
      setAssessment(stored);
      setPlanRetry(0);
      setPlanState("responding");
    } catch {
      if (controller.signal.reason !== "page-left") {
        setPlanError(!companionTaskPlan(sRef.current.answers).taskIds.length
          ? "Your answers call for supported movement rather than a camera assessment. No random marks were created. Use Start now to review the next step with Alira."
          : "The test assessment couldn’t finish. Check that the local assessment service is running and try again.");
        setPlanState("error");
      }
    } finally { clearTimeout(timeout); randomRequest.current = null; }
  }

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
    // Alira always speaks in her own voice when it is there: a line in the voice pack plays
    // even without a key. The device voice is only a last resort for a line that has neither.
    const phraseId = aliraPhraseId(text);
    const packed = phraseId !== undefined && voicePacked.current.has(phraseId);
    // Personal messages and replies written in the moment are read in her voice too.
    // If her voice can't play it right now, the device voice reads it rather than staying silent.
    if (packed || voiceConfigured.current !== false || !("speechSynthesis" in window)) {
      void speech.current?.play(id, text, "speechSynthesis" in window ? () => readWithDevice(id, text) : undefined);
      return;
    }
    readWithDevice(id, text);
  }

  // Without Alira's voice (not recorded and no key or credits), the device voice reads the message.
  function readWithDevice(id: string, text: string) {
    if (!("speechSynthesis" in window)) { setVoiceNotice("Audio isn’t available on this device. You can still read every message here."); return; }
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
    if (completionBusy) return;
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

  // The warm-up returns here to invite the patient before opening the movement check.
  function startWarmUp() {
    if (completionBusy) return;
    stopReading();
    recognition.current?.abort();
    navigate(`/warm-up?gate=survey_end&next=${encodeURIComponent(onboarding ? "/alira?onboarding=1&from=warm-up" : "/alira?from=warm-up")}`);
  }

  // No pressure: the warm-up is offered again just before the movement check.
  function skipWarmUp() {
    if (completionBusy || sRef.current.busy) return;
    try {
      recordWarmRepSkip("survey_end");
    } catch {
      /* The movement check card follows either way. */
    }
    setWarmUpSkipped(true);
    stopReading();
    reply(copy.warmUpCard.later, copy.warmUpSkip, {}, 1300, () => patch({ showDone: true }));
  }

  // The patient took the medal's next step: Alira answers, then leads them to where it is earned.
  function takeMedalStep() {
    if (!medalGuide) return;
    const { next } = medalGuide;
    reply(medalGuide.reply, medalGuide.follow, {}, 1300, () => {
      if (next.kind === "assessment") patch({ showDone: true });
      else if (next.kind === "go") patch({ chips: "medalNext" });
      else composer.current?.focus();
    });
  }

  function leaveFor(path: string) {
    stopReading();
    recognition.current?.abort();
    navigate(path);
  }

  // ---- derived ---------------------------------------------------------------------------------

  const cur = currentQ();
  const list = applicableQuestions(s.answers);
  const pos = cur ? list.indexOf(s.qi) : -1;
  const progressPct = s.done ? 100 : Math.round(((pos >= 0 ? pos : 0) / list.length) * 100);
  const isMulti = cur?.type === "multi";
  const starters = [...starterSets[s.starterSet % starterSets.length], concernStarter];
  const placeholder = s.showQ ? "Tap an answer above, or type to Alira" : s.started ? copy.placeholders[0] : copy.placeholders[s.phIndex];
  const avatarBusy = s.typing || s.typingId !== null || answerTyping;
  const homePath = onboarding && !assessment ? "/welcome" : "/";
  const completionBusy = openingPending || planState === "testing" || planState === "responding" || planState === "planning";
  const planPreparing = planState === "responding" || planState === "planning";
  // Alira is part way through her lines, so the patient may pause her: kept on through the short gaps between lines.
  const aliraSpeaking = flowLive > 0 || s.typing || openingPending || planPreparing;
  const [pausable, setPausable] = useState(aliraSpeaking);
  useEffect(() => {
    if (aliraSpeaking) { setPausable(true); return; }
    const timer = window.setTimeout(() => setPausable(false), 900);
    return () => clearTimeout(timer);
  }, [aliraSpeaking]);
  const medalGo = medalGuide && medalGuide.next.kind === "go" ? medalGuide.next : null;
  // After the survey, until today's warm-up is done or skipped, its invitation takes the movement check card's place.
  const warmUpInvite = s.showDone && !hasResult && !medalGuide && !warmUpSkipped && warmUpInviteDue(s.answers);

  // Resuming the same question keeps its position; asking it again creates a new card turn.
  const questionCardKey = `question-${cur?.k}-${[...s.msgs].reverse().find(message => message.from === "Alira" && message.text === cur?.t)?.id ?? "opening"}`;
  const cards = [
    s.showSteps && (
      <div key="steps" className="ao-steps">
        <div className="ao-step ao-rise"><span className="ao-step-icon"><MessageCircle size={15} /></span><b>1 · About you</b><span>A chat like this one · 3 min</span></div>
        <div className="ao-step ao-rise d1"><span className="ao-step-icon"><Camera size={15} /></span><b>2 · How you move</b><span>Gentle movements, camera on · 10 min</span></div>
        <div className="ao-step ao-rise d2"><span className="ao-step-icon"><Target size={15} /></span><b>3 · Your goals</b><span>In your own words · 2 min</span></div>
      </div>
    ),

    s.chips === "intro" && (
      <div key="intro" className="ao-choices-wrap">
        <div className="ao-choices">
          <button type="button" className="ao-chip is-primary ao-pulse" onClick={start}>Let's start <Arrow /></button>
          <AdminChip onClick={adminSkip} />
        </div>
        <p className="ao-hint ao-rise d3"><Sparkles size={14} aria-hidden="true" /> Finish today and I'll show you your first movement straight away.</p>
      </div>
    ),

    s.chips === "intro2" && (
      <div key="intro" className="ao-choices">
        <button type="button" className="ao-chip is-primary ao-pulse" onClick={start}>Let's start <Arrow /></button>
        <AdminChip onClick={adminSkip} />
      </div>
    ),

    s.chips === "medal" && medalGuide && (
      <div key="medal" className="ao-choices">
        <button type="button" className="ao-chip is-primary ao-pulse" onClick={takeMedalStep}>{medalGuide.reply} <Arrow /></button>
        <button type="button" className="ao-chip ao-rise d1" onClick={() => leaveFor(MEDALS_PATH)}>Not now</button>
      </div>
    ),

    s.chips === "medalNext" && medalGo && (
      <div key="medal-next" className="ao-choices">
        <button type="button" className="ao-chip is-primary ao-pulse" onClick={() => leaveFor(medalGo.href)}>{medalGo.label} <Arrow /></button>
      </div>
    ),

    s.chips === "resume" && (
      <div key="resume" className="ao-choices">
        <button type="button" className="ao-chip is-primary ao-rise" onClick={carryOn}>Carry on <Arrow /></button>
      </div>
    ),

    s.showQ && cur && (
      <div key={questionCardKey} className="ao-card-wrap ao-pop">
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
    ),

    warmUpInvite && (
      <div key="warm-up" className="ao-card-wrap ao-pop">
        <div className="ao-done ao-warm">
          <div className="ao-done-top">
            <span className="ao-done-art ao-warm-art" aria-hidden="true"><RecoverySeedling /></span>
            <div>
              <span className="ao-eyebrow is-green">{copy.warmUpCard.eyebrow}</span>
              <span className="ao-done-title">{copy.warmUpCard.title}</span>
              <p>{copy.warmUpCard.body}</p>
            </div>
          </div>
          <div className="ao-done-actions">
            <button type="button" className="ao-cta is-compact ao-pulse" disabled={completionBusy} onClick={startWarmUp}>{copy.warmUpCard.start} <Arrow /></button>
            <button type="button" className="ao-link ao-warm-later" disabled={completionBusy} onClick={skipWarmUp}>{copy.warmUpCard.later}</button>
            {randomAssessmentEnabled() && <button type="button" className="ao-test-assessment" disabled={completionBusy} onClick={() => void finishRandomAssessment()}>Finish assessment with random scores</button>}
          </div>
          {planState === "testing" && <p role="status">Creating random test scores…</p>}
          {planState === "error" && !hasResult && <p role="alert">{planError}</p>}
        </div>
      </div>
    ),
    s.showDone && (!hasResult || !!medalGuide) && !warmUpInvite && (
      <div key="movement-check" className="ao-card-wrap ao-pop">
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
            <button type="button" className="ao-cta is-compact ao-pulse" disabled={completionBusy} onClick={startMovementCheck}>{fromWarmUp ? "Let's do the movement check" : "Start now"} <Arrow /></button>
            {randomAssessmentEnabled() && <button type="button" className="ao-test-assessment" disabled={completionBusy} onClick={() => void finishRandomAssessment()}>Finish assessment with random scores</button>}
          </div>
          {planState === "testing" && <p role="status">Creating random test scores…</p>}
          {planState === "error" && !hasResult && <p role="alert">{planError}</p>}
        </div>
      </div>
    ),
    hasResult && !exerciseCompletion && !openingPending && planState === "ready" && <div key="plan-ready" className="ao-card-wrap ao-pop"><div className="ao-done ao-plan-card">
      <div className="ao-done-top"><span className="ao-done-art ao-plan-art" aria-hidden="true"><Sparkles size={32} /></span>
        <div><span className="ao-done-title">Your exercise plan is ready</span></div></div>
      <div className="ao-done-actions">
        <button type="button" className="ao-cta is-compact" onClick={() => leaveFor(EXERCISES_PATH)}>View my exercises <Arrow /></button>
        {randomAssessmentEnabled() && <button type="button" className="ao-test-assessment" disabled={completionBusy} onClick={finishRandomExercises}>Finish exercises with random scores</button>}
      </div>
    </div></div>,
    exerciseCompletion && !openingPending && <div key="exercise-rest" className="ao-card-wrap ao-pop"><div className="ao-done ao-exercise-rest">
      <div className="ao-done-top"><span className="ao-done-art ao-plan-art" aria-hidden="true"><Sparkles size={32} /></span>
        <div><span className="ao-done-title">A little time for you</span></div></div>
      <div className="ao-done-actions">
        <button type="button" className="ao-cta is-compact" onClick={() => leaveFor(EXERCISE_JOURNAL_PATH)}>Keep a little note in my journal <Arrow /></button>
        <button type="button" className="ao-chip" onClick={() => leaveFor(EXERCISE_MY_TIME_PATH)}>Play a little in My Time <Arrow /></button>
      </div>
    </div></div>,
    hasResult && planState === "error" && <div key={`plan-error-${planRetry}`} className="ao-card-wrap ao-pop"><div className="ao-done ao-plan-error">
      <span className="ao-done-title">Your results are here</span>
      <p role="alert">{planError}</p>
      <div className="ao-done-actions">
        <button type="button" className="ao-cta is-compact" onClick={() => setPlanRetry(value => value + 1)}>Try preparing my plan again</button>
        {randomAssessmentEnabled() && <button type="button" className="ao-test-assessment" onClick={() => void finishRandomAssessment()}>Finish assessment with random scores</button>}
      </div>
    </div></div>,
  ].filter(isValidElement);

  return (
    <RecoveryShell active="Alira" dateLabel="" className="ao-shell">
      <div className="ao-page" data-entrance-motion={animateEntrance ? "staged" : "static"}>
        <header className="ao-header">
          <div className="ao-identity">
            <button type="button" className={`ao-avatar ${avatarBusy ? "is-busy" : ""}`} onClick={replayWelcome} aria-label="Replay Alira's welcome" title="Replay Alira's welcome">
              <span className="ao-orbit" aria-hidden="true" />
              <span className="ao-core" aria-hidden="true">
                <HeartRateMark size={26} pulseClassName="ao-ecg" />
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
            <div className="ao-thread" ref={thread} onScroll={event => { scrollTop.current = event.currentTarget.scrollTop; }}>
              <div className="ao-date"><span>Today</span></div>
              {medalGuide && (
                <div className="ao-medal-context mc-tone" data-tone={medalGuide.medal.tone}>
                  <MedalCoin id={medalGuide.medal.id} earned={false} size="small" />
                  <span>Working towards <b>{medalGuide.medal.name}</b></span>
                </div>
              )}
              <AliraTranscript cards={cards} initialPositions={restored?.positions} onPositionsChange={rememberPositions} messages={s.msgs.map(message => ({ id: message.id, node:
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
                      {/* Every Alira message, fixed or written in the moment, can be heard in her voice. */}
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
                }))} />

              {((s.typing && !held) || answerTyping) && (
                <div className="ao-typing ao-rise" role="status">
                  <CompanionMark />
                  <span className="ao-dots" aria-hidden="true"><i /><i /><i /></span>
                  <span>Alira is typing</span>
                </div>
              )}
              {planWaiting && !held && (
                <div className="ao-typing ao-rise" role="status">
                  <CompanionMark />
                  <span className="ao-dots" aria-hidden="true"><i /><i /><i /></span>
                  <span>Preparing your exercise plan…</span>
                </div>
              )}

            </div>

            <div className="ao-composer-area">
              {/* The patient can pause Alira part way through her lines to ask something at once, then continue. */}
              {held ? (
                <div className="ao-hold is-held">
                  <p role="status">Alira has paused. Ask her anything, then press Continue for the rest.{planPreparing ? " Your exercise plan is still being prepared." : ""}</p>
                  <button type="button" className="ao-hold-button" onClick={continueAlira}><Play size={14} aria-hidden="true" /> Continue</button>
                </div>
              ) : pausable && (
                <div className="ao-hold">
                  <button type="button" className="ao-hold-button" aria-label="Pause Alira so you can ask something" onClick={pauseAlira}><Pause size={14} aria-hidden="true" /> Pause</button>
                </div>
              )}
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
                  maxLength={2000}
                  autoComplete="off"
                />
                <button type="button" className={`ao-mic ${isListening ? "is-listening" : ""}`} aria-label={isListening ? "Stop voice typing" : "Type a message with your voice"} aria-pressed={isListening} onClick={dictate}>
                  {isListening ? <Square size={16} /> : <Mic size={17} />}
                </button>
                <button type="submit" className="ao-send" aria-label="Send message" disabled={!s.draft.trim()}>
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
