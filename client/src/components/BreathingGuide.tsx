import { useEffect, useRef, useState } from "react";
import { ChevronRight, Pause, Play } from "lucide-react";

type BreathState = "ready" | "running" | "paused" | "complete";

export default function BreathingGuide({ initialMinutes = 3 }: { initialMinutes?: number }) {
  const [minutes, setMinutes] = useState(initialMinutes);
  const [state, setState] = useState<BreathState>("ready");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [session, setSession] = useState(0);
  const elapsedMs = useRef(0);

  useEffect(() => {
    if (state !== "running") return;
    const start = performance.now() - elapsedMs.current;
    const duration = minutes * 60_000;
    const tick = () => {
      elapsedMs.current = Math.min(duration, performance.now() - start);
      setElapsedSeconds(Math.floor(elapsedMs.current / 1000));
      if (elapsedMs.current >= duration) setState("complete");
    };
    const timer = window.setInterval(tick, 100);
    return () => {
      window.clearInterval(timer);
      elapsedMs.current = Math.min(duration, performance.now() - start);
    };
  }, [state, minutes]);

  const chooseMinutes = (value: number) => {
    if (value === minutes) return;
    setMinutes(value);
    elapsedMs.current = 0;
    setElapsedSeconds(0);
    setState("ready");
    setSession((current) => current + 1);
  };
  const toggleBreathing = () => {
    if (state === "running") { setState("paused"); return; }
    if (state === "complete") {
      elapsedMs.current = 0;
      setElapsedSeconds(0);
      setSession((current) => current + 1);
    }
    setState("running");
  };
  const phase = elapsedSeconds % 10 < 4 ? "Breathe in" : "Breathe out";
  const label = state === "ready" ? "Ready" : state === "paused" ? "Paused" : state === "complete" ? "Rest easy" : phase;

  return <section className={`breathing-card breath-${state}`} aria-labelledby="breathing-title">
    <div className="breathing-copy">
      <h2 id="breathing-title">Slow your breath.<br />Settle your mind.</h2>
      <p>Follow the circle. Breathe in as it grows, and out as it softens. In for four, out for six.</p>
      <div className="breathing-choices" role="radiogroup" aria-label="Choose breathing session length">
        {[1, 3, 5].map((time) => <button key={time} role="radio" aria-checked={minutes === time} disabled={state === "running"} className={minutes === time ? "is-selected" : ""} onClick={() => chooseMinutes(time)}>{time} min</button>)}
      </div>
      <button className="breathing-start" onClick={toggleBreathing}>
        {state === "running" ? <>Pause breathing<Pause size={16} /></> : state === "paused" ? <>Resume breathing<Play size={16} /></> : <>{state === "complete" ? "Start again" : "Start breathing"}<ChevronRight size={17} /></>}
      </button>
    </div>
    <div className="breathing-orbit">
      <div key={`${session}-${state === "ready" ? "idle" : "session"}`} className="breathing-visual" aria-hidden="true"><i /><i /><i /></div>
      <div className="breathing-core"><b role="status" aria-live="polite">{label}</b></div>
    </div>
    {state === "complete" && <p className="breathing-finished" role="status">A little space for yourself. Stay here as long as you like.</p>}
  </section>;
}
