// Day pages: the Journal tab keeps one page per day. The first day the journal is opened is its
// start; nothing before it can be written. Pages, sharing choices and the family list live in this
// browser (like the rest of the site), under one storage key.
import { dayKey } from "./home-stage";

export type JournalMood = -1 | 0 | 1 | 2 | 3 | 4;
export type JournalPage = { mood: JournalMood; text: string; voice?: number; question?: string };
export type FamilyMember = { name: string; email: string };
export type SharePartKey = "words" | "feelings" | "voice" | "questions";
export type JournalShare = { on: boolean; configured: boolean; parts: Record<SharePartKey, boolean>; people: FamilyMember[] };
export type JournalStore = {
  v: 1;
  startKey: string;
  /** Days the administrative control has moved "today" forward, for testing. */
  testDays: number;
  pages: Record<string, JournalPage>;
  shared: Record<string, true>;
  questions: Record<string, number>;
  share: JournalShare;
};

export const JOURNAL_STORAGE_KEY = "rehyn.journal.v1";
/** Kept pages needed before the look-back card appears. */
export const LOOKBACK_AFTER = 5;
export const PAGE_PLACEHOLDER = "Start anywhere. A few words is plenty.";

export const JOURNAL_QUESTIONS = [
  "What is one small thing you did for yourself today?",
  "What made you smile today, even a little?",
  "Who did you enjoy talking to today?",
  "What felt a bit easier today than it did last week?",
  "What would you like to remember about today?",
  "What did your hands help you do today?",
  "Where did you feel most like yourself today?",
  "What are you looking forward to tomorrow?",
  "What was the hardest moment today, and what helped?",
  "What would you tell a friend about today?",
] as const;

export const SHARE_PARTS: { key: SharePartKey; name: string; desc: string }[] = [
  { key: "words", name: "Your words", desc: "What you write on each page" },
  { key: "feelings", name: "How each day felt", desc: "The face you choose each day" },
  { key: "voice", name: "Voice notes", desc: "Anything you say instead of typing" },
  { key: "questions", name: "Alira’s questions", desc: "The question Alira asked that day" },
];

/** Soft page tints and calendar colours per mood, Tough (0) to Great (4). */
export const MOOD_TONES = [
  { page: "#fcf1ec", tint: "#f1d3c6", deep: "#8f3f2b", badgeInk: "#985738", badgeBg: "#f7e5dc" },
  { page: "#fdf5ef", tint: "#f8e8df", deep: "#985738", badgeInk: "#985738", badgeBg: "#f7e5dc" },
  { page: "#fbf8e9", tint: "#f3efdc", deep: "#74621d", badgeInk: "#74621d", badgeBg: "#f3efdc" },
  { page: "#f3f8f0", tint: "#e0ecdf", deep: "#2f6a52", badgeInk: "#2f6a52", badgeBg: "#e5eee7" },
  { page: "#eaf4ec", tint: "#c6ddcc", deep: "#24503d", badgeInk: "#2f6a52", badgeBg: "#e5eee7" },
] as const;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function allParts(): Record<SharePartKey, boolean> {
  return { words: true, feelings: true, voice: true, questions: true };
}

export function freshStore(now = new Date()): JournalStore {
  return { v: 1, startKey: dayKey(now), testDays: 0, pages: {}, shared: {}, questions: {}, share: { on: false, configured: false, parts: allParts(), people: [] } };
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, days: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + days);
  return dayKey(d);
}

/** Whole days from a to b (b later is positive). */
export function daysBetween(a: string, b: string): number {
  return Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 86400000);
}

export function longDate(key: string): string {
  const d = fromKey(key);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function shortWeekday(key: string): string {
  return WEEKDAYS[fromKey(key).getDay()].slice(0, 3).toUpperCase();
}

export function monthName(monthIndex: number): string {
  return MONTHS[((monthIndex % 12) + 12) % 12];
}

/** Months counted as year * 12 + month, so neighbours are one apart. */
export function monthOf(key: string): number {
  const d = fromKey(key);
  return d.getFullYear() * 12 + d.getMonth();
}

/** A Monday-first month grid: nulls pad the first and last weeks. */
export function monthGrid(month: number): (string | null)[] {
  const year = Math.floor(month / 12), m = month % 12;
  const lead = (new Date(year, m, 1).getDay() + 6) % 7;
  const count = new Date(year, m + 1, 0).getDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= count; d++) cells.push(dayKey(new Date(year, m, d)));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** Yesterday, the day before and three days ago, newest first, never before the journal began. */
export function recentDays(todayKey: string, startKey: string, count = 3): string[] {
  const days: string[] = [];
  for (let back = 1; back <= count; back++) {
    const key = addDays(todayKey, -back);
    if (daysBetween(startKey, key) < 0) break;
    days.push(key);
  }
  return days;
}

/** The page to look back on: hidden until enough pages exist, then the one a week before, or the nearest older one. */
export function lookbackDay(pages: Record<string, JournalPage>, viewKey: string, need = LOOKBACK_AFTER): string | null {
  const kept = Object.keys(pages).sort();
  if (kept.length < need) return null;
  const weekAgo = addDays(viewKey, -7);
  if (pages[weekAgo]) return weekAgo;
  for (let i = kept.length - 1; i >= 0; i--) if (kept[i] <= weekAgo) return kept[i];
  return null;
}

export function pickQuestion(not = -1, random: () => number = Math.random): number {
  if (JOURNAL_QUESTIONS.length < 2) return 0;
  let i = Math.floor(random() * JOURNAL_QUESTIONS.length);
  for (let guard = 0; i === not && guard < 20; guard++) i = Math.floor(random() * JOURNAL_QUESTIONS.length);
  return i === not ? (not + 1) % JOURNAL_QUESTIONS.length : i;
}

export function joinNames(people: FamilyMember[]): string {
  const names = people.map((person) => person.name);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function formatSeconds(value: number): string {
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function isMood(value: unknown): value is JournalMood {
  return value === -1 || value === 0 || value === 1 || value === 2 || value === 3 || value === 4;
}

/** Reads a stored journal, dropping anything that does not look like one. */
export function parseStore(raw: string | null, now = new Date()): JournalStore {
  if (!raw) return freshStore(now);
  try {
    const data = JSON.parse(raw) as Partial<JournalStore>;
    if (data?.v !== 1 || typeof data.startKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.startKey)) return freshStore(now);
    const pages: Record<string, JournalPage> = {};
    for (const [key, page] of Object.entries(data.pages ?? {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !page || !isMood(page.mood) || typeof page.text !== "string") continue;
      pages[key] = { mood: page.mood, text: page.text, ...(typeof page.voice === "number" && page.voice > 0 ? { voice: page.voice } : {}), ...(typeof page.question === "string" ? { question: page.question } : {}) };
    }
    const shared: Record<string, true> = {};
    for (const key of Object.keys(data.shared ?? {})) if (pages[key]) shared[key] = true;
    const questions: Record<string, number> = {};
    for (const [key, index] of Object.entries(data.questions ?? {})) if (typeof index === "number" && index >= 0 && index < JOURNAL_QUESTIONS.length) questions[key] = index;
    const share = data.share;
    const people = Array.isArray(share?.people) ? share.people.filter((p) => p && typeof p.name === "string" && p.name.trim() && typeof p.email === "string" && isEmail(p.email)) : [];
    const parts = allParts();
    if (share?.parts) for (const part of SHARE_PARTS) if (typeof share.parts[part.key] === "boolean") parts[part.key] = share.parts[part.key];
    return {
      v: 1,
      startKey: data.startKey,
      testDays: typeof data.testDays === "number" && data.testDays > 0 ? Math.floor(data.testDays) : 0,
      pages, shared, questions,
      share: { on: Boolean(share?.on && people.length), configured: Boolean(share?.configured && people.length), parts, people },
    };
  } catch {
    return freshStore(now);
  }
}

export function loadJournal(now = new Date()): JournalStore {
  try {
    return parseStore(localStorage.getItem(JOURNAL_STORAGE_KEY), now);
  } catch {
    return freshStore(now);
  }
}

export function saveJournal(store: JournalStore) {
  try {
    localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* Storage can be full or blocked; the page keeps working for this visit. */
  }
}
