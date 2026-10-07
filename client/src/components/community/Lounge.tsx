import { useEffect, useId, useState } from "react";
import { Link } from "wouter";
import { lounge, people, type LoungeMessage, type PersonId } from "@/content/community-samples";
import { canSee, communityHref, communityStore, isBlocked, useCommunity, type NoteDraft } from "@/lib/community-store";
import { useBursts, useLater, usePinnedToEnd } from "./hooks";
import { ChatIcon, HandIcon, HeartIcon, NextIcon, RingIcon } from "./icons";
import { AliraMark, ChatInput, Face, FloatingHearts, LiveDot, MyMessage, TheirMessage, toneClass, TypingRow } from "./parts";

type Line = { kind: "theirs"; message: LoungeMessage } | { kind: "mine"; id: string; note: Required<Pick<NoteDraft, "text">> & { voice: boolean } };

function WaveCard() {
  const memory = useCommunity();
  const later = useLater();
  // Waves sent in this visit wait a moment for their wave back. Earlier waves already have one.
  const [waiting, setWaiting] = useState<PersonId[]>([]);
  const titleId = useId();
  const wave = (who: PersonId) => {
    if (memory.waves.includes(who)) return;
    communityStore.wave(who);
    setWaiting(list => [...list, who]);
    later(() => setWaiting(list => list.filter(other => other !== who)), 1500);
  };
  return (
    <section className="cm-card cm-side-card" aria-labelledby={titleId}>
      <div className="cm-card-row">
        <h3 className="cm-overline" id={titleId}>Wave hello</h3>
        <span className="cm-card-aside">Here right now</span>
      </div>
      <ul className="cm-wave-list">
        {lounge.waves.filter(({ who }) => !isBlocked(memory, who)).map(({ who, note }) => {
          const waved = memory.waves.includes(who);
          const back = waved && !waiting.includes(who);
          const name = people[who].name;
          return (
            <li key={who} className="cm-wave-row">
              <span className="cm-face-live"><Face who={who} size={44} /><span className="cm-online-dot cm-live" aria-hidden="true" /></span>
              <span className="cm-wave-text"><b>{name}</b><span className={back ? "is-back" : ""}>{back ? "Waved back!" : note}</span></span>
              <button type="button" className={`cm-wave ${waved ? "is-on" : ""}`} onClick={() => wave(who)} aria-disabled={waved || undefined}>
                <span className={`cm-wave-hand ${waiting.includes(who) ? "cm-wiggle" : ""}`}><HandIcon size={18} /></span>
                <span>{waved ? "Waved" : "Wave"}</span><span className="cm-sr">{` to ${name}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PollCard() {
  const vote = useCommunity().vote;
  const titleId = useId();
  const base = lounge.poll.options.reduce((sum, option) => sum + option.votes, 0);
  const total = base + (vote ? 1 : 0);
  return (
    <section className="cm-card cm-side-card" aria-labelledby={titleId}>
      <h3 className="cm-overline cm-overline-rust" id={titleId}>Tea-break poll</h3>
      <p className="cm-poll-question">{lounge.poll.question}</p>
      <div className="cm-poll" role="group" aria-labelledby={titleId}>
        {lounge.poll.options.map(option => {
          const count = option.votes + (vote === option.id ? 1 : 0);
          const share = vote ? Math.round((count * 100) / total) : 0;
          return (
            <button key={option.id} type="button" className={`cm-poll-option ${vote === option.id ? "is-on" : ""}`} aria-pressed={vote === option.id} onClick={() => communityStore.vote(option.id)}>
              <span className="cm-poll-bar" aria-hidden="true" style={{ width: `${share}%`, background: option.fill }} />
              <span className="cm-poll-label">{option.label}</span>
              {vote && <span className="cm-poll-share">{` ${share}%`}</span>}
            </button>
          );
        })}
      </div>
      <p className="cm-card-note">{vote ? `Thanks! ${total} people have voted` : "Tap one to see what everyone picked"}</p>
    </section>
  );
}

/**
 * F1: the lounge. Messages and people arrive while it is open; anyone can join in with a tap.
 * Messages from people the person has blocked or hidden are left out.
 */
export default function LoungeView({ active, here, onHere }: { active: boolean; here: number; onHere: (change: (here: number) => number) => void }) {
  const memory = useCommunity();
  const seated = memory.seated;
  // Blocked people are out of sight, their faces included.
  const faces = lounge.faces.filter(who => !isBlocked(memory, who));
  const [lines, setLines] = useState<Line[]>(() => lounge.messages.map(message => ({ kind: "theirs" as const, message })));
  const [step, setStep] = useState(0);
  const [typing, setTyping] = useState<PersonId | null>(null);
  const [toast, setToast] = useState<{ who: PersonId; text: string; n: number } | null>(null);
  const [sent, setSent] = useState(0);
  const [sentNote, setSentNote] = useState("");
  const { bursts, burst } = useBursts();
  const later = useLater();
  const { box, onScroll } = usePinnedToEnd<HTMLDivElement>(lines.length + (typing ? 0.5 : 0), active);

  // The room carries on while it is open: someone writes, a message arrives, someone comes in.
  useEffect(() => {
    if (!active || step >= lounge.script.length) return;
    const timer = window.setTimeout(() => {
      const event = lounge.script[step];
      setStep(step + 1);
      if (event.kind === "typing") setTyping(event.who);
      else if (event.kind === "message") {
        setTyping(null);
        setLines(list => [...list, { kind: "theirs", message: event.message }]);
      } else {
        setToast({ who: event.who, text: event.text, n: step });
        onHere(count => count + 1);
        later(() => setToast(current => (current?.n === step ? null : current)), 3200);
      }
    }, lounge.everyMs);
    return () => window.clearTimeout(timer);
  }, [active, step, onHere, later]);

  const send = (draft: NoteDraft) => {
    const text = draft.text.trim();
    if (!text) return;
    setLines(list => [...list, { kind: "mine", id: `mine-${sent}`, note: { text, voice: !!draft.voice } }]);
    setSent(count => count + 1);
    setSentNote(`Sent: ${text}`);
  };

  return (
    <div className="cm-layout">
      <section className="cm-card cm-chat" aria-labelledby="cm-lounge-title">
        {toast && canSee(memory, toast.who) && (
          <div key={toast.n} className="cm-toast" aria-hidden="true">
            <Face who={toast.who} size={32} /><span>{toast.text}</span>
          </div>
        )}
        <header className="cm-chat-head">
          <span className="cm-round-icon"><ChatIcon size={24} /></span>
          <div className="cm-chat-titles">
            <h2 id="cm-lounge-title" tabIndex={-1} data-view-heading>The lounge</h2>
            <p className="cm-live-line"><LiveDot /><span>{here} chatting now</span></p>
          </div>
          <span className="cm-face-stack cm-chat-faces" aria-hidden="true">
            {faces.map(who => <Face key={who} who={who} size={38} />)}
            <span className="cm-face-more">+{Math.max(0, here - faces.length)}</span>
          </span>
        </header>
        <div className="cm-starter">
          <AliraMark size={34} />
          <div>
            <p className="cm-overline cm-overline-dark">Alira's chat starter</p>
            <p className="cm-starter-text">{lounge.starter}</p>
          </div>
          <span className="cm-shine" aria-hidden="true" />
        </div>
        <div className="cm-chat-log" ref={box} onScroll={onScroll} role="log" aria-live="off" aria-label="Messages in the lounge" tabIndex={0}>
          <div className="cm-chat-fade" aria-hidden="true" />
          <ol className="cm-messages">
            {lines.filter(line => line.kind === "mine" || canSee(memory, line.message.who)).map(line => line.kind === "theirs"
              ? <TheirMessage key={line.message.id} message={line.message} heartKey={`lounge:${line.message.id}`} />
              : <MyMessage key={line.id} note={{ text: line.note.text, voice: line.note.voice, photo: null }} />)}
          </ol>
          {typing && canSee(memory, typing) && <TypingRow who={typing} />}
        </div>
        <FloatingHearts bursts={bursts} className="cm-hearts-chat" />
        <div className="cm-chat-foot">
          <div className="cm-quick-row" role="group" aria-label="Quick replies">
            {lounge.quickReplies.map(reply => <button key={reply.label} type="button" className={`cm-quick ${toneClass(reply.tone)}`} onClick={() => send({ text: reply.text })}>{reply.label}</button>)}
            <button type="button" className="cm-love" aria-label="Send a heart" onClick={burst}><HeartIcon size={22} fill="currentColor" strokeWidth={1.6} /></button>
          </div>
          <ChatInput label="Say something to the lounge" placeholder="Say something to the lounge" onSend={send} />
          <p className="cm-sr" role="status">{sentNote}</p>
        </div>
      </section>

      <div className="cm-side">
        <WaveCard />
        <PollCard />
        <Link className="cm-circle-link" href={communityHref("circle")}>
          <span className="cm-circle-link-icon"><RingIcon size={24} /></span>
          <span className="cm-circle-link-text"><b>Sunday circle is open</b><span>{seated ? "Your seat is kept for you" : "A seat is waiting for you"}</span></span>
          <NextIcon size={20} />
        </Link>
      </div>
    </div>
  );
}
