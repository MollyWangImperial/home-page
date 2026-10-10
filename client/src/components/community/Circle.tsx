import { useEffect, useId, useReducer, useRef, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { TypedChatText } from "@/components/TypedChatText";
import { circle, people, type CircleSeat, type PersonId } from "@/content/community-samples";
import { canSee, communityHref, communityStore, isBlocked, useCommunity } from "@/lib/community-store";
import { calendarPage, downloadIcs, googleCalendarUrl, nextMeeting, openCalendar, outlookCalendarUrl } from "./circle-calendar";
import { useBursts, useLater, usePinnedToEnd } from "./hooks";
import { CalendarIcon, CheckIcon, CupIcon, DownloadIcon, HeartIcon, NextIcon, PauseIcon, PlayIcon, PlusIcon, PulseIcon } from "./icons";
import { AliraMark, Face, FloatingHearts, LiveDot, MyFace } from "./parts";

type Said = { id: number; who: CircleSeat; text: string };
type CircleState = { at: number; said: Said[]; waiting: boolean; next: number };
/** "advance" passes the teacup on, past `skip`: people the person has blocked or hidden. */
type CircleAction = { type: "advance"; seated: boolean; skip: CircleSeat[] } | { type: "speak"; text: string };

const start: CircleState = { at: 0, said: [{ id: 0, who: "alira", text: circle.lines.alira }], waiting: false, next: 1 };

/** The next one to hold the teacup. Your place is skipped until you have sat down, and so is anyone in `skip`. */
function nextSeat(at: number, seated: boolean, skip: CircleSeat[]): number {
  let index = at;
  for (let step = 0; step < circle.order.length; step++) {
    index = (index + 1) % circle.order.length;
    const who = circle.order[index];
    if ((who !== "you" || seated) && !skip.includes(who)) return index;
  }
  // Alira hosts and is never skipped, so the cup always finds her.
  return Math.max(0, circle.order.indexOf("alira"));
}

function goRound(state: CircleState, action: CircleAction): CircleState {
  if (action.type === "speak") {
    const line: Said = { id: state.next, who: "you", text: action.text };
    return { ...state, waiting: false, next: state.next + 1, said: [...state.said, line].slice(-30) };
  }
  const at = nextSeat(state.at, action.seated, action.skip);
  const who = circle.order[at];
  // When the cup reaches you, it waits for you.
  if (who === "you") return { ...state, at, waiting: true };
  return { ...state, at, waiting: false, next: state.next + 1, said: [...state.said, { id: state.next, who, text: circle.lines[who] }].slice(-30) };
}

const nameOf = (who: CircleSeat) => (who === "alira" ? "Alira" : who === "you" ? "You" : people[who].name);
const isPerson = (who: CircleSeat): who is PersonId => who !== "alira" && who !== "you";
const COUNT_WORDS = ["No one", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
/** "Nine", for "Nine of us here". */
const countWord = (count: number) => COUNT_WORDS[count] ?? String(count);

/** "Coming up": the circles this week, each on a little calendar page, with a reminder for the person's own calendar. */
function ComingUp() {
  const reminders = useCommunity().reminders;
  const titleId = useId();
  const now = new Date();
  return (
    <section className="cm-card cm-side-card cm-upcoming" aria-labelledby={titleId}>
      <h3 className="cm-side-title" id={titleId}>Coming up</h3>
      <ul className="cm-upcoming-list">
        {circle.upcoming.map(item => {
          const on = reminders.includes(item.id);
          const when = nextMeeting(item, now);
          const page = calendarPage(when);
          const origin = typeof window === "undefined" ? "" : window.location.origin;
          return (
            <li key={item.id} className={on ? "is-on" : ""}>
              <div className="cm-upcoming-row">
                <span className="cm-date-page" aria-hidden="true"><span>{page.day}</span><b>{page.date}</b></span>
                <span className="cm-upcoming-text"><b>{item.name}</b><span>{`${item.when} · ${item.detail}`}</span></span>
                <button type="button" className={`cm-remind ${on ? "is-on" : ""}`} aria-pressed={on} onClick={() => communityStore.toggleReminder(item.id)}>
                  {on ? <><CheckIcon size={14} />Reminded</> : "Remind me"}<span className="cm-sr">{` for the ${item.name}`}</span>
                </button>
              </div>
              {on && (
                <div className="cm-calendar-row cm-pop" role="group" aria-label={`Add the ${item.name} to your calendar`}>
                  <span className="cm-calendar-label"><CalendarIcon size={16} />Add to your calendar</span>
                  <button type="button" className="cm-calendar-button" onClick={() => openCalendar(googleCalendarUrl(item, when, origin))}>Google<span className="cm-sr"> Calendar, opens in a new tab</span></button>
                  <button type="button" className="cm-calendar-button" onClick={() => openCalendar(outlookCalendarUrl(item, when, origin))}>Outlook<span className="cm-sr">, opens in a new tab</span></button>
                  <button type="button" className="cm-calendar-button" onClick={() => downloadIcs(item, when)}><DownloadIcon size={14} />Apple and others<span className="cm-sr">: save a calendar file</span></button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="cm-card-note">Press Remind me, then add the circle to your own calendar. It repeats weekly and reminds you half an hour before.</p>
    </section>
  );
}

/**
 * F2: the Sunday circle. A teacup goes round; whoever holds it speaks, and their words show as live
 * captions. Take your seat and it comes to you. Someone the person has blocked is out of sight:
 * their chair stands empty. Nobody blocked or hidden holds the teacup, and what they said isn't shown.
 */
export default function CircleView({ active, name }: { active: boolean; name: string }) {
  const memory = useCommunity();
  const seated = memory.seated;
  const away = (who: CircleSeat) => isPerson(who) && isBlocked(memory, who);
  const heard = (who: CircleSeat) => !isPerson(who) || canSee(memory, who);
  const skip = circle.order.filter(who => !heard(who));
  // The teacup's timer reads who to skip as it is now.
  const skipNow = useRef(skip);
  skipNow.current = skip;
  const [state, dispatch] = useReducer(goRound, start);
  const saidShown = state.said.filter(line => heard(line.who));
  const [held, setHeld] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [words, setWords] = useState("");
  const { bursts, burst } = useBursts();
  const later = useLater();
  const warmSeen = useRef(0);
  const warmth = useRef<HTMLButtonElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const { box, onScroll } = usePinnedToEnd<HTMLOListElement>(saidShown.length, active);
  // When the button that was pressed goes away, the focus moves to the one that takes its place.
  const focusSoon = (target: { current: HTMLElement | null }) => window.requestAnimationFrame(() => target.current?.focus());

  const speaker = circle.order[state.at];
  const upNext = circle.order[nextSeat(state.at, seated, skip)];
  const myTurn = seated && speaker === "you" && state.waiting;
  // Alira and everyone still in sight, then you once you have sat down.
  const present = circle.order.filter(who => who !== "you" && !away(who)).length + (seated ? 1 : 0);

  useEffect(() => {
    if (!active || state.waiting || held) return;
    const timer = window.setInterval(() => dispatch({ type: "advance", seated, skip: skipNow.current }), circle.everyMs);
    return () => window.clearInterval(timer);
  }, [active, state.waiting, held, seated]);

  // A little warmth floats up when some lines are said, and when you arrive having just sat down.
  useEffect(() => {
    const last = state.said[state.said.length - 1];
    if (last && last.id > warmSeen.current && circle.warmLines.includes(last.who)) { warmSeen.current = last.id; burst(); }
  }, [state.said, burst]);
  useEffect(() => { if (active && communityStore.justSeated()) burst(); }, [active, burst]);
  useEffect(() => { if (!myTurn) setSharing(false); }, [myTurn]);

  const sit = () => { communityStore.takeSeat(); burst(); focusSoon(warmth); };
  const speak = (text: string) => {
    const said = text.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!said) return;
    dispatch({ type: "speak", text: said });
    setSharing(false);
    setWords("");
    burst();
    later(burst, 500);
    focusSoon(warmth);
  };
  const pass = () => { dispatch({ type: "advance", seated, skip }); focusSoon(warmth); };
  const share = (event: FormEvent) => { event.preventDefault(); speak(words); };

  const lastSaid = saidShown[saidShown.length - 1];
  const status = (who: CircleSeat) => {
    const doing = who === speaker ? "Speaking" : who === upNext ? "Up next" : "Listening";
    return who === "alira" ? (doing === "Listening" ? "Host" : `Host · ${doing.toLowerCase()}`) : doing;
  };

  return (
    <div className="cm-circle-view">
      <section className="cm-card cm-stage" aria-labelledby="cm-circle-title">
        <span className="cm-stage-rings" aria-hidden="true"><i /><i /><i /></span>
        <div className="cm-stage-head">
          <div className="cm-stage-titles">
            <p className="cm-stage-live"><LiveDot /><span>Live</span><span aria-hidden="true">·</span><span>Hosted by Alira</span></p>
            <h2 id="cm-circle-title" tabIndex={-1} data-view-heading>Sunday circle</h2>
            <p className="cm-stage-sub">{seated ? `${countWord(present)} of us now. Welcome, ${name}.` : `${countWord(present)} of us here. One seat is yours.`}</p>
          </div>
          <div className="cm-topic">
            <p className="cm-overline cm-overline-gold">Today's topic</p>
            <p className="cm-topic-text">{circle.topic}</p>
          </div>
        </div>
        <p className="cm-stage-rule"><CupIcon size={18} /><span>The teacup goes round. Whoever holds it speaks.</span></p>

        <ul className="cm-seats" aria-label="Who is in the circle">
          {circle.order.map(who => {
            if (away(who)) return <li key={who} className="cm-seat is-away" aria-hidden="true"><span className="cm-seat-ring"><span className="cm-seat-away" /></span></li>;
            const speaking = who === speaker && (who !== "you" || seated) && heard(who);
            const empty = who === "you" && !seated;
            const next = !speaking && who === upNext;
            return (
              <li key={who} className={`cm-seat ${speaking ? "is-speaking" : ""} ${next ? "is-next" : ""} ${empty ? "is-empty" : ""}`}>
                <span className="cm-seat-ring">
                  {speaking && <span className="cm-seat-speak" aria-hidden="true" />}
                  {who === "alira" ? <AliraMark size={64} className="cm-seat-face" />
                    : who === "you" ? (seated ? <MyFace size={64} className="cm-seat-face" />
                      : <button type="button" className="cm-empty-seat cm-seat-face" tabIndex={-1} aria-hidden="true" onClick={sit}><span className="cm-empty-plus"><PlusIcon size={22} strokeWidth={2} /></span></button>)
                      : <Face who={who} size={64} className="cm-seat-face" />}
                  {speaking && <span className="cm-seat-cup cm-pop" aria-hidden="true"><CupIcon size={14} strokeWidth={2.2} /></span>}
                </span>
                {empty ? (
                  <span className="cm-seat-name"><b>Your seat</b><span>Kept for you</span><span className="cm-sr">: an empty seat, kept for you</span></span>
                ) : (
                  <span className="cm-seat-name">
                    <b>{nameOf(who)}</b>
                    <span className="cm-seat-status">{status(who)}</span>
                    {speaking && <span className="cm-sr">{who === "you" ? " have the teacup" : " has the teacup"}</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {/* What is said is written out for everyone in "Said in the circle" below; these captions are the same words, for the eye. */}
        {captions && lastSaid && (
          <div className="cm-captions" aria-hidden="true">
            <p className="cm-captions-label">{`Live captions · ${nameOf(lastSaid.who)}`}</p>
            <p key={lastSaid.id} className="cm-captions-text cm-pop">{lastSaid.who === "alira" ? <TypedChatText text={lastSaid.text} /> : lastSaid.text}</p>
          </div>
        )}
        <FloatingHearts bursts={bursts} className="cm-hearts-stage" />

        <div className="cm-stage-controls">
          {!seated && <button type="button" className="cm-btn cm-btn-rust cm-btn-glow" onClick={sit}>Take your seat</button>}
          {myTurn && !sharing && (
            <div className="cm-turn cm-pop">
              <span className="cm-turn-label">You have the teacup</span>
              <button type="button" className="cm-quick cm-quick-mint" onClick={() => speak(circle.hello)}>Say hello</button>
              <button ref={shareButton} type="button" className="cm-quick cm-quick-amber" onClick={() => { setSharing(true); focusSoon(firstChoice); }}>Share my week</button>
              <button type="button" className="cm-quick cm-quick-plain" onClick={pass}>Pass the cup</button>
            </div>
          )}
          {myTurn && sharing && (
            <form className="cm-turn cm-share cm-pop" onSubmit={share}>
              <span className="cm-turn-label">What are you looking forward to?</span>
              <span className="cm-share-choices">
                {circle.shareChoices.map((choice, index) => <button key={choice} ref={index === 0 ? firstChoice : undefined} type="button" className="cm-quick cm-quick-amber" onClick={() => speak(choice)}>{choice.replace(/\.$/, "")}</button>)}
              </span>
              <span className="cm-share-own">
                <label className="cm-chat-field"><span className="cm-sr">Or say it in your own words</span><input type="text" value={words} maxLength={200} placeholder="Or in your own words" autoComplete="off" onChange={event => setWords(event.target.value)} /></label>
                <button type="submit" className="cm-quick cm-quick-mint">Say it</button>
                <button type="button" className="cm-quick cm-quick-plain" onClick={() => { setSharing(false); focusSoon(shareButton); }}>Back</button>
              </span>
            </form>
          )}
          {seated && !myTurn && <button ref={warmth} type="button" className="cm-stage-button is-warm" onClick={burst}><HeartIcon size={18} fill="#E8795A" stroke="#E8795A" strokeWidth={1.6} /><span>Send warmth</span></button>}
          <button type="button" className={`cm-stage-button ${captions ? "is-on" : ""}`} aria-pressed={captions} onClick={() => setCaptions(!captions)}>{captions ? "Captions on" : "Captions off"}</button>
          <button type="button" className="cm-stage-button" onClick={() => setHeld(!held)}>
            {held ? <PlayIcon size={14} /> : <PauseIcon size={14} />}<span>{held ? "Let it go round" : "Pause the teacup"}</span>
          </button>
          {!myTurn && <button type="button" className="cm-stage-button" onClick={pass}><span>Next speaker</span><NextIcon size={16} /></button>}
          <Link className="cm-stage-button" href={communityHref()} onClick={() => communityStore.leaveSeat()}>Leave quietly</Link>
          <p className="cm-sr" role="status">{myTurn ? "You have the teacup. Say hello, share your week, or pass the cup." : ""}</p>
        </div>
      </section>

      <div className="cm-circle-bottom">
        <section className="cm-card cm-said" aria-labelledby="cm-said-title">
          <div className="cm-card-row">
            <h3 className="cm-side-title" id="cm-said-title">Said in the circle</h3>
            <span className="cm-card-aside">Not kept after the circle ends</span>
          </div>
          <ol className="cm-said-list" ref={box} onScroll={onScroll} tabIndex={0} aria-label="What has been said">
            {saidShown.map(line => (
              <li key={line.id} className="cm-said-line cm-msg-in">
                {line.who === "alira" ? <span className="cm-said-alira" aria-hidden="true"><PulseIcon size={16} /></span>
                  : line.who === "you" ? <MyFace size={32} /> : <Face who={line.who} size={32} />}
                <div className="cm-said-text">
                  <strong>{nameOf(line.who)}</strong>
                  {line.who === "alira" ? <TypedChatText text={line.text} /> : <span>{line.text}</span>}
                </div>
              </li>
            ))}
          </ol>
        </section>
        <ComingUp />
      </div>
    </div>
  );
}
