import { useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  CirclePlay,
  Heart,
  Music2,
  Plus,
  Send,
  Sparkles,
  Volume2,
} from "lucide-react";
import RecoveryShell from "@/components/RecoveryShell";

const people = [
  { initial: "S", name: "Sarah", copy: "sent you a cheer for your five day streak.", detail: "So proud of you, Mum.", time: "Two hours ago", action: "Cheer back", kind: "cheer" },
  { initial: "T", name: "Tom", copy: "left you a voice note.", detail: "", time: "Yesterday", action: "Play 0:21", kind: "voice" },
  { initial: "P", name: "Priya", copy: "loved your win: opened a jar of jam on my own.", detail: "", time: "Saturday", action: "Say thanks", kind: "thanks" },
];
const sounds = [
  ["Rain on the window", "20 minutes"],
  ["Morning birdsong", "15 minutes"],
  ["Waves at dusk", "30 minutes"],
  ["A crackling fire", "20 minutes"],
];
const tileValues = ["✦", "✦", "◌", "◌", "✿", "✿", "☼", "☼", "⌁", "⌁", "◒", "◒"];

export default function MyTime() {
  const [minutes, setMinutes] = useState(3);
  const [breathing, setBreathing] = useState(false);
  const [replied, setReplied] = useState<string | null>(null);
  const [playingSound, setPlayingSound] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [turns, setTurns] = useState(0);
  const [shared, setShared] = useState(false);
  const orderedTiles = useMemo(() => tileValues, []);

  const selectTile = (index: number) => {
    if (selected.includes(index) || matched.includes(index) || selected.length === 2) return;
    const next = [...selected, index];
    setSelected(next);
    if (next.length === 2) {
      setTurns((current) => current + 1);
      window.setTimeout(() => {
        if (orderedTiles[next[0]] === orderedTiles[next[1]]) setMatched((current) => [...current, ...next]);
        setSelected([]);
      }, 500);
    }
  };

  return (
    <RecoveryShell active="My Time">
      <div className="recovery-page mytime-page">
        <section className="recovery-page-heading mytime-heading"><div><span className="recovery-overline"><i /> A QUIET CORNER</span><h1>My Time<span>.</span></h1><p>Rest, reconnect and recharge. <b>No targets here.</b></p></div><div className="calm-minutes"><Sparkles size={17} /><b>14</b><span>calm minutes this week</span></div></section>
        <div className="mytime-top-grid">
          <section className={`breathing-card ${breathing ? "is-breathing" : ""}`} aria-labelledby="breathing-title"><div className="breathing-copy"><span className="recovery-overline">BREATHE · A FEW CALM MINUTES</span><h2 id="breathing-title">Slow your breath.<br />Settle your mind.</h2><p>Follow the circle. Breathe in as it grows, and out as it softens. In for four, out for six.</p><div className="breathing-choices" role="radiogroup" aria-label="Choose breathing session length">{[1, 3, 5].map((time) => <button key={time} role="radio" aria-checked={minutes === time} className={minutes === time ? "is-selected" : ""} onClick={() => setMinutes(time)}>{time} min</button>)}</div><button className="breathing-start" onClick={() => setBreathing(!breathing)}>{breathing ? "Pause breathing" : "Start breathing"}<ChevronRight size={17} /></button></div><div className="breathing-orbit" aria-live="polite"><div className="breathing-core"><b>{breathing ? "Breathe" : "Ready"}</b><span>{minutes} minute session</span></div></div></section>
          <section className="circle-card" aria-labelledby="circle-title"><div className="circle-heading"><span className="recovery-overline">MY CIRCLE</span><div>{people.map((person) => <i key={person.name}>{person.initial}</i>)}</div><h2 id="circle-title">Your people</h2></div><div className="circle-list">{people.map((person) => <article key={person.name}><i>{person.initial}</i><div><p><b>{person.name}</b> {person.copy}</p>{person.detail && <strong>{person.detail}</strong>}<time>{person.time}</time></div><button className={replied === person.name ? "is-replied" : ""} onClick={() => setReplied(person.name)}>{replied === person.name ? <><Check size={14} /> Sent</> : person.kind === "voice" ? <><CirclePlay size={15} /> {person.action}</> : <><Heart size={14} /> {person.action}</>}</button></article>)}</div><button className={shared ? "circle-share is-shared" : "circle-share"} onClick={() => setShared(true)}>{shared ? <><Check size={17} /> Shared</> : <><Send size={16} /> Share today’s win</>}<span><Plus size={20} /></span></button></section>
        </div>
        <div className="mytime-bottom-grid">
          <section className="pairs-card" aria-labelledby="pairs-title"><div className="pairs-intro"><div><span className="recovery-overline">DAILY SPARK · PAIRS</span><h2 id="pairs-title">A gentle game for a busy mind.</h2><p>Turn over two tiles to find a pair. No timer, and no way to lose.</p></div><div className="pairs-stat"><span>Pairs found</span><b>{matched.length / 2} of 6</b></div><div className="pairs-stat"><span>Turns</span><b>{turns}</b></div></div><div className="pairs-grid" aria-label="Memory pairs game">{orderedTiles.map((value, index) => { const isVisible = selected.includes(index) || matched.includes(index); return <button key={index} className={`${isVisible ? "is-open" : ""} ${matched.includes(index) ? "is-matched" : ""}`} onClick={() => selectTile(index)} aria-label={isVisible ? `Tile ${index + 1}: ${value}` : `Hidden tile ${index + 1}`}>{isVisible ? value : <span>⌁</span>}</button>; })}</div><p className="pairs-note">A new layout arrives every morning.</p></section>
          <section className="sounds-card" aria-labelledby="sounds-title"><span className="recovery-overline">SOUNDS TO REST BY</span><h2 id="sounds-title">Close your eyes for a while.</h2><div>{sounds.map(([name, length]) => <button key={name} className={playingSound === name ? "is-playing" : ""} onClick={() => setPlayingSound(playingSound === name ? null : name)}><span>{playingSound === name ? <Volume2 size={16} /> : <CirclePlay size={16} />}</span><b>{name}<small>{length}</small></b></button>)}</div></section>
        </div>
      </div>
    </RecoveryShell>
  );
}
