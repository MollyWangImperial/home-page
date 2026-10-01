import { useEffect, useRef, useState, type MouseEvent } from "react";
import { myTimeStore } from "@/lib/my-time";

type Koi = { x: number; y: number; a: number };
type Ripple = { id: number; x: number; y: number };

// Positions are percentages of the pond, which is always square, so angles hold at any size.
const START: Koi[] = [{ x: 52, y: 46, a: -18 }, { x: 38, y: 60, a: 12 }, { x: 64, y: 66, a: -152 }];
const FOLLOW: [number, number][] = [[0, 0], [-12, 8], [-7, -11]];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
// One pad for each day of the week, round the rim where the koi rarely go.
const PADS = [
  { x: 20, y: 24, size: 17, turn: 20 }, { x: 50, y: 12, size: 13, turn: 150 }, { x: 81, y: 27, size: 15, turn: 200 },
  { x: 88, y: 58, size: 12, turn: 95 }, { x: 73, y: 83, size: 18, turn: -40 }, { x: 40, y: 89, size: 13, turn: 250 }, { x: 16, y: 70, size: 14, turn: 110 },
];
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The fish turn toward where they are going, by the shorter way round. */
function swimTo(koi: Koi[], x: number, y: number): Koi[] {
  return koi.map((fish, index) => {
    const tx = clamp(x + FOLLOW[index][0], 16, 84);
    const ty = clamp(y + FOLLOW[index][1], 16, 84);
    const dx = tx - fish.x;
    const dy = ty - fish.y;
    if (Math.abs(dx) + Math.abs(dy) < 1.5) return fish;
    const heading = (Math.atan2(dy, dx) * 180) / Math.PI;
    const turn = ((((heading - fish.a) % 360) + 540) % 360) - 180;
    return { x: tx, y: ty, a: fish.a + turn };
  });
}

function Lily({ open }: { open: boolean }) {
  return open
    ? <g><ellipse rx="4" ry="11" fill="#e6a9ae" /><ellipse rx="4" ry="11" fill="#edbcc0" transform="rotate(45)" /><ellipse rx="4" ry="11" fill="#e6a9ae" transform="rotate(90)" /><ellipse rx="4" ry="11" fill="#edbcc0" transform="rotate(135)" /><circle r="3.5" fill="#f1cf7a" /></g>
    : <circle r="7.5" fill="none" stroke="#8fb39b" strokeWidth="1.5" strokeDasharray="3 3" />;
}

function KoiFish({ body, fins, patches }: { body: string; fins: string; patches: [string, string][] }) {
  return <svg className="pond-koi-art" viewBox="0 0 84 34" fill="none" aria-hidden="true">
    <path d="M14 17C8 12 4 6 1 3c1 6 1 10 0 14 1 4 1 8 0 14 3-3 7-9 13-14Z" fill={fins} />
    <path d="M44 8c-3-5-8-7-13-6 2 3 5 6 9 7ZM44 26c-3 5-8 7-13 6 2-3 5-6 9-7Z" fill={fins} />
    <path d="M12 17c8-9 26-13 44-10 12 2 22 6 26 10-4 4-14 8-26 10-18 3-36-1-44-10Z" fill={body} />
    {patches.map(([d, fill]) => <path key={d} d={d} fill={fill} />)}
    <circle cx="73" cy="13" r="1.6" fill="#2b3b33" /><circle cx="73" cy="21" r="1.6" fill="#2b3b33" />
  </svg>;
}

const FISH = [
  <KoiFish key="a" body="#fff6ea" fins="#fbe6d5" patches={[["M62 9c-7-2-14-1-19 2 5 5 14 5 19-2Z", "#e58a5c"], ["M32 22c5 4 12 4 16 0-5-3-11-3-16 0Z", "#e58a5c"]]} />,
  <KoiFish key="b" body="#eaa06c" fins="#f2b98e" patches={[["M56 10c-6-2-11-1-15 2 4 4 11 4 15-2Z", "#fff6ea"]]} />,
  <KoiFish key="c" body="#fff6ea" fins="#fbe6d5" patches={[["M66 10c-5-2-9-2-13 0 4 4 9 4 13 0Z", "#f1cf7a"], ["M30 12c6-3 13-3 18 0-5 4-13 4-18 0Z", "#3b4a43"], ["M38 24c3 2 8 2 11 0-3-2-8-2-11 0Z", "#3b4a43"]]} />,
];

// A pond to visit. Touch the water and the koi come over; left alone they drift on their own.
// A lily opens on one of the seven pads for each day of the week the pond is visited.
export default function KoiPond({ active }: { active: boolean }) {
  const [koi, setKoi] = useState(START);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [touched, setTouched] = useState(false);
  const [lilies, setLilies] = useState(() => myTimeStore.lilies(new Date()));
  const lastTouch = useRef(0);
  const rippleId = useRef(0);

  // Left alone, the koi wander: a new spot every few seconds.
  useEffect(() => {
    if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (document.hidden || performance.now() - lastTouch.current < 9000) return;
      setKoi(current => swimTo(current, 25 + Math.random() * 50, 25 + Math.random() * 50));
    }, 6500);
    return () => window.clearInterval(timer);
  }, [active]);

  const touch = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    // A keyboard press has no position, so the koi are called to a spot of their own choosing.
    const fromKeyboard = !box.width || (event.clientX === 0 && event.clientY === 0);
    const x = fromKeyboard ? 30 + Math.random() * 40 : ((event.clientX - box.left) / box.width) * 100;
    const y = fromKeyboard ? 30 + Math.random() * 40 : ((event.clientY - box.top) / box.height) * 100;
    lastTouch.current = performance.now();
    setKoi(current => swimTo(current, x, y));
    const id = ++rippleId.current;
    setRipples(current => [...current.slice(-3), { id, x, y }]);
    window.setTimeout(() => setRipples(current => current.filter(ripple => ripple.id !== id)), 2600);
    if (!touched) {
      setTouched(true);
      const now = new Date();
      myTimeStore.visitPond(now);
      setLilies(myTimeStore.lilies(now));
    }
  };

  const open = lilies.filter(Boolean).length;
  return <section className="mt-card pond-card" aria-labelledby="pond-title">
    <div className="mt-copy">
      <div>
        <h2 id="pond-title">A pond that likes company.</h2>
        <p>Touch the water and the koi will come to find you. Slow circles, soft ripples, nothing to finish.</p>
      </div>
      <div className="pond-week">
        <svg viewBox="0 0 198 26" role="img" aria-label={`Lilies this week: ${DAY_NAMES.filter((_, day) => lilies[day]).join(", ") || "none open yet"}.`}>
          {lilies.map((isOpen, day) => <g key={day} transform={`translate(${13 + day * 28.6} 13)`}><Lily open={isOpen} /></g>)}
        </svg>
        <b role="status">{open === 0 ? "No lilies open yet this week" : `${open} ${open === 1 ? "lily" : "lilies"} open this week`}</b>
        <span>A lily opens each day you visit. They never wilt if you miss one.</span>
      </div>
    </div>
    <button type="button" className="pond-water" onClick={touch} aria-label="The pond. Touch the water to call the koi.">
      <i className="pond-ambient" /><i className="pond-ambient pond-ambient-late" />
      {PADS.map((pad, day) => <span key={day} className="pond-pad" style={{ left: `${pad.x}%`, top: `${pad.y}%`, width: `${pad.size}%` }}>
        <svg viewBox="-44 -44 88 88" aria-hidden="true">
          <g transform={`rotate(${pad.turn})`}><path d="M0 0 38 -9A39 39 0 1 0 38 9Z" fill={day % 2 ? "#7fb486" : "#8fc08e"} /><path d="M0 0-30 14M0 0-12-32M0 0 8 34" stroke="#6fa57a" strokeWidth="1.5" fill="none" /></g>
          {lilies[day] && <g className="pond-bloom" transform="scale(1.9)"><Lily open /></g>}
        </svg>
      </span>)}
      {ripples.map(ripple => <span key={ripple.id} className="pond-ripple" style={{ left: `${ripple.x}%`, top: `${ripple.y}%` }}><i /><i /></span>)}
      {koi.map((fish, index) => <span key={index} className={`pond-koi pond-koi-${index}`} style={{ left: `${fish.x}%`, top: `${fish.y}%`, transform: `translate(-50%,-50%) rotate(${fish.a}deg)` }}>{FISH[index]}</span>)}
      {!touched && <span className="pond-hint">Touch the water</span>}
    </button>
  </section>;
}
