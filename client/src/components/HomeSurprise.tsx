import { useState } from "react";
import { ArrowRight, Award, CloudRain, Pencil, Puzzle, ShieldAlert, Type, Users, Volume2, Wind } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { fastCheckPath } from "@/lib/fast-check";
import { setDisplayPrefs } from "@/lib/display-prefs";
import { surpriseStore, type Surprise, type SurpriseAccess, type SurpriseId } from "@/lib/home-surprise";
import "./home-surprise.css";

const icons: Record<SurpriseId, typeof Volume2> = {
  "alira-voice": Volume2, breathing: Wind, sounds: CloudRain, "memory-pairs": Puzzle, journal: Pencil,
  medals: Award, "warning-signs": ShieldAlert, "large-text": Type, sharing: Users,
};

type HomeSurpriseProps = {
  access: SurpriseAccess;
  /** How long to wait before the sealed card rises in, so it never competes with Alira's greeting. */
  delayMs: number;
};

// A sealed envelope under the day's invitation. Opening it reveals one small thing to try, and
// "Show me another" seals a different one, ready to open again.
export default function HomeSurprise({ access, delayMs }: HomeSurpriseProps) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const [roll] = useState(Math.random);
  const [today, setToday] = useState(() => surpriseStore.today(access, new Date(), roll));
  const [seen, setSeen] = useState<SurpriseId[]>(() => today.surprise ? [today.surprise.id] : []);
  const { surprise, opened } = today;
  if (!surprise) return null;

  const open = () => {
    surpriseStore.open(new Date());
    setToday(state => ({ ...state, opened: true }));
  };
  const another = (nextAccess: SurpriseAccess = access) => {
    const next = surpriseStore.another(nextAccess, new Date(), Math.random(), seen);
    if (!next) return;
    // Once every surprise has been shown this visit, start the round again.
    setSeen(seen.includes(next.id) ? [next.id] : [...seen, next.id]);
    setToday({ surprise: next, opened: false });
  };
  const go = (chosen: Surprise) => {
    if (chosen.action === "large-text") { setDisplayPrefs({ largeText: true }); another({ ...access, largeText: true }); return; }
    if (chosen.action === "fast-check") { navigate(fastCheckPath(location, search)); return; }
    if (chosen.href) navigate(chosen.href);
  };
  const Icon = icons[surprise.id];

  return (
    <section className={`home-surprise ${opened ? "is-open" : "is-sealed"}`} style={{ animationDelay: `${delayMs}ms` }} aria-label="Today's surprise">
      {!opened ? (
        <button type="button" className="hs-seal" onClick={open} aria-expanded="false">
          <span className="hs-envelope" aria-hidden="true">
            <svg width="110" height="84" viewBox="0 0 110 84" fill="none">
              <rect x="2" y="14" width="106" height="68" rx="10" fill="#dcebe0" stroke="#1e4a3d" strokeWidth="2" />
              <path d="M2 24l53 36 53-36" stroke="#1e4a3d" strokeWidth="2" strokeLinejoin="round" />
              <path d="M2 24L55 60l53-36V22a8 8 0 0 0-8-8H10a8 8 0 0 0-8 8z" fill="#a9c9b6" />
              <circle cx="55" cy="58" r="11" fill="#ad5a37" />
              <path d="M50 58l3.5 3.5L61 54" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <i className="hs-spark" /><i className="hs-spark" /><i className="hs-spark" />
          </span>
          <span className="hs-words">
            <span className="hs-eyebrow">Today's surprise</span>
            <span className="hs-title">Something small is waiting for you.</span>
            <span className="hs-hint">Tap to open. It changes every day.</span>
          </span>
        </button>
      ) : (
        <div key={surprise.id} className="hs-reveal" role="region" aria-live="polite">
          <span className="hs-tile" aria-hidden="true"><Icon size={40} strokeWidth={1.8} /></span>
          <div className="hs-words">
            <span className="hs-eyebrow">{surprise.eyebrow}</span>
            <h2 className="hs-title">{surprise.title}</h2>
            <p className="hs-body">{surprise.body}</p>
            <div className="hs-actions">
              <button type="button" className="hs-cta" onClick={() => go(surprise)}>{surprise.cta} <ArrowRight size={18} aria-hidden="true" /></button>
              <button type="button" className="hs-later" onClick={() => another()}>Show me another</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
