import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CirclePlay, HeartHandshake, Shuffle, Volume2 } from "lucide-react";
import BreathingGuide from "@/components/BreathingGuide";
import MemoryPairs from "@/components/MemoryPairs";
import ActivityIcon from "@/components/mytime/ActivityIcon";
import ColourWindow from "@/components/mytime/ColourWindow";
import DailyPostcard from "@/components/mytime/DailyPostcard";
import EveningLantern from "@/components/mytime/EveningLantern";
import KoiPond from "@/components/mytime/KoiPond";
import StoryTime from "@/components/mytime/StoryTime";
import WindChimes from "@/components/mytime/WindChimes";
import { myTimeActivities, myTimeStore, neighbour, surpriseActivity, type MyTimeActivityId } from "@/lib/my-time";

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

type PlaySectionProps = {
  /** False while another My Time section is on screen: everything here pauses and waits. */
  shown: boolean;
  /** The activity a link asked for (from the front page, Alira or Home), if any. */
  requested: MyTimeActivityId | null;
  /** What to open on when no activity was asked for. */
  suggested: MyTimeActivityId;
  minutes?: number;
};

// The things to do. One shows at a time: a picker along the top chooses it, the arrows underneath
// step to its neighbours, and a line under each says how it can help after a stroke. The stage it
// sits on takes a soft colour of its own for each one (mytime-stage.css).
export default function PlaySection({ shown, requested, suggested, minutes }: PlaySectionProps) {
  const [opened] = useState(requested);
  const [activeId, setActiveId] = useState<MyTimeActivityId>(requested ?? suggested);
  // An activity stays as it was left (a half-finished game, a half-coloured window) once it has been opened.
  const [visited, setVisited] = useState<MyTimeActivityId[]>([activeId]);
  const [tried, setTried] = useState(() => myTimeStore.load().tried);
  const [arriving, setArriving] = useState<"right" | "left">("right");
  const rail = useRef<HTMLDivElement>(null);
  const order = myTimeActivities.map(activity => activity.id);
  const current = myTimeActivities.find(activity => activity.id === activeId) ?? myTimeActivities[0];

  useEffect(() => { setTried(myTimeStore.markTried(activeId)); }, [activeId]);

  // Opened by a link at one activity: bring it into view and put the focus on its main control.
  useEffect(() => {
    const activity = myTimeActivities.find(candidate => candidate.id === opened);
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
    if (!strip || !tab || !shown) return;
    const left = tab.offsetLeft - strip.offsetLeft - (strip.clientWidth - tab.clientWidth) / 2;
    strip.scrollTo({ left, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [activeId, shown]);

  const open = (id: MyTimeActivityId, side?: "right" | "left") => {
    if (id === activeId) return;
    setArriving(side ?? (order.indexOf(id) > order.indexOf(activeId) ? "right" : "left"));
    setActiveId(id);
    setVisited(current => (current.includes(id) ? current : [...current, id]));
  };
  // A later link to another activity (from the front page, say) opens it here.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => { if (requested) openRef.current(requested); }, [requested]);

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
    breathing: () => <BreathingGuide initialMinutes={minutes} />,
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
  const mounted = order.filter(id => (id === activeId && (shown || id !== "breathing")) || (id !== "breathing" && visited.includes(id)));

  return <>
    <div className="mytime-play-intro">
      <p>Nine gentle things to do, one at a time. Each one is here for a reason.</p>
      <button type="button" className="mytime-surprise" onClick={() => open(surpriseActivity(activeId, tried, Math.random()))}><Shuffle size={16} />Surprise me</button>
    </div>
    <div ref={rail} className="mytime-rail" role="tablist" aria-label="Things to do in My Time" onKeyDown={pickWithKeys}>
      {myTimeActivities.map(activity => <button key={activity.id} type="button" role="tab" id={`mytime-tab-${activity.id}`} aria-selected={activity.id === activeId} aria-controls={`mytime-panel-${activity.id}`} tabIndex={activity.id === activeId ? 0 : -1} className={activity.id === activeId ? "is-active" : ""} onClick={() => open(activity.id)}>
        <span><ActivityIcon id={activity.id} /></span><b>{activity.label}</b>
      </button>)}
    </div>
    <div className={`mytime-stage mytime-stage-${activeId}`}>
      {mounted.map(id => <div key={id} role="tabpanel" id={`mytime-panel-${id}`} aria-labelledby={`mytime-tab-${id}`} hidden={id !== activeId} className={`mytime-panel mytime-panel-${id} ${id === activeId ? `from-${arriving}` : ""}`}>
        <p className="mytime-stage-kicker">Activity {order.indexOf(id) + 1} of {order.length}</p>
        {panels[id](shown && id === activeId)}
      </div>)}
    </div>
    <aside key={activeId} className="mytime-benefit" aria-label={`How ${current.label} helps`}>
      <span aria-hidden="true"><HeartHandshake size={18} /></span>
      <p><b>How this helps.</b> {current.helps}{current.source && <> <a href={current.source.url} target="_blank" rel="noopener noreferrer" title={`${current.source.publisher}: ${current.source.title}`}>Source: {current.source.publisher}<span className="sr-only"> (opens in a new tab)</span></a></>}</p>
    </aside>
    <nav className="mytime-pager" aria-label="Next and previous activity">
      <button type="button" onClick={() => step(-1)}><ArrowLeft size={16} /><span>BEFORE</span></button>
      <div aria-hidden="true">{order.map(id => <i key={id} className={id === activeId ? "is-active" : ""} />)}</div>
      <button type="button" onClick={() => step(1)}><span>NEXT</span><ArrowRight size={16} /></button>
    </nav>
  </>;
}
