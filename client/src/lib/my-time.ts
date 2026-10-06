import { dayKey } from "./home-stage";

// My Time has three sections: things to do (play), short answers about stroke (learn) and stories
// from survivors and carers. This file holds the list of activities and why each one is there,
// the choice of what to show first, and the little that is remembered between visits (on this
// device only).

export type MyTimeSection = "play" | "learn" | "stories";
const sections: MyTimeSection[] = ["play", "learn", "stories"];

/** Where a My Time link points. A link with only ?activity=… is an older link into the activities. */
export function myTimeViewFromQuery(search: string): { section: MyTimeSection | null; activity: MyTimeActivityId | null; item: string | null } {
  const query = new URLSearchParams(search);
  const activity = activityFromQuery(query.get("activity"));
  const named = query.get("section") as MyTimeSection | null;
  const section = named && sections.includes(named) ? named : activity ? "play" : null;
  const item = section === "learn" ? query.get("read") : section === "stories" ? query.get("story") : null;
  return { section, activity: section === "play" ? activity : null, item: item || null };
}

/** The address of a My Time view: the front page, a section, or one thing inside a section. */
export function myTimeHref(section?: MyTimeSection | null, item?: string | null): string {
  if (!section) return "/my-time";
  const key = section === "play" ? "activity" : section === "learn" ? "read" : "story";
  return `/my-time?section=${section}${item ? `&${key}=${encodeURIComponent(item)}` : ""}`;
}

export type MyTimeActivityId =
  | "breathing"
  | "pond"
  | "memory_game"
  | "chimes"
  | "colour"
  | "postcard"
  | "story"
  | "sounds"
  | "lantern";

export type MyTimeActivity = {
  id: MyTimeActivityId;
  /** Short name on the picker. */
  label: string;
  /** The heading inside the activity, so the picker and the panel can point at each other. */
  titleId: string;
  /** What to focus when Alira or Home opens My Time at this activity. */
  control: string;
  /** Why it is here: how it can help someone recovering from a stroke, in a sentence or two. */
  helps: string;
  /**
   * Where a claim in `helps` comes from, when it makes one. The page names the publisher
   * ("Source: Stroke Association"); the title of the page it links to is kept for its tooltip.
   */
  source?: { publisher: string; title: string; url: string };
};

const strokeAssociation = "https://www.stroke.org.uk/stroke/";

export const myTimeActivities: MyTimeActivity[] = [
  {
    id: "breathing", label: "Breathe", titleId: "breathing-title", control: ".breathing-start",
    helps: "Around one in four people experience anxiety within five years of a stroke. Slowing your breath, with a longer breath out, is a simple and widely used way to settle your body when worry rises.",
    source: { publisher: "Stroke Association", title: "Depression and anxiety", url: `${strokeAssociation}effects/emotional-and-behavioural/depression-and-anxiety` },
  },
  {
    id: "pond", label: "Koi pond", titleId: "pond-title", control: ".pond-water",
    helps: "Reaching out to touch a spot is gentle, unhurried practice in aiming your hand. If your therapist is happy for you to, use your affected hand. There is nothing to finish, so there is nothing to get wrong.",
  },
  {
    id: "memory_game", label: "Pairs", titleId: "pairs-title", control: "button:not([disabled])",
    helps: "Memory and concentration often change after a stroke. A short game with no clock gives both a light workout, with no pressure at all.",
  },
  {
    id: "chimes", label: "Chimes", titleId: "chimes-title", control: ".chime-tube",
    helps: "Touching one chime at a time practises aim and timing with your hand. Reviews of the research suggest music activities may help movement, communication and quality of life after a stroke, though the evidence is still limited.",
    source: { publisher: "Cochrane review", title: "Music interventions for acquired brain injury", url: "https://www.cochrane.org/evidence/CD006787_music-interventions-acquired-brain-injury" },
  },
  {
    id: "colour", label: "Colour", titleId: "colour-title", control: ".colour-swatch",
    helps: "Choosing a colour and touching a small pane practises steady, accurate movement, and filling the whole window takes your eyes and hand to both sides. It is absorbing too, which gives a busy mind a rest.",
  },
  {
    id: "postcard", label: "Postcard", titleId: "postcard-title", control: ".postcard-turn",
    helps: "Days in recovery can blur into each other. One small new thing each morning gives the day a marker, and a calm minute to look forward to.",
  },
  {
    id: "story", label: "Story", titleId: "story-title", control: ".story-play",
    helps: "Following a story uses listening, attention and memory together. Hearing each sentence while it is lit on the page makes it easier to keep your place if reading has become harder.",
  },
  {
    id: "sounds", label: "Sounds", titleId: "sounds-title", control: "button",
    helps: "Fatigue after a stroke is very common, and proper breaks before and after doing things are part of managing it. This is a place to take one.",
    source: { publisher: "Stroke Association", title: "Managing post-stroke fatigue", url: `${strokeAssociation}effects/physical/managing-fatigue` },
  },
  {
    id: "lantern", label: "Lantern", titleId: "lantern-title", control: "input",
    helps: "Low mood and worry are common after a stroke, and talking a worry through can put it in perspective. Naming one and letting it go is a small way to set it down before sleep. If a worry stays, tell your GP or stroke team.",
    source: { publisher: "Stroke Association", title: "Depression and anxiety", url: `${strokeAssociation}effects/emotional-and-behavioural/depression-and-anxiety` },
  },
];

const ids = myTimeActivities.map(activity => activity.id);

/** The activity named in /my-time?activity=…, or null when there is none or it is not one of ours. */
export function activityFromQuery(value: string | null | undefined): MyTimeActivityId | null {
  return ids.includes(value as MyTimeActivityId) ? (value as MyTimeActivityId) : null;
}

export type DayPart = "morning" | "afternoon" | "evening" | "night";

export function dayPart(now: Date): DayPart {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

/** Whole local days since 1 January 1970, so daily things change at midnight where the person is. */
export function dayNumber(now: Date): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
}

const afternoons: { id: MyTimeActivityId; line: string }[] = [
  { id: "pond", line: "A slow afternoon. The koi could use some company." },
  { id: "chimes", line: "A slow afternoon. The chimes are waiting for a hand." },
  { id: "colour", line: "A slow afternoon. There is a window that wants some colour." },
  { id: "memory_game", line: "A slow afternoon. Time for a gentle game, perhaps." },
];

/** What My Time opens with: it follows the time of day, and the afternoon pick changes daily. */
export function suggestedActivity(now: Date): { id: MyTimeActivityId; line: string } {
  const part = dayPart(now);
  if (part === "morning") return { id: "postcard", line: "Good morning. Today's postcard has arrived." };
  if (part === "afternoon") return afternoons[dayNumber(now) % afternoons.length];
  if (part === "evening") return { id: "story", line: "Evening already. Shall we read a little?" };
  return { id: "lantern", line: "It is late. Let one thought go, then rest." };
}

/** The neighbour one step along the picker, wrapping at both ends. */
export function neighbour(current: MyTimeActivityId, step: 1 | -1): MyTimeActivity {
  const index = ids.indexOf(current);
  return myTimeActivities[(index + step + ids.length) % ids.length];
}

/** Something different: never the current one, and something not yet tried when there is any. */
export function surpriseActivity(current: MyTimeActivityId, tried: MyTimeActivityId[], roll: number): MyTimeActivityId {
  const others = ids.filter(id => id !== current);
  const untried = others.filter(id => !tried.includes(id));
  const pool = untried.length ? untried : others;
  const safeRoll = Math.max(0, Math.min(Number.isFinite(roll) ? roll : 0, 0.999999));
  return pool[Math.floor(safeRoll * pool.length)];
}

/**
 * What a section shows off on the front page: something not opened yet when there is any, and a
 * different one each day so the page is worth coming back to.
 */
export function featured<T extends { id: string }>(items: T[], opened: string[], day: number): T {
  const fresh = items.filter(item => !opened.includes(item.id));
  const pool = fresh.length ? fresh : items;
  return pool[((day % pool.length) + pool.length) % pool.length];
}

/** What the Learn and Stories doors on the front page turn through, one every few seconds. */
export const HUB_LEARN_TURN = ["fatigue", "emotions", "rewiring"];
export const HUB_STORY_TURN = ["david", "margaret", "lin"];

/**
 * The things a front-page door turns through: those named, in that order, starting from the one
 * featured today when it is among them. A name that is not found is skipped, and if none is found
 * the door turns through the first three instead.
 */
export function doorTurn<T extends { id: string }>(items: T[], ids: string[], startId?: string): T[] {
  const named = ids.map(id => items.find(item => item.id === id)).filter((item): item is T => item !== undefined);
  const turn = named.length ? named : items.slice(0, 3);
  const start = Math.max(0, turn.findIndex(item => item.id === startId));
  return [...turn.slice(start), ...turn.slice(0, start)];
}

/**
 * The other questions offered beside today's ("People also ask"): ones not opened yet first, then
 * the rest, each group in list order from the one after today's.
 */
export function alsoAsked<T extends { id: string }>(items: T[], todayId: string, opened: string[], count = 3): T[] {
  const at = items.findIndex(item => item.id === todayId);
  const others = [...items.slice(at + 1), ...items.slice(0, Math.max(at, 0))];
  return [...others.filter(item => !opened.includes(item.id)), ...others.filter(item => opened.includes(item.id))].slice(0, count);
}

const numberWords = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** A small count in words, as it is said ("All six questions"). Larger counts stay as figures. */
export function countWord(count: number): string {
  return numberWords[count] ?? String(count);
}

/** How long something takes to read, from its words, at an unhurried pace. */
export function readingMinutes(texts: string[]): number {
  const words = texts.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 160));
}

/** The seven day keys of the week that holds `now`, Monday first. */
export function weekDays(now: Date): string[] {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => dayKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index)));
}

export const MY_TIME_KEY = "rehyn.mytime.v1";
export type WindowFills = Record<string, string>;
export type StoryPlace = { chapter: number; sentence: number };
export type MyTimeMemory = {
  tried: MyTimeActivityId[];
  pondDays: string[];
  windows: Record<string, WindowFills>;
  kept: string[];
  story: StoryPlace;
  /** Articles and survivor stories that have been opened, as "learn:fatigue" or "stories:david". */
  read: string[];
};
type MyTimeStorage = Pick<Storage, "getItem" | "setItem">;

const blank = (): MyTimeMemory => ({ tried: [], pondDays: [], windows: {}, kept: [], story: { chapter: 0, sentence: 0 }, read: [] });
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const count = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);

function read(raw: string | null): MyTimeMemory {
  const memory = blank();
  try {
    const saved = JSON.parse(raw ?? "null");
    if (!saved || typeof saved !== "object") return memory;
    memory.tried = strings(saved.tried).filter((id): id is MyTimeActivityId => ids.includes(id as MyTimeActivityId));
    memory.pondDays = strings(saved.pondDays);
    memory.kept = strings(saved.kept);
    memory.read = strings(saved.read);
    if (saved.windows && typeof saved.windows === "object") {
      Object.keys(saved.windows).forEach(id => {
        const fills = saved.windows[id];
        if (!fills || typeof fills !== "object") return;
        const clean: WindowFills = {};
        Object.keys(fills).forEach(pane => { if (typeof fills[pane] === "string") clean[pane] = fills[pane]; });
        memory.windows[id] = clean;
      });
    }
    memory.story = { chapter: count(saved.story?.chapter), sentence: count(saved.story?.sentence) };
  } catch { /* unreadable: start fresh */ }
  return memory;
}

export function createMyTimeStore(storage: () => MyTimeStorage) {
  const load = (): MyTimeMemory => {
    try { return read(storage().getItem(MY_TIME_KEY)); } catch { return blank(); }
  };
  const change = (edit: (memory: MyTimeMemory) => void): MyTimeMemory => {
    const memory = load();
    edit(memory);
    try { storage().setItem(MY_TIME_KEY, JSON.stringify(memory)); } catch { /* private mode: it simply isn't remembered */ }
    return memory;
  };
  return {
    load,
    /** Remembers that an activity has been opened, so its "new" dot can go. */
    markTried: (id: MyTimeActivityId) => change(memory => { if (!memory.tried.includes(id)) memory.tried.push(id); }).tried,
    /** A lily opens for today. Only the last five weeks are kept. */
    visitPond: (now: Date) => change(memory => {
      const today = dayKey(now);
      if (!memory.pondDays.includes(today)) memory.pondDays = [...memory.pondDays, today].sort().slice(-35);
    }).pondDays,
    /** Monday to Sunday of this week: true where the pond was visited. */
    lilies: (now: Date) => {
      const visited = load().pondDays;
      return weekDays(now).map(day => visited.includes(day));
    },
    paint: (windowId: string, pane: string, colour: string) => change(memory => {
      memory.windows[windowId] = { ...memory.windows[windowId], [pane]: colour };
    }).windows,
    clearWindow: (windowId: string) => change(memory => { delete memory.windows[windowId]; }).windows,
    /** Keeps a postcard in the album, or takes it out again. */
    toggleKept: (postcardId: string) => change(memory => {
      memory.kept = memory.kept.includes(postcardId) ? memory.kept.filter(id => id !== postcardId) : [...memory.kept, postcardId];
    }).kept,
    /** Remembers that an article or a survivor story has been opened. */
    markRead: (section: "learn" | "stories", id: string) => change(memory => {
      const key = `${section}:${id}`;
      if (!memory.read.includes(key)) memory.read.push(key);
    }).read,
    saveStoryPlace: (place: StoryPlace) => change(memory => { memory.story = { chapter: count(place.chapter), sentence: count(place.sentence) }; }).story,
  };
}

export const myTimeStore = createMyTimeStore(() => localStorage);
