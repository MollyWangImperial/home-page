import { useEffect, useId, useReducer, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "wouter";
import { TypedChatText } from "@/components/TypedChatText";
import { circle, people, type CircleSeat } from "@/content/community-samples";
import { communityHref, communityStore, useCommunity } from "@/lib/community-store";
import { useBursts, useLater, usePinnedToEnd } from "./hooks";
import { CupIcon, HeartIcon, PauseIcon, PlayIcon, PlusIcon, PulseIcon } from "./icons";
import { AliraMark, Face, FloatingHearts, LiveDot, MyFace, OnlyYou } from "./parts";

type Said = { id: number; who: CircleSeat; text: string };
type CircleState = { at: number; said: Said[]; waiting: boolean; next: number };
type CircleAction = { type: "advance"; seated: boolean } | { type: "speak"; text: string };

const start: CircleState = { at: 0, said: [{ id: 0, who: "alira", text: circle.lines.alira }], waiting: false, next: 1 };

/** The next one to hold the teacup. Your place is skipped until you have sat down. */
function nextSeat(at: number, seated: boolean): number {
  let index = at;
  do { index = (index + 1) % circle.order.length; } while (circle.order[index] === "you" && !seated);
  return index;
}

function goRound(state: CircleState, action: CircleAction): CircleState {
  if (action.type === "speak") {
    const line: Said = { id: state.next, who: "you", text: action.text };
    return { ...state, waiting: false, next: state.next + 1, said: [...state.said, line].slice(-30) };
  }
  const at = nextSeat(state.at, action.seated);
  const who = circle.order[at];
  // When the cup reaches you, it waits for you.
  if (who === "you") return { ...state, at, waiting: true };
  return { ...state, at, waiting: false, next: state.next + 1, said: [...state.said, { id: state.next, who, text: circle.lines[who] }].slice(-30) };
}

const seatsInPlace = (Object.keys(circle.seats) as CircleSeat[]).sort((a, b) => circle.seats[a] - circle.seats[b]);
const angleOf = (who: CircleSeat) => ((-90 + circle.seats[who] * 36) * Math.PI) / 180;
const place = (who: CircleSeat) => ({ "--cos": Math.cos(angleOf(who)).toFixed(4), "--sin": Math.sin(angleOf(who)).toFixed(4) }) as unknown as CSSProperties;
const nameOf = (who: CircleSeat) => (who === "alira" ? "Alira" : who === "you" ? "You" : people[who].name);

function Upcoming() {
  const reminders = useCommunity().reminders;
  const titleId = useId();
  return (
    <section className="cm-card cm-side-card cm-upcoming" aria-labelledby={titleId}>
      <h3 className="cm-overline" id={titleId}>Circles this week</h3>
      <ul className="cm-upcoming-list">
        {circle.upcoming.map(item => {
          const on = reminders.includes(item.id);
          return (
            <li key={item.id}>
              <span className="cm-upcoming-text"><b>{item.name}</b><span>{item.when}</span></span>
              <button type="button" className={`cm-remind ${on ? "is-on" : ""}`} onClick={() => communityStore.toggleReminder(item.id)}>
                {on ? "Reminder set" : "Remind me"}<span className="cm-sr">{` for the ${item.name}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="cm-card-note">Reminders stay on this page for now. Rehyn won't send them yet.</p>
      <div className="cm-upcoming-links">
        <Link className="cm-pill-link cm-pill-rose" href={communityHref("lounge")}>The lounge</Link>
        <Link className="cm-pill-link cm-pill-mint" href={communityHref("groups")}>My groups</Link>
      </div>
    </section>
  );
}

/** F2: the Sunday circle. A teacup goes round; whoever holds it speaks. Take your seat and it comes to you. */
export default function CircleView({ active, name }: { active: boolean; name: string }) {
  const seated = useCommunity().seated;
  const [state, dispatch] = useReducer(goRound, start);
  const [held, setHeld] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [words, setWords] = useState("");
  const { bursts, burst } = useBursts();
  const later = useLater();
  const warmSeen = useRef(0);
  const warmth = useRef<HTMLButtonElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const { box, onScroll } = usePinnedToEnd<HTMLOListElement>(state.said.length, active);
  // When the button that was pressed goes away, the focus moves to the one that takes its place.
  const focusSoon = (target: { current: HTMLElement | null }) => window.requestAnimationFrame(() => target.current?.focus());

  const speaker = circle.order[state.at];
  const myTurn = seated && speaker === "you" && state.waiting;

  useEffect(() => {
    if (!active || state.waiting || held) return;
    const timer = window.setInterval(() => dispatch({ type: "advance", seated }), circle.everyMs);
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
  const pass = () => { dispatch({ type: "advance", seated }); focusSoon(warmth); };
  const share = (event: FormEvent) => { event.preventDefault(); speak(words); };

  const bubbleFor = speaker !== "you" ? speaker : null;
  const lastSaid = state.said[state.said.length - 1];

  return (
    <div className="cm-circle-view">
      <section className="cm-stage" aria-labelledby="cm-circle-title">
        <div className="cm-stage-head">
          <div>
            <h2 id="cm-circle-title" tabIndex={-1} data-view-heading>Sunday circle</h2>
            <p>{seated ? `Ten of us now. Welcome, ${name}.` : "Nine of us here. One seat is yours."}</p>
          </div>
          <div className="cm-stage-tools">
            <p className="cm-stage-rule"><CupIcon size={18} /><span>The teacup goes round. Whoever holds it speaks.</span></p>
            <button type="button" className="cm-stage-pause" onClick={() => setHeld(!held)}>
              {held ? <PlayIcon size={16} /> : <PauseIcon size={16} />}<span>{held ? "Let it go round" : "Pause the teacup"}</span>
            </button>
          </div>
        </div>

        <div className="cm-ring-area">
          <span className="cm-ring-glow cm-glow" aria-hidden="true" />
          <span className="cm-ring-line" aria-hidden="true" />
          <div className="cm-topic">
            <span>Today's topic</span>
            <p>{circle.topic}</p>
          </div>
          <ul className="cm-seats" aria-label="Who is in the circle">
            {seatsInPlace.map(who => {
              const speaking = who === speaker && (who !== "you" || seated);
              const empty = who === "you" && !seated;
              return (
                <li key={who} className={`cm-seat ${speaking ? "is-speaking" : ""} ${empty ? "is-empty" : ""}`} style={place(who)}>
                  {speaking && <span className="cm-seat-speak" aria-hidden="true" />}
                  {who === "alira" ? <AliraMark size={60} light className="cm-seat-face" />
                    : who === "you" ? (seated ? <MyFace size={60} className="cm-seat-face cm-seat-person" />
                      : <button type="button" className="cm-empty-seat cm-seat-face" tabIndex={-1} aria-hidden="true" onClick={sit}><span className="cm-seat-pulse" /><span className="cm-empty-plus"><PlusIcon size={24} strokeWidth={2} /></span></button>)
                      : <Face who={who} size={60} className="cm-seat-face cm-seat-person" />}
                  {speaking && <span className="cm-seat-cup cm-pop" aria-hidden="true"><CupIcon size={16} strokeWidth={2.2} /></span>}
                  <span className="cm-seat-name">
                    {who === "alira" ? "Alira · host" : who === "you" ? (seated ? "You" : <span className="cm-sr">An empty seat, kept for you</span>) : people[who].name}
                    {speaking && <span className="cm-sr">{who === "you" ? " have the teacup" : " has the teacup"}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {bubbleFor && lastSaid && lastSaid.who === bubbleFor && (
            <div key={lastSaid.id} className={`cm-speech ${Math.sin(angleOf(bubbleFor)) < -0.01 ? "is-below" : "is-above"}`} style={place(bubbleFor)} aria-hidden="true">
              <div className="cm-speech-inner cm-pop"><strong>{nameOf(bubbleFor)}</strong>{lastSaid.text}</div>
            </div>
          )}
          <FloatingHearts bursts={bursts} className="cm-hearts-stage" />
        </div>

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
          {seated && !myTurn && <button ref={warmth} type="button" className="cm-warmth" onClick={burst}><HeartIcon size={20} fill="#E8795A" stroke="#E8795A" strokeWidth={1.6} /><span>Send warmth</span></button>}
          <p className="cm-sr" role="status">{myTurn ? "You have the teacup. Say hello, share your week, or pass the cup." : ""}</p>
        </div>
      </section>

      <div className="cm-circle-bottom">
        <section className="cm-card cm-said" aria-labelledby="cm-said-title">
          <div className="cm-card-row">
            <h3 id="cm-said-title">Said in the circle</h3>
            <span className="cm-online-line"><LiveDot tone="green" />{seated ? 10 : 9} here</span>
          </div>
          <ol className="cm-said-list" ref={box} onScroll={onScroll} tabIndex={0} aria-label="What has been said">
            {state.said.map(line => (
              <li key={line.id} className="cm-said-line cm-msg-in">
                {line.who === "alira" ? <span className="cm-said-alira" aria-hidden="true"><PulseIcon size={18} /></span>
                  : line.who === "you" ? <MyFace size={32} /> : <Face who={line.who} size={32} />}
                <div className="cm-said-text">
                  <strong>{nameOf(line.who)}</strong>{" "}
                  {line.who === "alira" ? <TypedChatText text={line.text} /> : <span>{line.text}</span>}
                  {line.who === "you" && <OnlyYou className="cm-only-you-inline" />}
                </div>
              </li>
            ))}
          </ol>
        </section>
        <Upcoming />
      </div>
    </div>
  );
}
