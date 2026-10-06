import type { LearnArticle } from "@/content/my-time-learn";
import type { ReadAloud } from "@/lib/alira-read-aloud";

// The parts of Learn that are worked out rather than drawn: how many questions have been opened,
// the order an answer is read aloud in, what the Listen panel says, and the "What helps" ticks a
// reader keeps for each answer (on this device only).

const numberWords = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** A small count in words, as it is said aloud: 6 is "six". Larger counts stay as figures. */
export function numberWord(count: number): string {
  return numberWords[count] ?? String(count);
}

/** The same, with a capital letter to start a sentence. */
export function numberWordCapital(count: number): string {
  const word = numberWord(count);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** "None opened yet", "2 of 6 opened", "All six opened". */
export function openedLabel(opened: number, total: number): string {
  if (opened <= 0) return "None opened yet";
  if (opened >= total) return `All ${numberWord(total)} opened`;
  return `${opened} of ${total} opened`;
}

/**
 * The questions that count as opened: read on an earlier visit (the `read` list keeps them as
 * "learn:fatigue"), or turned over during this one.
 */
export function openedIds(articles: { id: string }[], read: string[], turned: string[]): string[] {
  return articles.filter(article => read.includes(`learn:${article.id}`) || turned.includes(article.id)).map(article => article.id);
}

export const HELPS_TITLE = "What helps";
export const ASK_TITLE = "Ask your stroke team";

/**
 * One piece of an answer, in the order Alira reads it. `text` is what she says and `shown` is
 * what the page shows; they split into the same number of sentences, so every sentence read is lit.
 */
export type ArticleBlock = { key: string; text: string; shown: string };

/** A heading read aloud ends like a sentence, so the voice falls at the end of it. */
const spokenAsSentence = (text: string) => (/[.!?]["”’)]*$/.test(text.trim()) ? text : `${text}.`);

/** The answer as Alira reads it: the question, the short answer, each section, what helps, and the question to ask. */
export function articleBlocks(article: LearnArticle): ArticleBlock[] {
  const said = (key: string, shown: string, text = shown): ArticleBlock => ({ key, text, shown });
  const blocks = [said("question", article.question), said("short", article.short)];
  article.sections.forEach((section, at) => {
    blocks.push(said(`heading-${at}`, section.heading, spokenAsSentence(section.heading)));
    section.paragraphs.forEach((paragraph, index) => blocks.push(said(`para-${at}-${index}`, paragraph)));
  });
  blocks.push(said("helps", HELPS_TITLE, spokenAsSentence(HELPS_TITLE)));
  article.tryThisWeek.forEach((tip, index) => blocks.push(said(`try-${index}`, tip)));
  blocks.push(said("ask-title", ASK_TITLE, spokenAsSentence(ASK_TITLE)), said("ask", article.ask));
  return blocks;
}

export type ListenStatus = { title: string; note: string; playLabel: string; progress: number };

/** What the Listen panel says, from where the reading is. `total` is the number of sentences. */
export function listenStatus(reading: Pick<ReadAloud, "index" | "playing" | "note" | "done">, total: number): ListenStatus {
  // The hook only leaves a note at the end, or when reading aloud could not start.
  const failed = reading.note !== "" && !reading.done;
  const started = reading.index >= 0;
  const title = reading.playing ? "Alira is reading" : failed ? "Listen with Alira" : reading.done ? "Listen again" : started ? "Paused" : "Listen with Alira";
  const note = failed
    ? reading.note
    : reading.done
      ? "That is the whole answer. Well done."
      : started
        ? `Sentence ${reading.index + 1} of ${total}. The words light up as she reads.`
        : "She reads one sentence at a time, and lights it up.";
  const playLabel = reading.playing ? "Pause" : reading.done ? "Listen again" : started && !failed ? "Carry on listening" : "Listen with Alira";
  const progress = reading.done ? 1 : started && total > 0 ? Math.min(1, (reading.index + 1) / total) : 0;
  return { title, note, playLabel, progress };
}

/** "Tap one to try this week", "1 to try this week", "2 to try this week". */
export function tryNote(picked: number): string {
  return picked <= 0 ? "Tap one to try this week" : `${picked} to try this week`;
}

export const TRY_THIS_WEEK_KEY = "rehyn.mytime.trythisweek.v1";
/** For each answer, the tips (by their place in its list) the reader has ticked to try. */
export type TryPicks = Record<string, number[]>;
type TryStorage = Pick<Storage, "getItem" | "setItem">;

/** The Monday that starts the week holding `now`, as "2026-10-05". The ticks belong to one week. */
export function weekOf(now: Date): string {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

const cleanPicks = (value: unknown): number[] => (Array.isArray(value)
  ? Array.from(new Set(value.filter((pick): pick is number => typeof pick === "number" && Number.isInteger(pick) && pick >= 0))).sort((a, b) => a - b)
  : []);

function readPicks(raw: string | null, week: string): TryPicks {
  const picks: TryPicks = {};
  try {
    const saved = JSON.parse(raw ?? "null");
    // "Try this week" means this week: last week's ticks are cleared when a new week starts.
    if (!saved || typeof saved !== "object" || Array.isArray(saved) || saved.week !== week) return picks;
    const all = saved.picks;
    if (!all || typeof all !== "object" || Array.isArray(all)) return picks;
    Object.keys(all).forEach(id => {
      const clean = cleanPicks(all[id]);
      if (clean.length) picks[id] = clean;
    });
  } catch { /* unreadable: start fresh */ }
  return picks;
}

/** Ticks a tip, or unticks it. */
export function togglePick(picks: number[], index: number): number[] {
  return picks.includes(index) ? picks.filter(pick => pick !== index) : [...picks, index].sort((a, b) => a - b);
}

/**
 * The ticks, remembered on this device. Once read, they are also held here for the rest of the
 * visit, so they still work when storage is blocked or full.
 */
export function createTryThisWeekStore(storage: () => TryStorage, now: () => Date = () => new Date()) {
  let kept: { week: string; picks: TryPicks } | null = null;
  const load = (): { week: string; picks: TryPicks } => {
    const week = weekOf(now());
    if (!kept || kept.week !== week) {
      let picks: TryPicks = {};
      try { picks = readPicks(storage().getItem(TRY_THIS_WEEK_KEY), week); } catch { picks = {}; }
      kept = { week, picks };
    }
    return kept;
  };
  return {
    picked: (articleId: string): number[] => [...(load().picks[articleId] ?? [])],
    toggle: (articleId: string, index: number): number[] => {
      const { week, picks } = load();
      const all: TryPicks = { ...picks };
      const next = togglePick(all[articleId] ?? [], index);
      if (next.length) all[articleId] = next;
      else delete all[articleId];
      kept = { week, picks: all };
      try { storage().setItem(TRY_THIS_WEEK_KEY, JSON.stringify({ week, picks: all })); } catch { /* private mode: kept for this visit only */ }
      return [...next];
    },
  };
}

export const tryThisWeekStore = createTryThisWeekStore(() => localStorage);
