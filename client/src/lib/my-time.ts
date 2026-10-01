import { dayKey } from "./home-stage";

// My Time shows one thing to do at a time. This file holds the list, the choice of what to open
// with, and the little that is remembered between visits (on this device only).

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
};

export const myTimeActivities: MyTimeActivity[] = [
  { id: "breathing", label: "Breathe", titleId: "breathing-title", control: ".breathing-start" },
  { id: "pond", label: "Koi pond", titleId: "pond-title", control: ".pond-water" },
  { id: "memory_game", label: "Pairs", titleId: "pairs-title", control: "button:not([disabled])" },
  { id: "chimes", label: "Chimes", titleId: "chimes-title", control: ".chime-tube" },
  { id: "colour", label: "Colour", titleId: "colour-title", control: ".colour-swatch" },
  { id: "postcard", label: "Postcard", titleId: "postcard-title", control: ".postcard-turn" },
  { id: "story", label: "Story", titleId: "story-title", control: ".story-play" },
  { id: "sounds", label: "Sounds", titleId: "sounds-title", control: "button" },
  { id: "lantern", label: "Lantern", titleId: "lantern-title", control: "input" },
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
};
type MyTimeStorage = Pick<Storage, "getItem" | "setItem">;

const blank = (): MyTimeMemory => ({ tried: [], pondDays: [], windows: {}, kept: [], story: { chapter: 0, sentence: 0 } });
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
    saveStoryPlace: (place: StoryPlace) => change(memory => { memory.story = { chapter: count(place.chapter), sentence: count(place.sentence) }; }).story,
  };
}

export const myTimeStore = createMyTimeStore(() => localStorage);
