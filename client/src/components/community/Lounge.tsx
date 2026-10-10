import { useEffect, useId, useRef, useState } from "react";
import { Link } from "wouter";
import { CIRCLE_SEATS, lounge, people, type LoungeMessage, type PersonId } from "@/content/community-samples";
import { canSee, circleSeatsTaken, clockLabel, communityHref, communityStore, isBlocked, useCommunity, type NoteDraft } from "@/lib/community-store";
import { useBursts, useLater, usePinnedToEnd } from "./hooks";
import { CloseIcon, HandIcon, HeartIcon, PulseIcon } from "./icons";
import { OnlineFace } from "./Messages";
import { ChatInput, Face, FloatingHearts, LiveDot, MyFace, toneClass, TypingRow, VoiceNote } from "./parts";

/** A line in the lounge: someone's message (with when it was said), or the person's own. */
type Line =
  | { kind: "theirs"; at: number; message: LoungeMessage }
  | { kind: "mine"; at: number; id: string; text: string; voice: boolean; to: PersonId | null };

/** Someone's message: who and when, the words, then a heart and Reply. */
function LoungeLine({ message, at, onReply }: { message: LoungeMessage; at: number; onReply: (who: PersonId) => void }) {
  const memory = useCommunity();
  const heartKey = `lounge:${message.id}`;
  const on = memory.hearts.includes(heartKey);
  const counts = memory.settings.showHeartCounts;
  const hearts = message.hearts + (on ? 1 : 0);
  const name = people[message.who].name;
  return (
    <li className="cm-lounge-line cm-msg-in">
      <Face who={message.who} size={44} />
      <div className="cm-lounge-body">
        <p className="cm-lounge-meta">
          <b>{name}</b>
          {message.note && <span className="cm-new-pill">{message.note}</span>}
          <span className="cm-lounge-time">{clockLabel(at)}</span>
        </p>
        {message.photo && <img className="cm-lounge-photo" src={message.photo.src} alt={message.photo.alt} style={{ backgroundColor: message.photo.tint }} loading="lazy" />}
        <p className="cm-lounge-text">{message.text}</p>
        <div className="cm-lounge-acts">
          <button type="button" className={`cm-lounge-heart ${on ? "is-on" : ""}`} aria-pressed={on} aria-label={`Heart for ${name}'s message${counts ? `, ${hearts}` : ""}`} onClick={() => communityStore.toggleHeart(heartKey)}>
            <HeartIcon size={16} fill={on ? "#E8795A" : "none"} strokeWidth={2} />{counts && <span aria-hidden="true">{hearts}</span>}
          </button>
          <button type="button" className="cm-lounge-reply" onClick={() => onReply(message.who)}>Reply<span className="cm-sr">{` to ${name}`}</span></button>
        </div>
      </div>
    </li>
  );
}

/** "Here right now": who is in the lounge, with a wave for each. A wave can't be taken back, like a real one. */
function HereNow() {
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
        <h3 className="cm-side-title" id={titleId}>Here right now</h3>
        <span className="cm-card-aside">Wave to say hello</span>
      </div>
      <ul className="cm-wave-list">
        {lounge.waves.filter(({ who }) => !isBlocked(memory, who)).map(({ who, note }) => {
          const waved = memory.waves.includes(who);
          const back = waved && !waiting.includes(who);
          const name = people[who].name;
          return (
            <li key={who} className="cm-wave-row">
              <OnlineFace who={who} size={44} online />
              <span className="cm-wave-text"><b>{name}</b><span className={back ? "is-back" : ""}>{back ? "Waved back!" : note}</span></span>
              <button type="button" className={`cm-wave ${waved ? "is-on" : ""}`} onClick={() => wave(who)} aria-disabled={waved || undefined}>
                <span className={`cm-wave-hand ${waiting.includes(who) ? "cm-wiggle" : ""}`}><HandIcon size={16} /></span>
                <span>{waved ? "Waved" : "Wave"}</span><span className="cm-sr">{` to ${name}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HouseRules() {
  const titleId = useId();
  return (
    <section className="cm-card cm-side-card" aria-labelledby={titleId}>
      <h3 className="cm-side-title" id={titleId}>House rules</h3>
      <ol className="cm-rules">
        {lounge.rules.map((rule, index) => <li key={rule}><span className="cm-rule-number" aria-hidden="true">{index + 1}</span><span>{rule}</span></li>)}
      </ol>
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

/** The Sunday circle, beside the lounge: how full it is, and the way in. */
export function CircleNote() {
  const memory = useCommunity();
  const taken = circleSeatsTaken(memory);
  return (
    <section className="cm-circle-note" aria-labelledby="cm-circle-note-title">
      <div>
        <h3 id="cm-circle-note-title">Sunday circle</h3>
        <p>{`Live now · ${taken} of ${CIRCLE_SEATS} seats taken`}</p>
      </div>
      <Link className="cm-btn cm-btn-gold" href={communityHref("circle")}>Open<span className="cm-sr"> the Sunday circle</span></Link>
    </section>
  );
}

/**
 * F1: the lounge. Messages and people arrive while it is open; anyone can join in with a tap, give
 * a message a heart, or reply to someone. Messages from people the person has blocked or hidden
 * are left out, and so are quick replies to them.
 */
export default function LoungeView({ active, here, onHere }: { active: boolean; here: number; onHere: (change: (here: number) => number) => void }) {
  const memory = useCommunity();
  // Blocked people are out of sight, their faces included.
  const faces = lounge.faces.filter(who => !isBlocked(memory, who));
  const [lines, setLines] = useState<Line[]>(() => lounge.messages.map(message => ({ kind: "theirs" as const, at: communityStore.visitStart - (message.minutesAgo ?? 0) * 60_000, message })));
  const [step, setStep] = useState(0);
  const [typing, setTyping] = useState<PersonId | null>(null);
  const [toast, setToast] = useState<{ who: PersonId; text: string; n: number } | null>(null);
  const [replyTo, setReplyTo] = useState<PersonId | null>(null);
  const [sent, setSent] = useState(0);
  const [sentNote, setSentNote] = useState("");
  const room = useRef<HTMLElement>(null);
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
        setLines(list => [...list, { kind: "theirs", at: Date.now(), message: event.message }]);
      } else {
        setToast({ who: event.who, text: event.text, n: step });
        onHere(count => count + 1);
        later(() => setToast(current => (current?.n === step ? null : current)), 3200);
      }
    }, lounge.everyMs);
    return () => window.clearTimeout(timer);
  }, [active, step, onHere, later]);

  const field = () => room.current?.querySelector<HTMLInputElement>(".cm-chat-field input") ?? null;
  const reply = (who: PersonId) => { setReplyTo(who); window.requestAnimationFrame(() => field()?.focus()); };
  const send = (draft: NoteDraft) => {
    const text = draft.text.trim();
    if (!text) return;
    setLines(list => [...list, { kind: "mine", at: Date.now(), id: `mine-${sent}`, text, voice: !!draft.voice, to: replyTo }]);
    setSent(count => count + 1);
    setSentNote(replyTo ? `Sent to ${people[replyTo].name}: ${text}` : `Sent: ${text}`);
    setReplyTo(null);
  };
  const replyName = replyTo && canSee(memory, replyTo) ? people[replyTo].name : null;

  return (
    <div className="cm-layout cm-lounge">
      <section ref={room} className="cm-card cm-chat cm-lounge-room" aria-labelledby="cm-lounge-title">
        {toast && canSee(memory, toast.who) && (
          <div key={toast.n} className="cm-toast" aria-hidden="true">
            <Face who={toast.who} size={32} /><span>{toast.text}</span>
          </div>
        )}
        <header className="cm-lounge-head">
          <div className="cm-lounge-titles">
            <h2 id="cm-lounge-title" tabIndex={-1} data-view-heading>The lounge</h2>
            <p className="cm-live-line"><LiveDot /><span>{`${here} people here now`}</span><span className="cm-live-soft">· Open to everyone in the community</span></p>
          </div>
          <span className="cm-face-stack cm-chat-faces" aria-hidden="true">
            {faces.map(who => <Face key={who} who={who} size={40} />)}
            <span className="cm-face-more">+{Math.max(0, here - faces.length)}</span>
          </span>
        </header>
        <div className="cm-starter">
          <span className="cm-starter-mark" aria-hidden="true"><PulseIcon size={20} /></span>
          <div>
            <p className="cm-overline cm-overline-gold">Today's conversation starter from Alira</p>
            <p className="cm-starter-text">{lounge.starter}</p>
          </div>
        </div>
        <div className="cm-chat-log" ref={box} onScroll={onScroll} role="log" aria-live="off" aria-label="Messages in the lounge" tabIndex={0}>
          <div className="cm-chat-fade" aria-hidden="true" />
          <ol className="cm-messages cm-lounge-lines">
            <li className="cm-lounge-day" aria-hidden="true"><span>Today</span></li>
            {lines.map(line => {
              if (line.kind === "theirs") return canSee(memory, line.message.who) ? <LoungeLine key={line.message.id} message={line.message} at={line.at} onReply={reply} /> : null;
              const to = line.to && canSee(memory, line.to) ? people[line.to].name : null;
              return (
                <li key={line.id} className="cm-lounge-line is-mine cm-msg-in">
                  <MyFace size={44} />
                  <div className="cm-lounge-body">
                    <p className="cm-lounge-meta"><b>You</b><span className="cm-lounge-time">{clockLabel(line.at)}</span></p>
                    {to && <p className="cm-lounge-to">{`Replying to ${to}`}</p>}
                    {line.voice ? <VoiceNote words={line.text} label="your voice note" wordsClassName="cm-lounge-text" /> : <p className="cm-lounge-text">{line.text}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          {typing && canSee(memory, typing) && <TypingRow who={typing} />}
        </div>
        <FloatingHearts bursts={bursts} className="cm-hearts-chat" />
        <div className="cm-chat-foot cm-lounge-foot">
          {replyName && (
            <p className="cm-lounge-replying">
              <span>{`Replying to ${replyName}`}</span>
              <button type="button" className="cm-dm-icon" aria-label={`Stop replying to ${replyName}`} onClick={() => { setReplyTo(null); field()?.focus(); }}><CloseIcon size={14} /></button>
            </p>
          )}
          <div className="cm-quick-row" role="group" aria-label="Quick replies">
            {lounge.quickReplies.filter(item => !item.to || canSee(memory, item.to)).map(item => <button key={item.label} type="button" className={`cm-quick cm-quick-chip ${toneClass(item.tone)}`} onClick={() => send({ text: item.text })}>{item.label}</button>)}
            <button type="button" className="cm-love" aria-label="Send a heart" onClick={burst}><HeartIcon size={20} fill="currentColor" strokeWidth={1.6} /></button>
          </div>
          <ChatInput label={replyName ? `Reply to ${replyName}` : "Say something to the lounge"} placeholder={replyName ? `Reply to ${replyName}` : "Say something to the lounge"} onSend={send} sendText="Send" />
          <p className="cm-sr" role="status">{sentNote}</p>
        </div>
      </section>

      <div className="cm-side">
        <HereNow />
        <HouseRules />
        <CircleNote />
        <PollCard />
      </div>
    </div>
  );
}
