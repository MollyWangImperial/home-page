// The small moving picture on each Learn question: a tinted tile with a drawing that says what the
// answer is about. Drawn here so no image files are needed; the movement stops for anyone who asks
// for less motion.

const tints: Record<string, string> = {
  rewiring: "#e3efe6",
  fatigue: "#f8e7d6",
  emotions: "#e2edf6",
  hand: "#f6e6dc",
  words: "#ece7f5",
  again: "#e3efe6",
};

function Picture({ id }: { id: string }) {
  switch (id) {
    case "rewiring": // new roads between the healthy parts of the brain
      return <>
        <path className="ln-g-dash" d="M10 14 24 22M24 22 38 16M24 22 14 34M24 22 30 36M24 8v14" stroke="#2f6851" strokeWidth="2" strokeLinecap="round" />
        <circle cx="24" cy="22" r="5" fill="#2f6851" />
        <circle className="ln-g-pulse" cx="10" cy="14" r="3.5" fill="#bc6949" />
        <circle className="ln-g-pulse" cx="38" cy="16" r="3.5" fill="#bc6949" style={{ animationDelay: ".5s" }} />
        <circle className="ln-g-pulse" cx="14" cy="34" r="3.5" fill="#bc6949" style={{ animationDelay: "1s" }} />
        <circle className="ln-g-pulse" cx="30" cy="36" r="3.5" fill="#bc6949" style={{ animationDelay: "1.5s" }} />
        <circle className="ln-g-pulse" cx="24" cy="8" r="3" fill="#e8bd55" style={{ animationDelay: ".8s" }} />
      </>;
    case "fatigue": // a battery that drains
      return <>
        <rect x="6" y="15" width="32" height="18" rx="5" stroke="#83533d" strokeWidth="2.4" />
        <rect x="39" y="20" width="4" height="8" rx="2" fill="#83533d" />
        <rect className="ln-g-fill" x="10" y="19" width="24" height="10" rx="2.5" fill="#e8a05c" />
      </>;
    case "emotions": // eyes, and tears that come anyway
      return <>
        <path d="M8 20c4-6 12-6 16 0M24 20c4-6 12-6 16 0" stroke="#3d6f95" strokeWidth="2.4" strokeLinecap="round" />
        <path className="ln-g-drop" d="M14 24c3 4 5 6 5 9a5 5 0 0 1-10 0c0-3 2-5 5-9Z" fill="#6ea3cc" />
        <path className="ln-g-drop" d="M34 24c3 4 5 6 5 9a5 5 0 0 1-10 0c0-3 2-5 5-9Z" fill="#9cc3e2" style={{ animationDelay: "1.3s" }} />
      </>;
    case "hand": // the message finding its way to where it is going
      return <>
        <circle cx="11" cy="11" r="6" fill="#bc6949" />
        <path className="ln-g-dash" d="M16 15c10 3 4 14 15 17" stroke="#83533d" strokeWidth="2.4" strokeLinecap="round" />
        <circle className="ln-g-pulse" cx="37" cy="36" r="6" stroke="#2f6851" strokeWidth="2.4" />
        <circle cx="37" cy="36" r="2.4" fill="#2f6851" />
      </>;
    case "words": // a word on its way
      return <>
        <path d="M7 12a5 5 0 0 1 5-5h24a5 5 0 0 1 5 5v15a5 5 0 0 1-5 5H22l-8 8v-8h-2a5 5 0 0 1-5-5Z" fill="#fffefa" stroke="#6b5a9a" strokeWidth="2.4" strokeLinejoin="round" />
        <circle className="ln-g-dot" cx="16" cy="20" r="2.6" fill="#6b5a9a" />
        <circle className="ln-g-dot" cx="24" cy="20" r="2.6" fill="#6b5a9a" style={{ animationDelay: ".25s" }} />
        <circle className="ln-g-dot" cx="32" cy="20" r="2.6" fill="#6b5a9a" style={{ animationDelay: ".5s" }} />
      </>;
    case "again": // coming round again, and the heart looked after
      return <>
        <g className="ln-g-spin">
          <path d="M24 7a17 17 0 1 1-15 9" stroke="#2f6851" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M4 12l5 5 5-6" stroke="#2f6851" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <path d="M24 31c-5-4-8-6-8-10a4 4 0 0 1 8-2 4 4 0 0 1 8 2c0 4-3 6-8 10Z" fill="#bc6949" />
      </>;
    default:
      return <circle cx="24" cy="24" r="7" fill="#2f6851" />;
  }
}

/** The tile for a Learn question: 56px on the cards, 50px at the top of an answer. */
export default function LearnGlyph({ id, size = "card" }: { id: string; size?: "card" | "article" }) {
  return <span className={`ln-glyph ln-glyph-${size}`} style={{ background: tints[id] ?? "#e3efe6" }} aria-hidden="true">
    <svg viewBox="0 0 48 48" fill="none" focusable="false"><Picture id={id} /></svg>
  </span>;
}
