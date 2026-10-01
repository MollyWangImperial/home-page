import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import HeartRateMark from "./HeartRateMark";
import { aliraCharacters } from "@/lib/alira-message-style";
import "@/pages/welcome.css";

// Alira's greeting types out character by character after a short pause, then the invitation appears.
const GREETING_START_MS = 2100;

function layOut(text: string) {
  const { chars, total } = aliraCharacters(text);
  return { chars: chars.map(character => ({ ...character, d: GREETING_START_MS + character.d })), buttonDelay: GREETING_START_MS + total + 400 };
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
          <HeartRateMark size={46} pulseClassName="welcome-ecg" />
        </span>
        <span className="welcome-presence" aria-hidden="true" />
      </button>

      <h1>{headline}</h1>

      <section className="welcome-card" aria-label="A message from Alira">
        <div className="welcome-bubble-row">
          <span className="welcome-mark" aria-hidden="true">
            <HeartRateMark size={16} />
          </span>
          <p className="welcome-bubble">
            <span className="sr-only">Alira: {message}</span>
            {animateGreeting && <span className="welcome-dots" aria-hidden="true"><i /><i /><i /><span>Alira is typing</span></span>}
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
