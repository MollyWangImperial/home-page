import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CirclePlay, Shuffle, Volume2 } from "lucide-react";
import { useSearch } from "wouter";
import RecoveryShell from "@/components/RecoveryShell";
import BreathingGuide from "@/components/BreathingGuide";
import MemoryPairs from "@/components/MemoryPairs";
import ActivityIcon from "@/components/mytime/ActivityIcon";
import ColourWindow from "@/components/mytime/ColourWindow";
import DailyPostcard from "@/components/mytime/DailyPostcard";
import EveningLantern from "@/components/mytime/EveningLantern";
import KoiPond from "@/components/mytime/KoiPond";
import StoryTime from "@/components/mytime/StoryTime";
import WindChimes from "@/components/mytime/WindChimes";
import { activityFromQuery, myTimeActivities, myTimeStore, neighbour, suggestedActivity, surpriseActivity, type MyTimeActivityId } from "@/lib/my-time";
import "./mytime-refinements.css";
import "./mytime-stage.css";
import "@/components/mytime/my-time-activities.css";

const sounds = [
  ["Rain on the window", "20 minutes"],
  ["Morning birdsong", "15 minutes"],
  ["Waves at dusk", "30 minutes"],
  ["A crackling fire", "20 minutes"],
];

function QuietSounds() {
  const [playingSound, setPlayingSound] = useState<string | null>(null);
  return <section className="sounds-card" aria-labelledby="sounds-title"><h2 id="sounds-title">Close your eyes for a while.</h2><div>{sounds.map(([name, length]) => <button key={name} className={playingSound === name ? "is-playing" : ""} onClick={() => setPlayingSound(playingSound === name ? null : name)}><span>{playingSound === name ? <Volume2 size={16} /> : <CirclePlay size={16} />}</span><b>{name}<small>{length}</small></b></button>)}</div></section>;
}

// My Time shows one thing at a time. A picker along the top chooses it, the arrows underneath step
// to its neighbours, and the page opens on something that suits the time of day.
// Alira and Home can open it at one activity: /my-time?activity=breathing&minutes=3.
export default function MyTime() {
  const search = useSearch();
  const [opened] = useState(() => {
    const query = new URLSearchParams(search);
    const minutes = Number(query.get("minutes"));
    return { activity: activityFromQuery(query.get("activity")), minutes: [1, 3, 5].includes(minutes) ? minutes : undefined };
  });
  const [suggestion] = useState(() => suggestedActivity(new Date()));
  const [activeId, setActiveId] = useState<MyTimeActivityId>(opened.activity ?? suggestion.id);
  // An activity stays as it was left (a half-finished game, a half-coloured window) once it has been opened.
  const [visited, setVisited] = useState<MyTimeActivityId[]>([activeId]);
  const [tried, setTried] = useState(() => myTimeStore.load().tried);
  const [arriving, setArriving] = useState<"right" | "left">("right");
  const rail = useRef<HTMLDivElement>(null);
  const order = myTimeActivities.map(activity => activity.id);

  useEffect(() => { setTried(myTimeStore.markTried(activeId)); }, [activeId]);

  useEffect(() => {
    const activity = myTimeActivities.find(candidate => candidate.id === opened.activity);
    const section = activity ? document.getElementById(activity.titleId)?.closest("section") : null;
    if (!section || !activity) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    section.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    section.querySelector<HTMLElement>(activity.control)?.focus({ preventScroll: true });
  }, [opened]);

  // On a narrow screen the picker scrolls sideways; the chosen one is brought to the middle.
  useEffect(() => {
    const strip = rail.current;
    const tab = strip?.querySelector<HTMLElement>(`#mytime-tab-${activeId}`);
    if (!strip || !tab) return;
    const left = tab.offsetLeft - strip.offsetLeft - (strip.clientWidth - tab.clientWidth) / 2;
    strip.scrollTo({ left, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [activeId]);

  const open = (id: MyTimeActivityId, side?: "right" | "left") => {
    if (id === activeId) return;
    setArriving(side ?? (order.indexOf(id) > order.indexOf(activeId) ? "right" : "left"));
    setActiveId(id);
    setVisited(current => (current.includes(id) ? current : [...current, id]));
  };
  const step = (by: 1 | -1) => open(neighbour(activeId, by).id, by === 1 ? "right" : "left");
  const pickWithKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const move: Record<string, MyTimeActivityId> = {
      ArrowRight: neighbour(activeId, 1).id, ArrowLeft: neighbour(activeId, -1).id, Home: order[0], End: order[order.length - 1],
    };
    const next = move[event.key];
    if (!next) return;
    event.preventDefault();
    open(next);
    rail.current?.querySelector<HTMLElement>(`#mytime-tab-${next}`)?.focus();
  };

  const panels: Record<MyTimeActivityId, (active: boolean) => ReactNode> = {
    breathing: () => <BreathingGuide initialMinutes={opened.minutes} />,
    pond: active => <KoiPond active={active} />,
    memory_game: () => <MemoryPairs />,
    chimes: active => <WindChimes active={active} />,
    colour: () => <ColourWindow />,
    postcard: active => <DailyPostcard active={active} />,
    story: active => <StoryTime active={active} />,
    sounds: () => <QuietSounds />,
    lantern: () => <EveningLantern />,
  };
  // The breathing guide runs a timer, so it starts fresh on each visit rather than counting on unseen.
  const mounted = order.filter(id => id === activeId || (id !== "breathing" && visited.includes(id)));

  return (
    <RecoveryShell active="My Time">
      <div className="recovery-page mytime-page">
        <section className="recovery-page-heading mytime-heading">
          <div><h1>My Time<span>.</span></h1><p className="mytime-suggestion">{opened.activity ? "One thing at a time. Stay as long as you like." : suggestion.line}</p></div>
          <button type="button" className="mytime-surprise" onClick={() => open(surpriseActivity(activeId, tried, Math.random()))}><Shuffle size={16} />Surprise me</button>
        </section>
        <div ref={rail} className="mytime-rail" role="tablist" aria-label="Things to do in My Time" onKeyDown={pickWithKeys}>
          {myTimeActivities.map(activity => <button key={activity.id} type="button" role="tab" id={`mytime-tab-${activity.id}`} aria-selected={activity.id === activeId} aria-controls={`mytime-panel-${activity.id}`} tabIndex={activity.id === activeId ? 0 : -1} className={activity.id === activeId ? "is-active" : ""} onClick={() => open(activity.id)}>
            <span><ActivityIcon id={activity.id} /></span><b>{activity.label}</b>
          </button>)}
        </div>
        <div className="mytime-stage">
          {mounted.map(id => <div key={id} role="tabpanel" id={`mytime-panel-${id}`} aria-labelledby={`mytime-tab-${id}`} hidden={id !== activeId} className={`mytime-panel mytime-panel-${id} ${id === activeId ? `from-${arriving}` : ""}`}>{panels[id](id === activeId)}</div>)}
        </div>
        <nav className="mytime-pager" aria-label="Next and previous activity">
          <button type="button" onClick={() => step(-1)}><ArrowLeft size={16} /><span>BEFORE</span></button>
          <div aria-hidden="true">{order.map(id => <i key={id} className={id === activeId ? "is-active" : ""} />)}</div>
          <button type="button" onClick={() => step(1)}><span>NEXT</span><ArrowRight size={16} /></button>
        </nav>
      </div>
    </RecoveryShell>
  );
}
