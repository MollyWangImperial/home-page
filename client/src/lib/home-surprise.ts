import { dayKey } from "./home-stage";

// "Today's surprise": a sealed card under the home invitation that opens into one small thing
// Rehyn can do that the person may not have found yet. One per day, never the same as yesterday,
// and "Show me another" seals a different one until the person opens it.

export type SurpriseId =
  | "alira-voice" | "breathing" | "sounds" | "memory-pairs" | "journal" | "medals" | "warning-signs" | "large-text" | "sharing";
export type SurpriseAction = "fast-check" | "large-text";
export type Surprise = {
  id: SurpriseId;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  href?: string;
  action?: SurpriseAction;
  needs?: "journey" | "my-time";
};

export const surprises: Surprise[] = [
  { id: "alira-voice", eyebrow: "Did you know?", title: "Alira can read any message aloud.",
    body: "Tap the little speaker next to her words. Handy when your eyes are tired.", cta: "Try it with Alira", href: "/alira" },
  { id: "breathing", eyebrow: "A quiet corner", title: "Two minutes of calm, whenever you need it.",
    body: "In My Time a circle breathes with you. Alira keeps count and goes quiet when you're done.", cta: "Breathe with Alira", href: "/my-time?activity=breathing&minutes=3", needs: "my-time" },
  { id: "sounds", eyebrow: "Close your eyes", title: "Rain on the window, for twenty minutes.",
    body: "My Time keeps a few gentle sounds for resting. Birdsong, waves and a crackling fire too.", cta: "Listen for a while", href: "/my-time?activity=sounds", needs: "my-time" },
  { id: "memory-pairs", eyebrow: "A small game", title: "A few pairs to wake up your memory.",
    body: "Turn the cards and find the matches. There's no clock and no score to worry about.", cta: "Play a round", href: "/my-time?activity=memory_game", needs: "my-time" },
  { id: "journal", eyebrow: "From your journal", title: "Alira keeps a question for you each day.",
    body: "A line or two about how today felt is enough. Over the weeks it becomes your own story.", cta: "Open today's page", href: "/journey?tab=journal", needs: "journey" },
  { id: "medals", eyebrow: "Almost there", title: "There's a medal within reach.",
    body: "Your medal case shows what you've earned and what's close. Have a look at what's next.", cta: "Peek at your medals", href: "/journey?tab=medals", needs: "journey" },
  { id: "warning-signs", eyebrow: "A thirty-second refresher", title: "Could you still spot the four signs?",
    body: "Face, arms, speech, time. Knowing them cold protects you and the people around you.", cta: "Test yourself", action: "fast-check" },
  { id: "large-text", eyebrow: "Make Rehyn yours", title: "Words looking a bit small today?",
    body: "One tap makes everything larger. You can switch back any time from the A+ button at the top.", cta: "Make the text bigger", action: "large-text" },
  { id: "sharing", eyebrow: "For your family", title: "Choose what your family can see.",
    body: "You decide what to share from your journey, and with whom. Nothing is shared until you say so.", cta: "Choose what to share", href: "/journey?tab=progress&section=sharing", needs: "journey" },
];

export type SurpriseAccess = { journey: boolean; myTime: boolean; largeText: boolean };

/** Surprises that lead somewhere the person can actually go today. */
export function eligibleSurprises(access: SurpriseAccess, all: Surprise[] = surprises): Surprise[] {
  return all.filter(surprise => {
    if (surprise.needs === "journey" && !access.journey) return false;
    if (surprise.needs === "my-time" && !access.myTime) return false;
    if (surprise.action === "large-text" && access.largeText) return false;
    return true;
  });
}

/** Picks with the visit's roll, avoiding the given surprises (yesterday's, or ones already seen) when there is any other choice. */
export function pickSurprise(eligible: Surprise[], roll: number, avoid: SurpriseId | SurpriseId[] = []): Surprise | null {
  const avoided = Array.isArray(avoid) ? avoid : [avoid];
  const without = (ids: SurpriseId[]) => eligible.filter(surprise => !ids.includes(surprise.id));
  // Prefer something never avoided; failing that, at least not the most recent one; failing that, anything.
  const pool = [without(avoided), without(avoided.slice(-1)), eligible].find(candidates => candidates.length) ?? [];
  if (!pool.length) return null;
  const safeRoll = Math.max(0, Math.min(Number.isFinite(roll) ? roll : 0, 0.999999));
  return pool[Math.floor(safeRoll * pool.length)];
}

export const HOME_SURPRISE_KEY = "rehyn.home.surprise.v1";
export type SurpriseMemory = { day: string; id: SurpriseId; opened?: boolean };
export type SurpriseToday = { surprise: Surprise | null; opened: boolean };
type SurpriseStorage = Pick<Storage, "getItem" | "setItem">;

export function createSurpriseStore(storage: () => SurpriseStorage) {
  const load = (): SurpriseMemory | null => {
    try {
      const raw = storage().getItem(HOME_SURPRISE_KEY);
      const parsed = raw ? (JSON.parse(raw) as SurpriseMemory) : null;
      return parsed && typeof parsed.day === "string" && typeof parsed.id === "string" ? parsed : null;
    } catch { return null; }
  };
  const save = (memory: SurpriseMemory) => {
    try { storage().setItem(HOME_SURPRISE_KEY, JSON.stringify(memory)); } catch { /* private mode: today's pick simply isn't remembered */ }
  };
  return {
    /** Today's surprise: the one already chosen today, else a fresh pick that is remembered for the day. */
    today(access: SurpriseAccess, now: Date, roll: number): SurpriseToday {
      const day = dayKey(now);
      const eligible = eligibleSurprises(access);
      const memory = load();
      if (memory?.day === day) {
        const kept = eligible.find(surprise => surprise.id === memory.id);
        if (kept) return { surprise: kept, opened: !!memory.opened };
      }
      const surprise = pickSurprise(eligible, roll, memory?.id);
      if (surprise) save({ day, id: surprise.id });
      return { surprise, opened: false };
    },
    open(now: Date) {
      const memory = load();
      if (memory?.day === dayKey(now)) save({ ...memory, opened: true });
    },
    /** Swaps today's surprise for one not yet seen this visit, sealed and remembered as today's. */
    another(access: SurpriseAccess, now: Date, roll: number, seen: SurpriseId[]): Surprise | null {
      const eligible = eligibleSurprises(access);
      const current = load()?.id;
      const surprise = pickSurprise(eligible, roll, current ? [...seen, current] : seen);
      if (surprise) save({ day: dayKey(now), id: surprise.id, opened: false });
      return surprise;
    },
  };
}

export const surpriseStore = createSurpriseStore(() => localStorage);
