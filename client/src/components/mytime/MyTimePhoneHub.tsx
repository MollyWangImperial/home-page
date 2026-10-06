import { useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, Heart } from "lucide-react";
import { learnArticles, type LearnArticle } from "@/content/my-time-learn";
import { survivorStories, type SurvivorStory } from "@/content/my-time-stories";
import { splitSentences } from "@/lib/alira-read-aloud";
import { countWord, myTimeActivities, type MyTimeSection } from "@/lib/my-time";
import ActivityIcon from "./ActivityIcon";
import { turnClass, useMediaQuery, useTurn } from "./hub-motion";
import { ArticleGlyph, StoryInitial } from "./ReadingArt";

type MyTimePhoneHubProps = {
  /** Today's question and today's story, chosen once per visit. */
  article: LearnArticle;
  story: SurvivorStory;
  /** The other questions offered beside today's. */
  alsoAsked: LearnArticle[];
  onGo: (section: MyTimeSection, item?: string) => void;
};

const pondHelps = splitSentences(myTimeActivities.find(activity => activity.id === "pond")?.helps ?? "")[0] ?? "";
// The heights of the bars in the little waveform under a story, in pixels.
const WAVE = [8, 14, 20, 10, 24, 16, 8, 22, 26, 14, 10, 22, 18, 8, 24, 12, 20, 8, 16, 24, 12, 20, 8, 18, 26, 12, 10, 16, 22, 12];

/** "63, eight months after his stroke" becomes ["63", "Eight months after his stroke"]. */
function splitWho(who: string): [string | null, string] {
  const match = /^(\d+),\s*(.+)$/.exec(who);
  return match ? [match[1], match[2].charAt(0).toUpperCase() + match[2].slice(1)] : [null, who];
}

function QuoteMarks({ className, width, height }: { className: string; width: number; height: number }) {
  return <svg className={className} width={width} height={height} viewBox="0 0 62 48" fill="#f1cf7a" aria-hidden="true">
    <path d="M0 48V28C0 12 8 2 24 0v10c-7 2-10 7-10 14h10v24Z" /><path d="M36 48V28C36 12 44 2 60 0v10c-7 2-10 7-10 14h10v24Z" />
  </svg>;
}

/** A little pond, only to look at: two koi circling between the lily pads. The real one is in Play. */
function PondScene() {
  return <div className="phone-pond" aria-hidden="true">
    <i className="phone-ripple" /><i className="phone-ripple phone-ripple-late" />
    <svg className="phone-pond-pads" viewBox="0 0 324 168" preserveAspectRatio="xMidYMid slice" fill="none">
      <g transform="translate(52 44) rotate(20)"><path d="M0 0 22 -5A23 23 0 1 0 22 5Z" fill="#8fc08e" /></g>
      <g transform="translate(276 126) rotate(-40)"><path d="M0 0 24 -6A25 25 0 1 0 24 6Z" fill="#8fc08e" /></g>
      <g transform="translate(276 126)">
        <ellipse rx="5" ry="12" fill="#f7dfe0" /><ellipse rx="5" ry="12" fill="#edbcc0" transform="rotate(45)" />
        <ellipse rx="5" ry="12" fill="#f7dfe0" transform="rotate(90)" /><ellipse rx="5" ry="12" fill="#edbcc0" transform="rotate(135)" />
        <circle r="4" fill="#f1cf7a" />
      </g>
    </svg>
    <span className="phone-swim">
      <svg className="phone-koi" viewBox="0 0 84 34" fill="none">
        <path d="M14 17C8 12 4 6 1 3c1 6 1 10 0 14 1 4 1 8 0 14 3-3 7-9 13-14Z" fill="#fff6ea" />
        <path d="M12 17c8-9 26-13 44-10 12 2 22 6 26 10-4 4-14 8-26 10-18 3-36-1-44-10Z" fill="#fff6ea" />
        <path d="M62 9c-7-2-14-1-19 2 5 5 14 5 19-2ZM32 22c5 4 12 4 16 0-5-3-11-3-16 0Z" fill="#e58a5c" />
      </svg>
    </span>
    <span className="phone-swim phone-swim-late">
      <svg className="phone-koi" viewBox="0 0 84 34" fill="none">
        <path d="M14 17C8 12 4 6 1 3c1 6 1 10 0 14 1 4 1 8 0 14 3-3 7-9 13-14Z" fill="#f2b98e" />
        <path d="M12 17c8-9 26-13 44-10 12 2 22 6 26 10-4 4-14 8-26 10-18 3-36-1-44-10Z" fill="#eaa06c" />
        <path d="M56 10c-6-2-11-1-15 2 4 4 11 4 15-2Z" fill="#fff6ea" />
      </svg>
    </span>
  </div>;
}

type PanelProps = { id: string; open: boolean; onOpen: () => void; tile: ReactNode; title: string; line: string; children: ReactNode };

/** One door of the accordion: a header that opens it, and what is behind it. */
function Panel({ id, open, onOpen, tile, title, line, children }: PanelProps) {
  return <section className={`phone-panel phone-${id}${open ? " is-open" : ""}`}>
    <h2 className="phone-panel-head">
      {/* One panel is always open, so the open one's header cannot close it (it says so with aria-disabled). */}
      <button type="button" id={`phone-${id}-head`} aria-expanded={open} aria-controls={`phone-${id}-body`} aria-disabled={open || undefined} onClick={onOpen}>
        <span className="phone-tile" aria-hidden="true">{tile}</span>
        <span className="phone-head-words"><span className="phone-head-title">{title}</span><span className="phone-head-line">{line}</span></span>
        <span className="phone-chev" aria-hidden="true"><ChevronDown size={16} strokeWidth={2.6} /></span>
      </button>
    </h2>
    {/* A closed panel's contents are hidden from everyone (visibility: hidden) once it has folded away. */}
    <div className="phone-panel-body" id={`phone-${id}-body`} role="region" aria-labelledby={`phone-${id}-head`}>
      <div className="phone-panel-clip"><div className="phone-panel-content">{children}</div></div>
    </div>
  </section>;
}

// The front of My Time on a phone: the same three doors as an accordion, one open at a time, the
// first to begin with. Learn offers today's question, with others turning slowly beside it.
export default function MyTimePhoneHub({ article, story, alsoAsked, onGo }: MyTimePhoneHubProps) {
  const [open, setOpen] = useState(0);
  const still = useMediaQuery("(prefers-reduced-motion: reduce)");
  // The accordion is only shown on a phone; the other questions turn only while they can be seen.
  const narrow = useMediaQuery("(max-width: 620px)");
  const asked = still ? alsoAsked.slice(0, 1) : alsoAsked;
  const askTurn = useTurn(asked.length, narrow && open === 1);
  const [age, situation] = splitWho(story.who);

  return <div className="mytime-phone-hub">
    <Panel id="play" open={open === 0} onOpen={() => setOpen(0)} tile={<ActivityIcon id="pond" />} title="Play and unwind" line="Nine gentle things, each here for a reason">
      <PondScene />
      <h3 className="phone-play-title">A pond that likes company.</h3>
      <p className="phone-play-line">Touch the water and the koi come to find you.</p>
      <p className="phone-helps"><Heart size={16} strokeWidth={2.2} aria-hidden="true" /><span><b>How this helps.</b> {pondHelps}</span></p>
      <div className="phone-actions">
        <button type="button" className="phone-cta" onClick={() => onGo("play", "pond")}>Touch the water<ArrowRight size={15} strokeWidth={2.4} aria-hidden="true" /></button>
        <button type="button" className="phone-more" onClick={() => onGo("play")}>See all nine</button>
      </div>
    </Panel>

    <Panel id="learn" open={open === 1} onOpen={() => setOpen(1)} tile={<span className={`phone-glyph phone-glyph-${article.id}`}><ArticleGlyph id={article.id} /></span>} title="Understand your recovery" line={article.question}>
      <span className="phone-kicker">Today's question · {article.kicker}</span>
      <h3 className="phone-question" id="phone-question">{article.question}</h3>
      <p className="phone-hook">{article.hook}</p>
      {asked.length > 0 && <div className="phone-also" role="group" aria-labelledby="phone-also-label" {...askTurn.hold}>
        <span className="phone-also-label" id="phone-also-label">People also ask</span>
        <div className="phone-also-turn" aria-live="off">
          {asked.map((item, index) => <button key={item.id} type="button" className={turnClass(askTurn, index, "phone-also-item")} onClick={() => onGo("learn", item.id)}>
            <span>{item.question}</span><ArrowRight size={15} strokeWidth={2.4} aria-hidden="true" />
          </button>)}
        </div>
      </div>}
      <div className="phone-actions">
        <button type="button" className="phone-cta" onClick={() => onGo("learn", article.id)} aria-describedby="phone-question">Read or listen<ArrowRight size={15} strokeWidth={2.4} aria-hidden="true" /></button>
        <button type="button" className="phone-more" onClick={() => onGo("learn")}>All {countWord(learnArticles.length)} questions</button>
      </div>
    </Panel>

    <Panel id="stories" open={open === 2} onOpen={() => setOpen(2)} tile={<QuoteMarks className="phone-tile-marks" width={26} height={20} />} title="People who have been here" line="Stories from survivors and carers">
      <QuoteMarks className="phone-mark" width={46} height={36} />
      <h3 className="phone-quote">{story.quote}</h3>
      <p className="phone-byline">
        <StoryInitial name={story.name} voice={story.voice} tint={story.tint} />
        <span><b>{story.name}</b>{age && `, ${age}`}<br />{situation}</span>
      </p>
      <div className="phone-wave" aria-hidden="true">{WAVE.map((height, index) => <i key={index} style={{ height, animationDelay: `-${(index * 137) % 1100}ms` }} />)}</div>
      <p className="phone-listen">Alira can read it to you.</p>
      <div className="phone-actions">
        <button type="button" className="phone-cta" onClick={() => onGo("stories", story.id)}>Read {story.pronoun ?? "their"} story<ArrowRight size={15} strokeWidth={2.4} aria-hidden="true" /></button>
        <button type="button" className="phone-more" onClick={() => onGo("stories")}>All {countWord(survivorStories.length)} stories</button>
      </div>
    </Panel>
  </div>;
}
