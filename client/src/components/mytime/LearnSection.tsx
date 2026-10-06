import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { LEARN_CHECKED, learnArticles, type LearnArticle } from "@/content/my-time-learn";
import { splitSentences, useReadAloud, type ReadAloud } from "@/lib/alira-read-aloud";
import { myTimeHref, myTimeStore, readingMinutes } from "@/lib/my-time";
import LearnGlyph from "./LearnGlyph";
import { narrate, type Narration } from "./Reader";
import { articleBlocks, listenStatus, numberWord, numberWordCapital, openedIds, openedLabel, tryNote, tryThisWeekStore } from "./learn-state";

/** How long an answer takes to read: everything on its page that is more than a label. */
export const articleMinutes = (article: LearnArticle) =>
  readingMinutes([article.short, ...article.sections.flatMap(section => [section.heading, ...section.paragraphs]), ...article.tryThisWeek, article.ask]);

/** Where focus goes when Learn changes view: to the answer's title, or back to the card it was opened from. */
type FocusIntent = { to: "answer" } | { to: "card"; id: string } | null;

/** A real link, so it can still open in a new tab; an ordinary click is followed in place. */
function follow(go: () => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    go();
  };
}

const learnedIds = (read: string[]) => read.filter(key => key.startsWith("learn:")).map(key => key.slice("learn:".length));

const PeekIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>;
const ShieldIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2f6851" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z" /><path d="m9 12 2 2 4-4" /></svg>;
const PlayIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M7 4v16l13-8Z" /></svg>;
const PauseIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="5" y="4" width="5" height="16" rx="1.5" /><rect x="14" y="4" width="5" height="16" rx="1.5" /></svg>;
const TickIcon = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fffdf7" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m5 12 5 5 9-10" /></svg>;

// ---------------------------------------------------------------------------------------------
// The list: six questions on cards that turn over to show the short answer.

type LearnListProps = {
  read: string[];
  turned: string[];
  focusIntent: RefObject<FocusIntent>;
  onTurn: (id: string) => void;
  onRead: (id: string) => void;
};

function LearnList({ read, turned, focusIntent, onTurn, onRead }: LearnListProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  // The element to focus once a card has turned: its short answer, or the front again.
  const focusAfterTurn = useRef<string | null>(null);
  const opened = openedIds(learnArticles, read, turned);
  const total = learnArticles.length;

  // Back from an answer: focus returns to the card it was opened from.
  useEffect(() => {
    const intent = focusIntent.current;
    if (intent?.to !== "card") return;
    focusIntent.current = null;
    document.getElementById(`ln-${intent.id}-front`)?.focus({ preventScroll: true });
  }, [focusIntent]);
  useEffect(() => {
    const target = focusAfterTurn.current;
    focusAfterTurn.current = null;
    if (target) document.getElementById(target)?.focus({ preventScroll: true });
  }, [openId]);

  const turnOver = (id: string) => {
    focusAfterTurn.current = `ln-${id}-answer`;
    setOpenId(id);
    onTurn(id);
  };
  const turnBack = (id: string) => {
    focusAfterTurn.current = `ln-${id}-front`;
    setOpenId(null);
  };

  return <div className="ln">
    <header className="ln-intro">
      <div className="ln-lede">
        <h2>What is happening in my body?</h2>
        <p>{numberWordCapital(total)} questions people ask after a stroke. Turn a card over to peek at the answer.</p>
      </div>
      <p className="ln-progress">
        <span>{openedLabel(opened.length, total)}</span>
        <span className="ln-dots" aria-hidden="true">{learnArticles.map(item => <i key={item.id} className={opened.includes(item.id) ? "is-seen" : undefined} />)}</span>
      </p>
    </header>

    <ul className="ln-grid" role="list">
      {learnArticles.map((item, index) => {
        const turnedOver = openId === item.id;
        const id = `ln-${item.id}`;
        return <li key={item.id} className="ln-cell" style={{ animationDelay: `${index * 80}ms` }}>
          <div className={`ln-card${turnedOver ? " is-turned" : ""}`}>
            <div className="ln-inner">
              <button
                type="button"
                id={`${id}-front`}
                className="ln-face ln-front"
                inert={turnedOver}
                aria-expanded={turnedOver}
                aria-controls={`${id}-back`}
                aria-labelledby={`${id}-q ${id}-peek`}
                aria-describedby={`${id}-hook`}
                onClick={() => turnOver(item.id)}
              >
                <span className="ln-top"><LearnGlyph id={item.id} /><span className="ln-kicker">{item.kicker}</span></span>
                <span className="ln-q" id={`${id}-q`}>{item.question}</span>
                <span className="ln-hook" id={`${id}-hook`}>{item.hook}</span>
                <span className="ln-peek" id={`${id}-peek`}><PeekIcon />Turn over for the short answer</span>
              </button>
              <div
                id={`${id}-back`}
                className="ln-face ln-back"
                role="group"
                aria-labelledby={`${id}-q`}
                inert={!turnedOver}
                onKeyDown={event => {
                  if (event.key !== "Escape") return;
                  event.stopPropagation();
                  turnBack(item.id);
                }}
              >
                <div id={`${id}-answer`} className="ln-answer" tabIndex={-1}>
                  <p className="ln-answer-label">The short answer</p>
                  <p className="ln-answer-text">{item.short}</p>
                </div>
                <div className="ln-actions">
                  <a className="ln-go" href={myTimeHref("learn", item.id)} onClick={follow(() => onRead(item.id))}>
                    Read the whole answer<ArrowRight size={15} strokeWidth={2.4} aria-hidden="true" />
                  </a>
                  <button type="button" className="ln-turn" onClick={() => turnBack(item.id)}>Turn back</button>
                </div>
              </div>
            </div>
          </div>
        </li>;
      })}
    </ul>

    <p className="ln-footer">
      <ShieldIcon />
      <span>Checked against the Stroke Association, the NHS and the American Stroke Association, {LEARN_CHECKED}. General information only. Your own stroke team knows you best.</span>
    </p>
  </div>;
}

// ---------------------------------------------------------------------------------------------
// One answer, to read or to listen to.

// When someone scrolls the page themselves (back up to the pause button, say), the page stops
// following the reading for a few seconds instead of pulling them away again.
let scrolledByHandAt = 0;
const HANDS_OFF_MS = 4000;
const SCROLL_KEYS = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"];

function useScrolledByHand() {
  useEffect(() => {
    const moved = () => { scrolledByHandAt = Date.now(); };
    const keyed = (event: KeyboardEvent) => { if (SCROLL_KEYS.includes(event.key)) moved(); };
    window.addEventListener("wheel", moved, { passive: true });
    window.addEventListener("touchmove", moved, { passive: true });
    window.addEventListener("keydown", keyed);
    return () => {
      window.removeEventListener("wheel", moved);
      window.removeEventListener("touchmove", moved);
      window.removeEventListener("keydown", keyed);
    };
  }, []);
}

/** One block of text, sentence by sentence. The sentence being read is lit, and kept in view. */
function Lit({ narration, reading, block, text }: { narration: Narration; reading: ReadAloud; block: string; text: string }) {
  const current = useRef<HTMLSpanElement>(null);
  const start = narration.starts[block] ?? -1;
  const sentences = splitSentences(text);
  const mine = start >= 0 && reading.index >= start && reading.index < start + sentences.length ? reading.index - start : -1;
  useEffect(() => {
    const node = current.current;
    if (mine < 0 || !reading.playing || !node || Date.now() - scrolledByHandAt < HANDS_OFF_MS) return;
    // Only move the page when the sentence is out of comfortable view, so it does not jump at every line.
    const box = node.getBoundingClientRect();
    const height = window.innerHeight || document.documentElement.clientHeight;
    if (box.top >= height * 0.18 && box.bottom <= height * 0.82) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
  }, [mine, reading.playing]);
  return <>{sentences.map((sentence, index) => <Fragment key={index}>
    {index > 0 ? " " : null}
    <span ref={index === mine ? current : undefined} className={index === mine ? "ar-sen is-current" : "ar-sen"}>{sentence}</span>
  </Fragment>)}</>;
}

const WAVE = [10, 18, 26, 14, 32, 22, 12, 28, 36, 20, 14, 30, 24, 12, 34, 18, 26, 10, 22, 32, 16, 28, 12, 24, 36, 18, 14, 22];
const Wave = () => <div className="ar-wave" aria-hidden="true">
  {WAVE.map((height, index) => <i key={index} style={{ height, animationDelay: `-${(index * 137) % 1100}ms` }} />)}
</div>;

type Layout = "wide" | "snug" | "narrow";
const layoutFor = (width: number): Layout => (width >= 960 ? "wide" : width >= 800 ? "snug" : "narrow");

/**
 * Two columns when the answer has room for them, one when it does not. Measured on the page rather
 * than the window, because the side menu takes a different share of the width at each size.
 */
function useLayout(root: RefObject<HTMLElement | null>): Layout {
  const [layout, setLayout] = useState<Layout>(() => (typeof window !== "undefined" && window.innerWidth >= 1100 ? "snug" : "narrow"));
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setLayout(layoutFor(element.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);
  return layout;
}

type ArticleReaderProps = {
  article: LearnArticle;
  shown: boolean;
  large: boolean;
  slow: boolean;
  focusIntent: RefObject<FocusIntent>;
  onLarge: (large: boolean) => void;
  onSlow: (slow: boolean) => void;
  onBack: () => void;
  onOpen: (id: string) => void;
};

function ArticleReader({ article, shown, large, slow, focusIntent, onLarge, onSlow, onBack, onOpen }: ArticleReaderProps) {
  const blocks = useMemo(() => articleBlocks(article), [article]);
  const shownText = useMemo(() => Object.fromEntries(blocks.map(block => [block.key, block.shown] as const)), [blocks]);
  const narration = useMemo(() => narrate(blocks), [blocks]);
  const reading = useReadAloud(narration.lines, shown);
  const root = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const layout = useLayout(root);
  const twoColumns = layout !== "narrow";
  const tips = article.tryThisWeek;
  const [picked, setPicked] = useState(() => tryThisWeekStore.picked(article.id).filter(index => index < tips.length));
  const next = learnArticles[(learnArticles.indexOf(article) + 1) % learnArticles.length];
  const total = learnArticles.length;
  const status = listenStatus(reading, narration.lines.length);
  useScrolledByHand();

  // A slower voice chosen on another answer carries on here.
  useEffect(() => { if (slow) reading.setSlow(true); }, []);
  // Opened from a card or from the previous answer: focus starts at the question.
  useEffect(() => {
    if (focusIntent.current?.to !== "answer") return;
    focusIntent.current = null;
    title.current?.focus({ preventScroll: true });
  }, [focusIntent]);

  const say = (key: string) => <Lit narration={narration} reading={reading} block={key} text={shownText[key] ?? ""} />;
  const pick = (index: number) => setPicked(tryThisWeekStore.toggle(article.id, index).filter(tip => tip < tips.length));
  const setVoice = (nextSlow: boolean) => {
    reading.setSlow(nextSlow);
    onSlow(nextSlow);
  };

  const listen = <div className={`ar-listen${reading.playing ? " is-playing" : ""}`} role="group" aria-label="Listen to this answer">
    <div className="ar-listen-top">
      <button type="button" className="ar-play" onClick={reading.toggle} aria-label={status.playLabel} aria-describedby="ar-listen-note">
        {!reading.playing && <span className="ar-ring" aria-hidden="true" />}
        {reading.playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="ar-listen-words">
        <p className="ar-listen-title">{status.title}</p>
        <p className="ar-listen-note" id="ar-listen-note">{status.note}</p>
      </div>
    </div>
    <Wave />
    <div className="ar-progress" aria-hidden="true"><i style={{ width: `${Math.round(status.progress * 100)}%` }} /></div>
    <div className="ar-switches">
      <button type="button" role="switch" aria-checked={reading.slow} className="ar-switch" onClick={() => setVoice(!reading.slow)}>
        Slower voice<span className="ar-track" aria-hidden="true"><i /></span>
      </button>
      <button type="button" role="switch" aria-checked={large} className="ar-switch" onClick={() => onLarge(!large)}>
        Larger words<span className="ar-track" aria-hidden="true"><i /></span>
      </button>
    </div>
    {/* Said once at the end, or when reading aloud could not start; not at every sentence. */}
    <p className="ar-sr" role="status">{reading.done || reading.note ? status.note : ""}</p>
  </div>;

  const nextQuestion = <a className="ar-next" href={myTimeHref("learn", next.id)} onClick={follow(() => onOpen(next.id))}>
    <span>
      <span className="ar-next-label">Next question</span>
      <span className="ar-next-q">{next.question}</span>
    </span>
    <ArrowRight size={20} strokeWidth={2.4} aria-hidden="true" />
  </a>;

  return <article ref={root} className="ar" aria-labelledby="ar-title">
    <a className="ar-back" href={myTimeHref("learn")} onClick={follow(onBack)}>
      <ArrowLeft size={15} strokeWidth={2.4} aria-hidden="true" />All {numberWord(total)} questions
    </a>
    <div className={`ar-layout is-${layout}`}>
      <div className="ar-main">
        <div className="ar-head">
          <LearnGlyph id={article.id} size="article" />
          <span className="ar-kicker">{article.kicker}</span>
        </div>
        <h2 id="ar-title" ref={title} className="ar-title" tabIndex={-1}>{say("question")}</h2>
        {!twoColumns && listen}
        <div className={`ar-words${large ? " is-large" : ""}`}>
          <div className="ar-short">
            <h3 className="ar-label">The short answer</h3>
            <p>{say("short")}</p>
          </div>
          {article.sections.map((section, at) => <div key={section.heading} className="ar-sec">
            <h3>{say(`heading-${at}`)}</h3>
            {section.paragraphs.map((paragraph, index) => <p key={index}>{say(`para-${at}-${index}`)}</p>)}
          </div>)}
        </div>
        {twoColumns && nextQuestion}
      </div>

      <div className="ar-side">
        {twoColumns && listen}
        <div className="ar-helps">
          <div className="ar-helps-head">
            <h3>{say("helps")}</h3>
            <span className="ar-helps-count" aria-live="polite">{tryNote(picked.length)}</span>
          </div>
          <ul role="list">
            {tips.map((tip, index) => <li key={index}>
              <button type="button" className="ar-try" aria-pressed={picked.includes(index)} onClick={() => pick(index)}>
                <span className="ar-tick" aria-hidden="true"><TickIcon /></span>
                <span>{say(`try-${index}`)}</span>
              </button>
            </li>)}
          </ul>
        </div>
        <div className="ar-ask">
          <h3 className="ar-label">{say("ask-title")}</h3>
          <p>{say("ask")}</p>
        </div>
        <div className="ar-sources">
          <h3 className="ar-label">Where this comes from</h3>
          <ul role="list">
            {article.sources.map(source => <li key={source.url}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                <span className="ar-source-name">{source.label}</span><ExternalLink size={12} aria-hidden="true" /><span className="ar-sr"> (opens in a new tab)</span>
              </a>
            </li>)}
          </ul>
          <p>Checked {LEARN_CHECKED}. General information only.</p>
        </div>
        {!twoColumns && nextQuestion}
      </div>
    </div>
  </article>;
}

// ---------------------------------------------------------------------------------------------

type LearnSectionProps = { shown: boolean; itemId: string | null; read: string[]; onOpen: (id: string | null) => void };

// Short answers to the questions people ask after a stroke. Each card turns over to show the short
// answer; the whole answer opens on its own page, where Alira can read it aloud.
export default function LearnSection({ shown, itemId, read, onOpen }: LearnSectionProps) {
  // Cards turned over are remembered with the articles that were read, so they count as opened.
  // The page above only reloads that list when an article opens, so this visit's turns are kept here too.
  const [turned, setTurned] = useState<string[]>(() => learnedIds(myTimeStore.load().read));
  const [large, setLarge] = useState(false);
  const [slow, setSlow] = useState(false);
  const focusIntent = useRef<FocusIntent>(null);
  const article = learnArticles.find(candidate => candidate.id === itemId);

  const go = (id: string | null, intent: FocusIntent) => {
    focusIntent.current = intent;
    onOpen(id);
  };
  const turn = (id: string) => {
    myTimeStore.markRead("learn", id);
    setTurned(list => (list.includes(id) ? list : [...list, id]));
  };

  if (article) {
    return <ArticleReader
      key={article.id}
      article={article}
      shown={shown}
      large={large}
      slow={slow}
      focusIntent={focusIntent}
      onLarge={setLarge}
      onSlow={setSlow}
      onBack={() => go(null, { to: "card", id: article.id })}
      onOpen={id => go(id, { to: "answer" })}
    />;
  }
  return <LearnList read={read} turned={turned} focusIntent={focusIntent} onTurn={turn} onRead={id => go(id, { to: "answer" })} />;
}
