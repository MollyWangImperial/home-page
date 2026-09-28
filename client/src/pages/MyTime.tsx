import { useState } from "react";
import {
  Check,
  CirclePlay,
  Heart,
  Plus,
  Send,
  Volume2,
} from "lucide-react";
import RecoveryShell from "@/components/RecoveryShell";
import BreathingGuide from "@/components/BreathingGuide";
import MemoryPairs from "@/components/MemoryPairs";
import CircleAvatar from "@/components/CircleAvatar";
import "./mytime-refinements.css";

const people = [
  { name: "Sarah", copy: "sent you a cheer for your five day streak.", detail: "So proud of you, Mum.", time: "Two hours ago", action: "Cheer back", kind: "cheer" },
  { name: "Tom", copy: "left you a voice note.", detail: "", time: "Yesterday", action: "Play 0:21", kind: "voice" },
  { name: "Priya", copy: "loved your win: opened a jar of jam on my own.", detail: "", time: "Saturday", action: "Say thanks", kind: "thanks" },
] as const;
const sounds = [
  ["Rain on the window", "20 minutes"],
  ["Morning birdsong", "15 minutes"],
  ["Waves at dusk", "30 minutes"],
  ["A crackling fire", "20 minutes"],
];
export default function MyTime() {
  const [replied, setReplied] = useState<string | null>(null);
  const [playingSound, setPlayingSound] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  return (
    <RecoveryShell active="My Time">
      <div className="recovery-page mytime-page">
        <section className="recovery-page-heading mytime-heading"><div><h1>My Time<span>.</span></h1></div></section>
        <div className="mytime-top-grid">
          <BreathingGuide />
          <section className="circle-card" aria-labelledby="circle-title">
            <div className="circle-heading"><div aria-hidden="true">{people.map((person) => <CircleAvatar key={person.name} person={person.name} />)}</div><h2 id="circle-title">Your circle</h2></div>
            <div className="circle-list">{people.map((person) => <article key={person.name}>
              <CircleAvatar person={person.name} />
              <div className="circle-person-message"><p><b>{person.name}</b> {person.copy}</p>{person.detail && <strong>{person.detail}</strong>}</div>
              <div className="circle-person-footer"><time>{person.time}</time><button className={replied === person.name ? "is-replied" : ""} onClick={() => setReplied(person.name)}>{replied === person.name ? <><Check size={14} /> Sent</> : person.kind === "voice" ? <><CirclePlay size={15} /> {person.action}</> : <><Heart size={14} /> {person.action}</>}</button></div>
            </article>)}</div>
            <button className={shared ? "circle-share is-shared" : "circle-share"} onClick={() => setShared(true)}>{shared ? <><Check size={17} /> Shared</> : <><Send size={16} /> Share today’s win</>}<span><Plus size={20} /></span></button>
          </section>
        </div>
        <div className="mytime-bottom-grid">
          <MemoryPairs />
          <section className="sounds-card" aria-labelledby="sounds-title"><h2 id="sounds-title">Close your eyes for a while.</h2><div>{sounds.map(([name, length]) => <button key={name} className={playingSound === name ? "is-playing" : ""} onClick={() => setPlayingSound(playingSound === name ? null : name)}><span>{playingSound === name ? <Volume2 size={16} /> : <CirclePlay size={16} />}</span><b>{name}<small>{length}</small></b></button>)}</div></section>
        </div>
      </div>
    </RecoveryShell>
  );
}
