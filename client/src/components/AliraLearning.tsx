import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, SendHorizontal, Square } from "lucide-react";
import {
  CONSENT_CATEGORIES, PARAM_IDS, changesOn, currentValue, formatValue, paramSpec,
  type AdaptationState, type AutoValues, type ParamId,
} from "@shared/alira-adaptation";
import {
  autoValuesNow, learningToday, learningVersion, loadAdaptation,
  loadConsentRecord, subscribeLearning,
} from "@/lib/alira-learning-store";
import {
  askLearningChat, lastLearningOutcome, learningStatus, subscribeLearningRun,
  type LearningOutcome, type LearningStatus,
} from "@/lib/alira-learning-client";
import type { ChannelTurn } from "@/lib/alira-channel-client";
import { learningOpening } from "@/lib/learning-opening";
import { profileName, useProfile } from "@/lib/profile";
import AliraAvatar from "./AliraAvatar";
import { PlanChangesCard } from "./PlanChangesCard";
import { TypedChatText } from "./TypedChatText";
import { Markdown } from "./HowItWorks";
import "./how-it-works.css";
import "./alira-learning.css";

type Turn = ChannelTurn;
type Shown = { tone: "warn"; text: string };

const ACCESS_LABELS = { survey: "Answers to Alira's questions", movement: "Movement results", camera: "Warm-up still pictures", personal: "Name and personal goal", journal: "Journal" };
const FOLLOW_UPS = ["Explain that more simply", "What evidence did you use?", "What would change your mind?"];

// ---------------------------------------------------------------- wording helpers

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const valueWords = (id: ParamId, value: number | null, auto: AutoValues) => formatValue(id, value, auto[id]);

function rangeWords(id: ParamId): string {
  const spec = paramSpec(id);
  if (spec.choices) {
    const labels = spec.choiceLabels ?? spec.choices;
    return `${labels[0]} to ${labels[labels.length - 1]}`;
  }
  return `${formatValue(id, spec.min)} to ${formatValue(id, spec.max)}, in steps of ${formatValue(id, spec.step)}`;
}

function easierWords(id: ParamId): string {
  const spec = paramSpec(id);
  const way = spec.choices ? `Easier: ${(spec.choiceLabels ?? spec.choices)[0]}` : spec.easier === "lower" ? "Lower is easier" : "Higher is easier";
  return `${way}. At most ${plural(spec.maxHarderStepsPerDay, "step")} harder a day.`;
}

function outcomeWords(outcome: LearningOutcome | null): Shown | null {
  if (!outcome || outcome.kind !== "failed") return null;
  return { tone: "warn", text: `The last review did not finish. ${outcome.error || "Please try again."}` };
}

/** Up to three opening questions, adapted to whether Alira changed anything today. */
function starterQuestions(state: AdaptationState, today: string): string[] {
  const first = changesOn(state, today).find(entry => entry.by === "alira");
  return [
    first ? `Why did you change "${paramSpec(first.param).label}"?` : "Why didn't you change anything today?",
    "What did you see in today's warm-up?",
    "What are you not allowed to change?",
  ];
}

function readStores() {
  return {
    state: loadAdaptation(),
    consent: loadConsentRecord(),
    auto: autoValuesNow(),
  };
}

// ---------------------------------------------------------------- the panel

/**
 * Settings tab for admins: Alira's access and adjustable settings, with a chat to ask her why.
 * Her changes are bounded by shared/alira-adaptation.ts; the chat can explain but never change anything.
 */
export function AliraLearningPanel({ onOpenData }: { onOpenData: () => void }) {
  const version = useSyncExternalStore(subscribeLearning, learningVersion, () => 0);
  const name = profileName(useProfile());
  const [status, setStatus] = useState<LearningStatus | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [greetingDone, setGreetingDone] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [searching, setSearching] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // `version` changes whenever the learning stores do.
  const starters = useMemo(() => starterQuestions(loadAdaptation(), learningToday()), [version]);
  const greeting = useMemo(() => learningOpening({ name, state: loadAdaptation(), consent: loadConsentRecord().categories, today: learningToday(), auto: autoValuesNow() }), [version, name]);

  useEffect(() => { setGreetingDone(false); }, [greeting]);

  useEffect(() => {
    const controller = new AbortController();
    void learningStatus(controller.signal).then(next => { if (!controller.signal.aborted) setStatus(next); });
    return () => { controller.abort(); abort.current?.abort(); };
  }, []);
  // The settings overview comes first, so only the conversation moves the thread to its end.
  useEffect(() => { if (turns.length || busy) end.current?.scrollIntoView({ block: "end" }); }, [turns, searching, busy]);

  const unavailable = status !== null && (!status.enabled || !status.configured);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy || revealing || !greetingDone || unavailable) return;
    const history: Turn[] = [...turns, { role: "user", text }];
    setTurns(history);
    setInput("");
    setBusy(true);
    setSearching(false);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const answer = await askLearningChat({ turns: history, signal: controller.signal, onStatus: () => setSearching(true) });
      if (controller.signal.aborted) return;
      setRevealing(true);
      setTurns(list => [...list, { role: "assistant", text: answer.text }]);
    } catch (error) {
      if (!controller.signal.aborted) {
        setRevealing(true);
        setTurns(list => [...list, { role: "assistant", failed: true, text: error instanceof Error ? error.message : "I couldn't answer that just now." }]);
      }
    } finally {
      setBusy(false);
      setSearching(false);
      abort.current = null;
      box.current?.focus();
    }
  }

  return (
    <div className="hw al">
      <div className="hw-thread al-thread" role="region" aria-label="What Alira learned and changed today" tabIndex={0}>
        <LearningReview onOpenData={onOpenData} />

        <section className="al-chat" aria-labelledby="al-chat-title">
          <h3 id="al-chat-title">Ask Alira about today</h3>
          <div className="al-log" role="log" aria-live="polite" aria-label="Conversation with Alira about what she learned">
            <div className="hw-row">
              <span className="hw-avatar hw-avatar-sm"><AliraAvatar /></span>
              <div className="hw-bubble"><TypedChatText text={greeting} onComplete={() => setGreetingDone(true)}>{visible => <Markdown text={visible} />}</TypedChatText></div>
            </div>
            {turns.length === 0 && greetingDone && (
              <div className="hw-chips" role="group" aria-label="Suggested questions">
                {starters.slice(0, 3).map(q => <button type="button" key={q} onClick={() => void ask(q)} disabled={unavailable}>{q}</button>)}
              </div>
            )}
            {turns.map((turn, i) => turn.role === "user" ? (
              <div key={i} className="hw-row hw-row-user"><div className="hw-bubble hw-user">{turn.text}</div></div>
            ) : (
              <div key={i} className="hw-row">
                <span className="hw-avatar hw-avatar-sm"><AliraAvatar /></span>
                <div className={`hw-bubble ${turn.failed ? "hw-failed" : ""}`}>
                  <TypedChatText text={turn.text} onComplete={() => { if (i === turns.length - 1) setRevealing(false); }} onProgress={() => end.current?.scrollIntoView({ block: "end" })}>{visible => turn.failed ? visible : <Markdown text={visible} />}</TypedChatText>
                </div>
              </div>
            ))}
            {busy && (
              <div className="hw-row">
                <span className="hw-avatar hw-avatar-sm"><AliraAvatar /></span>
                <div className="hw-bubble hw-working" role="status">
                  <div className="hw-dots" aria-hidden="true"><i /><i /><i /></div>
                  <p>I'm thinking about your question.{searching && <><br />I'm looking at Zak's results and my rules.</>}</p>
                </div>
              </div>
            )}
            {turns.at(-1)?.role === "assistant" && !busy && !revealing && (
              <div className="hw-chips hw-follow" role="group" aria-label="Follow-up ideas">
                {FOLLOW_UPS.map(q => <button type="button" key={q} onClick={() => void ask(q)} disabled={unavailable}>{q}</button>)}
              </div>
            )}
            {turns.length > 0 && !busy && !revealing && <button type="button" className="hw-reset" onClick={() => setTurns([])}>Start a new chat</button>}
          </div>
        </section>
        <div ref={end} />
      </div>

      <form className="hw-form" onSubmit={e => { e.preventDefault(); void ask(input); }}>
        <label htmlFor="al-input" className="al-sr">Ask Alira about what she learned today</label>
        <textarea
          id="al-input" ref={box} rows={2} value={input} maxLength={2000} placeholder="Ask about today's changes, the warm-up, or the limits…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(input); } }}
          disabled={unavailable}
        />
        {busy
          ? <button type="button" className="hw-send" onClick={() => abort.current?.abort()} aria-label="Stop"><Square size={16} aria-hidden="true" /></button>
          : <button type="submit" className="hw-send" disabled={!input.trim() || unavailable || revealing || !greetingDone} aria-label="Send"><SendHorizontal size={18} aria-hidden="true" /></button>}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- settings overview (kept apart so typing does not re-read the stores)

const LearningReview = memo(function LearningReview({ onOpenData }: { onOpenData: () => void }) {
  const version = useSyncExternalStore(subscribeLearning, learningVersion, () => 0);
  const lastRun = useSyncExternalStore(subscribeLearningRun, lastLearningOutcome, () => null);
  const { state, consent, auto } = useMemo(readStores, [version]);
  const shown = outcomeWords(lastRun);

  return (
    <>
      <section className="al-card" aria-labelledby="al-consent-label">
        <h3 id="al-consent-label">What Alira is learning from</h3>
        <div className="al-consent">
          <ul className="al-consent-chips" aria-labelledby="al-consent-label">
            {CONSENT_CATEGORIES.map(category => {
              const on = consent.categories[category];
              return (
                <li key={category} className={on ? "al-on" : "al-off"}>
                  <Check size={13} aria-hidden="true" />
                  {ACCESS_LABELS[category]}<span className="al-access-state">{on ? "Shared" : "Not shared"}</span>
                </li>
              );
            })}
          </ul>
          <button type="button" className="al-link" onClick={onOpenData}>Choose what Alira can access</button>
        </div>
      </section>

      {/* The daily plan review's changes to levels and rest days (lib/plan-review.ts). */}
      <PlanChangesCard />

      <section className="al-card" aria-labelledby="al-settings-title">
        <h3 id="al-settings-title">All settings</h3>
        <details className="al-details">
          <summary>Show the {PARAM_IDS.length} settings Alira can adjust</summary>
          <div className="al-table">
            <table>
              <thead>
                <tr><th scope="col">Setting</th><th scope="col">In force</th><th scope="col">Default</th><th scope="col">Range</th><th scope="col">Easier direction</th><th scope="col">Applies to</th><th scope="col">Applied in</th></tr>
              </thead>
              <tbody>
                {PARAM_IDS.map(id => {
                  const spec = paramSpec(id);
                  const value = currentValue(state, id);
                  const changed = value !== spec.default;
                  return (
                    <tr key={id}>
                      <th scope="row"><b>{spec.label}</b><span className="al-meaning">{spec.meaning}</span></th>
                      <td>{valueWords(id, value, auto)}{changed && <> <span className="al-tag al-tag-changed">Changed</span></>}</td>
                      <td>{valueWords(id, spec.default, auto)}</td>
                      <td>{rangeWords(id)}</td>
                      <td>{easierWords(id)}</td>
                      <td>{spec.appliesTo}</td>
                      <td><code>{spec.appliedIn}</code></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      {shown && <p className={`al-outcome al-outcome-${shown.tone}`} role="status">{shown.text}</p>}
    </>
  );
});
