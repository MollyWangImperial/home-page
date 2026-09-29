import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import "@/pages/welcome.css";

// Alira's greeting types out character by character after a short pause, then the invitation appears.
const GREETING_START_MS = 2100;

function layOut(text: string) {
  const chars: { ch: string; d: number }[] = [];
  let t = GREETING_START_MS;
  for (const ch of text) {
    chars.push({ ch, d: t });
    t += ch === "." || ch === "?" || ch === ":" ? 320 : ch === "," ? 160 : 26;
  }
  return { chars, buttonDelay: t + 400 };
}

type QuietFocusProps = {
  animateGreeting: boolean;
  headline: string;
  message: string;
  cta: string;
  note: string;
  onStart: () => void;
  onReplay: () => void;
};

// One quiet focus: Alira's mark, a greeting, her message and a single invitation.
// Shared by the first-visit welcome and the returning home, which only change the words.
export default function QuietFocus({ animateGreeting, headline, message, cta, note, onStart, onReplay }: QuietFocusProps) {
  const greeting = useMemo(() => layOut(message), [message]);
  return (
    <div className="welcome-page" data-greeting-motion={animateGreeting ? "typing" : "static"}>
      <button type="button" className="welcome-alira" onClick={onReplay} aria-label="Replay Alira's greeting" title="Replay Alira's greeting">
        <span className="welcome-orbit" aria-hidden="true" />
        <span className="welcome-core" aria-hidden="true">
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path className="welcome-ecg" d="M3 12h4l2-5 4 10 2-5h6" />
          </svg>
        </span>
        <span className="welcome-presence" aria-hidden="true" />
      </button>

      <h1>{headline}</h1>

      <section className="welcome-card" aria-label="A message from Alira">
        <div className="welcome-bubble-row">
          <span className="welcome-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h4l2-5 4 10 2-5h6" />
            </svg>
          </span>
          <p className="welcome-bubble">
            <span className="sr-only">Alira: {message}</span>
            {animateGreeting && <span className="welcome-dots" aria-hidden="true"><i /><i /><i /></span>}
            <span aria-hidden="true">
              {animateGreeting ? greeting.chars.map((c, i) => (
                <span key={i} className="welcome-ch" style={{ animationDelay: `${c.d}ms` }}>{c.ch}</span>
              )) : message}
            </span>
          </p>
        </div>
        <div className="welcome-cta-row" style={animateGreeting ? { animationDelay: `${greeting.buttonDelay}ms` } : undefined}>
          <button type="button" className="welcome-cta" onClick={onStart}>
            {cta} <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      </section>

      <p className="welcome-pause-note">{note}</p>
    </div>
  );
}
