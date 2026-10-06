import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FocusEvent, type MouseEvent } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { STORIES_NOTE, storyNote, survivorStories, type StoryVoice, type SurvivorStory } from "@/content/my-time-stories";
import { useReadAloud } from "@/lib/alira-read-aloud";
import { myTimeHref, readingMinutes } from "@/lib/my-time";
import { StoryInitial } from "./ReadingArt";
import {
  capitalised,
  countWord,
  filterCounts,
  filterSummary,
  inFilter,
  listenProgress,
  nextLabel,
  nextStory,
  paragraphAt,
  possessive,
  storyFilters,
  storyNarration,
  storyOpening,
  type StoryFilter,
} from "./stories-model";

export const voiceLabel: Record<StoryVoice, string> = { survivor: "A survivor's story", carer: "A carer's story" };
export const storyMinutes = (story: SurvivorStory) => readingMinutes([...story.paragraphs, ...story.helped]);

const sideTag: Record<StoryVoice, string> = { survivor: "Survivor", carer: "Carer" };
/** How long each quote stays in the "In their words" panel before the next one comes in. */
const QUOTE_TURN_MS = 6000;
/** The shape of the waveform under the listen button, the same every time. */
const WAVE = [10, 18, 26, 14, 32, 22, 12, 28, 36, 20, 14, 30, 24, 12, 34, 18, 26, 10, 22, 32, 16, 28, 12, 24, 36, 18, 14, 22];
/** Room kept clear at the top and bottom of the window (on a phone, the bars that stay on screen). */
const VIEW_MARGIN = 88;

// ---------- Small shared pieces ----------

const lessMotionQuery = "(prefers-reduced-motion: reduce)";
function watchMotionSetting(change: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(lessMotionQuery);
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }
  query.addListener(change);
  return () => query.removeListener(change);
}
const prefersLessMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(lessMotionQuery).matches;
/** True when the device has been asked for less motion. It follows the setting if it changes. */
function useLessMotion() {
  return useSyncExternalStore(watchMotionSetting, prefersLessMotion, () => false);
}

/** For real links (they can be opened in a new tab or copied): an ordinary click stays in the page. */
function inPage(go: () => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go();
  };
}

/** Scrolls just enough to bring a paragraph into view, and only when it is not already in view. */
function keepInView(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  if (box.top >= VIEW_MARGIN && box.bottom <= window.innerHeight - VIEW_MARGIN) return;
  const tall = box.height > window.innerHeight - VIEW_MARGIN * 2;
  element.scrollIntoView({ block: tall ? "start" : "center", behavior: prefersLessMotion() ? "instant" : "smooth" });
}

function QuoteMark({ className }: { className: string }) {
  return <svg className={className} viewBox="0 0 62 48" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M0 48V28C0 12 8 2 24 0v10c-7 2-10 7-10 14h10v24Z" />
    <path d="M36 48V28C36 12 44 2 60 0v10c-7 2-10 7-10 14h10v24Z" />
  </svg>;
}

function InfoMark() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" />
  </svg>;
}

function SpeakerMark() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M11 5 6 9H2v6h4l5 4Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>;
}

// ---------- The list ----------

/** The green panel: one line from each person in turn, with a pip to show any of them. */
function InTheirWords({ stories }: { stories: SurvivorStory[] }) {
  const lessMotion = useLessMotion();
  const [turn, setTurn] = useState({ shown: 0, leaving: -1 });
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // A quote someone chose stays: the panel stops turning on its own after that.
  const [chosen, setChosen] = useState(false);
  const turning = !lessMotion && !chosen && !hovered && !focused && stories.length > 1;

  useEffect(() => {
    if (!turning) return;
    const timer = window.setTimeout(() => setTurn(current => ({ shown: (current.shown + 1) % stories.length, leaving: current.shown })), QUOTE_TURN_MS);
    return () => window.clearTimeout(timer);
  }, [turning, turn.shown, stories.length]);

  const choose = (index: number) => {
    setChosen(true);
    setTurn(current => (current.shown === index ? current : { shown: index, leaving: current.shown }));
  };
  const blurred = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  };

  return <section className="st-words" aria-labelledby="st-words-title" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={blurred}>
    <span className="st-glow" aria-hidden="true" />
    <h3 id="st-words-title" className="st-words-kicker">In their words</h3>
    <QuoteMark className="st-mark" />
    <div className="st-quotes" aria-live="off">
      {stories.map((story, index) => <figure key={story.id} className={`st-quote${index === turn.shown ? " is-on" : index === turn.leaving ? " is-leaving" : ""}`} aria-hidden={index !== turn.shown || undefined}>
        <blockquote><p>{story.quote}</p></blockquote>
        <figcaption><b>{story.name}</b>, {story.who}</figcaption>
      </figure>)}
    </div>
    <div className="st-pips" role="group" aria-label="Whose words to show">
      {stories.map((story, index) => <button key={story.id} type="button" className="st-pip" aria-label={`${possessive(story.name)} words`} aria-pressed={index === turn.shown} onClick={() => choose(index)}><i /></button>)}
    </div>
    <p className="st-words-foot"><SpeakerMark /><span>{capitalised(countWord(stories.length))} short stories. Alira can read any of them aloud, one paragraph at a time.</span></p>
  </section>;
}

type StoryCardProps = { story: SurvivorStory; faded: boolean; entering: boolean; read: boolean; onOpen: (id: string) => void };

/** One person's card. The link covers the whole card; a card the filter leaves out fades and is skipped. */
function StoryCard({ story, faded, entering, read, onOpen }: StoryCardProps) {
  return <li className={`st-card${faded ? " is-faded" : entering ? " is-entering" : ""}`} inert={faded}>
    <div className="st-card-head">
      <StoryInitial name={story.name} voice={story.voice} tint={story.tint} className="st-face" />
      <div className="st-card-who"><h3>{story.name}</h3><p>{story.who}</p></div>
      <span className={`st-tag st-tag-${story.voice}`}>{sideTag[story.voice]}</span>
    </div>
    <p className="st-card-quote">{story.quote}</p>
    <span className="st-card-underline" aria-hidden="true" />
    <p className="st-card-opening">{storyOpening(story)}</p>
    <div className="st-card-foot">
      <a id={`st-link-${story.id}`} className="st-card-link" href={myTimeHref("stories", story.id)} onClick={inPage(() => onOpen(story.id))}>
        Read {possessive(story.name)} story<ArrowRight size={15} strokeWidth={2.4} aria-hidden="true" />
      </a>
      {read && <span className="st-card-read"><Check size={14} strokeWidth={2.6} aria-hidden="true" />Already read</span>}
    </div>
  </li>;
}

type StoriesListProps = { filter: StoryFilter; onFilter: (filter: StoryFilter) => void; read: string[]; onOpen: (id: string) => void; returnTo: string | null };

function StoriesList({ filter, onFilter, read, onOpen, returnTo }: StoriesListProps) {
  const counts = useMemo(() => filterCounts(survivorStories), []);
  const [summary, setSummary] = useState("");
  // The cards rise in when the list arrives; after a filter is chosen they only fade in place.
  const [filtered, setFiltered] = useState(false);
  // Back from a story: focus goes to that story's card, where the reader left the list.
  useEffect(() => {
    if (returnTo) document.getElementById(`st-link-${returnTo}`)?.focus({ preventScroll: true });
  }, [returnTo]);
  const pick = (value: StoryFilter) => {
    onFilter(value);
    setFiltered(true);
    setSummary(filterSummary(value, counts));
  };

  return <div className="st">
    <header className="st-intro">
      <div className="st-intro-text">
        <h2>You are not the only one.</h2>
        <p>What recovery is like, from both sides of it.</p>
      </div>
      <div className="st-chips" role="group" aria-label="Whose stories to show">
        {storyFilters.map(({ value, label }) => <button key={value} type="button" className="st-chip" aria-pressed={filter === value} onClick={() => pick(value)}>
          {label}
          <span className="st-chip-count" aria-hidden="true">{counts[value]}</span>
          <span className="st-hidden">, {counts[value]} {counts[value] === 1 ? "story" : "stories"}</span>
        </button>)}
      </div>
    </header>
    <div className="st-body">
      <InTheirWords stories={survivorStories} />
      <ul className="st-grid" role="list">
        {survivorStories.map(story => <StoryCard key={story.id} story={story} faded={!inFilter(filter, story)} entering={!filtered} read={read.includes(`stories:${story.id}`)} onOpen={onOpen} />)}
      </ul>
    </div>
    <p className="st-note"><InfoMark /><span>{STORIES_NOTE}</span></p>
    <p className="st-hidden" role="status">{summary}</p>
  </div>;
}

// ---------- A story, read aloud ----------

/** A paragraph of the story. While Alira reads any sentence in it, the whole paragraph is lit and kept in view. */
function ReadParagraph({ text, lit, follow, opening }: { text: string; lit: boolean; follow: boolean; opening: boolean }) {
  const own = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (lit && follow && own.current) keepInView(own.current);
  }, [lit, follow]);
  return <p ref={own} className={`sr-para${opening ? " sr-para-opening" : ""}${lit ? " is-lit" : ""}`}>{text}</p>;
}

type StoryReaderProps = { story: SurvivorStory; shown: boolean; focusOnOpen: boolean; onBack: () => void; onOpen: (id: string) => void };

function StoryReader({ story, shown, focusOnOpen, onBack, onOpen }: StoryReaderProps) {
  // Only the story itself is read aloud, so everything read is lit while it is read.
  const narration = useMemo(() => storyNarration(story.paragraphs), [story]);
  const reading = useReadAloud(narration.lines, shown);
  const heading = useRef<HTMLHeadingElement>(null);
  const next = nextStory(survivorStories, story.id);
  const lit = paragraphAt(narration, reading.index);
  const theirs = possessive(story.name);
  // The hook's note is either the end of the story (said here in the story's own words) or a problem.
  const problem = !reading.done && reading.note ? reading.note : "";
  const message = problem || (reading.done ? `That is the end of ${theirs} story.` : "");
  const title = reading.playing ? "Alira is reading" : reading.index >= 0 ? "Paused" : reading.done ? "Hear it again" : "Hear it read aloud";
  const playLabel = reading.playing ? "Pause" : reading.index >= 0 ? `Carry on with ${theirs} story` : reading.done ? `Hear ${theirs} story again` : `Hear ${theirs} story`;

  // Arriving from the list or from "Next", focus starts at the story, not at the top of the page.
  useEffect(() => {
    if (focusOnOpen) heading.current?.focus({ preventScroll: true });
    // Only on arrival.
  }, []);

  return <article className="sr" aria-label={`${theirs} story`}>
    <a className="sr-back" href={myTimeHref("stories")} onClick={inPage(onBack)}>
      <ArrowLeft size={15} strokeWidth={2.4} aria-hidden="true" />All {countWord(survivorStories.length)} stories
    </a>
    <div className="sr-layout">
      <header className="sr-hero">
        <span className="st-glow" aria-hidden="true" />
        <div className="sr-person">
          <StoryInitial name={story.name} voice={story.voice} tint={story.tint} className="sr-face" />
          <p className="sr-person-text"><b>{story.name}</b><span>{story.who}</span></p>
          <span className="sr-tag">{sideTag[story.voice]}</span>
        </div>
        <QuoteMark className="sr-mark" />
        <h2 id="sr-title" ref={heading} tabIndex={-1} className="sr-quote">{story.quote}</h2>

        <div className="sr-listen">
          <button type="button" className={`sr-play${reading.playing ? " is-playing" : ""}`} onClick={reading.toggle} aria-label={playLabel}>
            <span className="sr-play-ring" aria-hidden="true" />
            {reading.playing
              ? <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="5" y="4" width="5" height="16" rx="1.5" /><rect x="14" y="4" width="5" height="16" rx="1.5" /></svg>
              : <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M7 4v16l13-8Z" /></svg>}
          </button>
          <div className="sr-listen-text">
            <p className="sr-listen-title">{title}</p>
            {!message && <p className="sr-listen-note">
              {reading.index >= 0
                ? <>Part {lit + 1} of {story.paragraphs.length}, lit up <span className="sr-where-wide">on the right</span><span className="sr-where-narrow">below</span>.</>
                : "Alira reads it, and lights up each part."}
            </p>}
            <p className="sr-listen-note sr-listen-message" role="status">{message}</p>
          </div>
        </div>
        <div className={`sr-wave${reading.playing ? " is-playing" : ""}`} aria-hidden="true">
          {WAVE.map((height, index) => <i key={index} style={{ height, animationDelay: `-${(index * 137) % 1100}ms` }} />)}
        </div>
        <div className="sr-progress" aria-hidden="true"><i style={{ width: `${listenProgress(reading.index, narration.lines.length, reading.done)}%` }} /></div>
        <button type="button" role="switch" aria-checked={reading.slow} className="sr-slow" onClick={() => reading.setSlow(!reading.slow)}>
          Slower voice<span className="sr-switch" aria-hidden="true"><i /></span>
        </button>
      </header>

      <div className="sr-story">
        {story.paragraphs.map((paragraph, index) => <ReadParagraph key={index} text={paragraph} lit={index === lit} follow={reading.playing} opening={index === 0} />)}
        <a className="sr-next" href={myTimeHref("stories", next.id)} onClick={inPage(() => onOpen(next.id))}>
          <span className="sr-next-text">
            <span className="sr-next-label">{nextLabel(next)}</span>
            <span className="sr-next-quote">{next.quote}</span>
            <span className="sr-next-who">{next.name}, {next.who}</span>
          </span>
          <ArrowRight size={20} strokeWidth={2.4} aria-hidden="true" />
        </a>
      </div>

      <section className="sr-helped" aria-labelledby="sr-helped-title">
        <h3 id="sr-helped-title">What helped {story.name}</h3>
        <ol role="list">
          {story.helped.map((thing, index) => <li key={index}><span aria-hidden="true">{index + 1}</span><span>{thing}</span></li>)}
        </ol>
      </section>
      <p className="sr-note"><InfoMark /><span>{storyNote(story)}</span></p>
    </div>
  </article>;
}

type StoriesSectionProps = { shown: boolean; itemId: string | null; read: string[]; onOpen: (id: string | null) => void };

// Stories from people living with stroke and the people who look after them. The list shows a line
// from each and the first lines of their story; the story opens, ready to be read aloud, when chosen.
export default function StoriesSection({ shown, itemId, read, onOpen }: StoriesSectionProps) {
  const [filter, setFilter] = useState<StoryFilter>("all");
  // Set when the view changes from inside Stories, so focus can follow the reader there.
  const [arrival, setArrival] = useState<{ leftStory: string | null } | null>(null);
  const story = survivorStories.find(candidate => candidate.id === itemId);
  const open = (id: string | null) => {
    setArrival({ leftStory: story && id === null ? story.id : null });
    onOpen(id);
  };

  if (story) return <StoryReader key={story.id} story={story} shown={shown} focusOnOpen={arrival !== null} onBack={() => open(null)} onOpen={open} />;
  return <StoriesList filter={filter} onFilter={setFilter} read={read} onOpen={open} returnTo={arrival?.leftStory ?? null} />;
}
