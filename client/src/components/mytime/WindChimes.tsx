import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CloudRain, Wind } from "lucide-react";
import { CHIME_NOTES, ringChime, startAmbience } from "@/lib/my-time-audio";

const TUBES = [
  { colour: "#f1cf7a", height: 300, name: "Chime 1, the lowest" },
  { colour: "#f0c5ad", height: 274, name: "Chime 2" },
  { colour: "#cfe3d2", height: 250, name: "Chime 3" },
  { colour: "#d7c7e6", height: 226, name: "Chime 4" },
  { colour: "#c9d5e6", height: 204, name: "Chime 5" },
  { colour: "#edbcc0", height: 182, name: "Chime 6" },
  { colour: "#fff3d6", height: 160, name: "Chime 7, the highest" },
];
type Note = { id: number; tube: number };

// Seven chimes tuned to one scale, so nothing played on them can sound wrong. The wind can play
// them too, and rain can fall behind.
export default function WindChimes({ active }: { active: boolean }) {
  const [swings, setSwings] = useState<number[]>(() => TUBES.map(() => 0));
  const [trail, setTrail] = useState<Note[]>([]);
  const [wind, setWind] = useState(false);
  const [rain, setRain] = useState(false);
  const noteId = useRef(0);

  const ring = (tube: number, loudness = 1, byHand = true) => {
    ringChime(CHIME_NOTES[tube], loudness);
    setSwings(current => current.map((count, index) => (index === tube ? count + 1 : count)));
    if (byHand) setTrail(current => [...current.slice(-8), { id: ++noteId.current, tube }]);
  };

  // The wind plays a quiet note every second or two, mostly stepping to a neighbouring chime.
  useEffect(() => {
    if (!active || !wind) return;
    let timer = 0;
    let last = 3;
    const blow = () => {
      if (!document.hidden) {
        last = Math.max(0, Math.min(TUBES.length - 1, last + Math.round((Math.random() - 0.5) * 4)));
        ring(last, 0.55, false);
      }
      timer = window.setTimeout(blow, 900 + Math.random() * 1700);
    };
    timer = window.setTimeout(blow, 500);
    return () => window.clearTimeout(timer);
  }, [active, wind]);

  useEffect(() => {
    if (!active || !rain) return;
    return startAmbience("rain");
  }, [active, rain]);

  return <section className="mt-card chimes-card" aria-labelledby="chimes-title">
    <div className="mt-copy">
      <div>
        <h2 id="chimes-title">Every note fits.</h2>
        <p>Touch a chime, then another. They are tuned so that nothing you play can sound wrong.</p>
        <div className="chimes-modes">
          <button type="button" className={wind ? "is-on" : ""} aria-pressed={wind} onClick={() => setWind(!wind)}><Wind size={16} />Let the wind play</button>
          <button type="button" className={rain ? "is-on" : ""} aria-pressed={rain} onClick={() => setRain(!rain)}><CloudRain size={16} />Rain behind</button>
        </div>
      </div>
      <div className="chimes-trail">
        <b>Your last notes</b>
        <div role="status" aria-label={trail.length ? `${trail.length} notes played` : undefined}>
          {trail.length === 0 ? <span>Nothing played yet. Start anywhere.</span> : trail.map(note => <i key={note.id} style={{ background: TUBES[note.tube].colour }} />)}
        </div>
      </div>
    </div>
    <div className="chimes-rig">
      <div className="chimes-bar" aria-hidden="true" />
      <div className="chimes-row">
        {/* Two identical swings, taken in turn, so each new touch starts the swing again. */}
        {TUBES.map((tube, index) => <div key={index} className={`chime ${swings[index] === 0 ? "" : swings[index] % 2 ? "swing-a" : "swing-b"}`} style={{ "--chime-height": tube.height, "--chime-drift": `${index * -0.7}s` } as CSSProperties}>
          <span className="chime-string" style={{ height: 26 + (index % 2) * 10 }} aria-hidden="true" />
          <button type="button" className="chime-tube" onClick={() => ring(index)} aria-label={tube.name} style={{ background: tube.colour }}><i aria-hidden="true" /></button>
        </div>)}
      </div>
    </div>
  </section>;
}
