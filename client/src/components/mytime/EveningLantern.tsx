import { useRef, useState, type FormEvent } from "react";
import { ArrowUp } from "lucide-react";

function Lantern({ lit = false }: { lit?: boolean }) {
  return <svg viewBox="0 0 44 58" fill="none" aria-hidden="true">
    <path d="M9 6h26l5 34c0 6-8 10-18 10S4 46 4 40Z" fill={lit ? "#f8dcbd" : "#f4c9a4"} />
    <path d="M9 6h26l1 6H8Z" fill="#b86b4d" />
    {lit && <path d="M16 16v22M28 16v22" stroke="#e9b98e" strokeWidth="1.5" />}
    <ellipse className={lit ? "lantern-flame" : undefined} cx="22" cy="40" rx={lit ? 9 : 8} ry={lit ? 7 : 6} fill={lit ? "#fff6dc" : "#fff1c9"} />
  </svg>;
}

// Stars as [left %, top %, twinkles late, only shown on a narrow screen (where no words sit under them)].
const STARS: [number, number, boolean, boolean][] = [
  [44, 12, false, false], [55, 27, true, false], [69, 9, false, false], [81, 31, true, false], [93, 47, false, false], [61, 46, true, false], [89, 62, false, false],
  [8, 16, false, true], [22, 34, true, true], [31, 8, false, true],
];

// Write one thought, send it up, watch it go. The words never leave this box: they are not saved,
// not sent anywhere, and are cleared the moment the lantern rises.
export default function EveningLantern() {
  const [thought, setThought] = useState("");
  const [rising, setRising] = useState<number[]>([]);
  const [sent, setSent] = useState(0);
  const lanternId = useRef(0);

  const send = (event: FormEvent) => {
    event.preventDefault();
    const id = ++lanternId.current;
    setThought("");
    setSent(count => count + 1);
    setRising(current => [...current, id]);
    // With reduced motion the lantern does not rise, so it is simply taken away after a moment.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => setRising(current => current.filter(item => item !== id)), still ? 1500 : 7200);
  };

  return <section className="mt-card lantern-card" aria-labelledby="lantern-title">
    <div className="lantern-sky" aria-hidden="true">
      {STARS.map(([left, top, late, near], index) => <i key={index} className={`lantern-star ${late ? "lantern-star-late" : ""} ${near ? "lantern-star-near" : ""}`} style={{ left: `${left}%`, top: `${top}%` }} />)}
      <svg className="lantern-moon" viewBox="664 56 60 62" fill="none"><path d="M694 62a26 26 0 1 0 22 40c-18 3-32-17-22-40Z" fill="#f7edbd" /></svg>
      <svg className="lantern-hills" viewBox="330 394 430 106" fill="none" preserveAspectRatio="none">
        <path d="M330 500C352 462 384 428 414 418 440 410 458 424 476 434 530 396 610 394 664 428 700 414 734 418 760 432V500Z" fill="#12312a" />
        <path d="M360 500C410 474 452 456 492 458 506 459 518 464 530 468 600 446 690 448 760 468V500Z" fill="#0e2822" />
      </svg>
      <span className="lantern-far lantern-far-a"><Lantern /></span>
      <span className="lantern-far lantern-far-b"><Lantern /></span>
      <span className="lantern-far lantern-far-c"><Lantern /></span>
      <span key={sent} className={`lantern-ready ${sent ? "is-next" : ""}`}><Lantern lit /></span>
      {rising.map(id => <span key={id} className="lantern-rising"><Lantern lit /></span>)}
    </div>
    <form className="mt-copy lantern-form" onSubmit={send}>
      <div>
        <h2 id="lantern-title">Let one thought go.</h2>
        <p>Write down something that has been sitting with you today, then send it up and watch it drift away. Nobody reads it, and it is not kept.</p>
      </div>
      <div className="lantern-fields">
        <label htmlFor="lantern-thought">What would you like to let go of?</label>
        <input id="lantern-thought" type="text" value={thought} onChange={event => setThought(event.target.value)} placeholder="A worry, a hard moment, anything" autoComplete="off" maxLength={200} />
        <div>
          <button type="submit">{sent === 0 ? "Send it up" : "Send another"}<ArrowUp size={16} /></button>
          <span role="status">{sent > 0 ? "There it goes. That is enough for today." : ""}</span>
        </div>
      </div>
    </form>
  </section>;
}
