import { dayKey, homeStages, pickHeadline, pickOpener, type HomeStage } from "./home-stage";

export const HOME_GREETING_KEY = "rehyn.home.greeting.v1";

type GreetingCopy = { headline: string; opener: number };
type DailyGreeting = { day: string; visits: Partial<Record<HomeStage, GreetingCopy>> };
export type HomeGreeting = GreetingCopy & { day: string; stage: HomeStage; animate: boolean };

let storageFallback: DailyGreeting | null = null;

function readDailyGreeting(): DailyGreeting | null {
  try {
    const raw = localStorage.getItem(HOME_GREETING_KEY);
    if (!raw) return storageFallback;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(saved.day)) return null;
    const visits: DailyGreeting["visits"] = {};
    for (const stage of Object.keys(homeStages) as HomeStage[]) {
      const copy = saved.visits?.[stage];
      if (copy && typeof copy.headline === "string" && Number.isInteger(copy.opener)
        && copy.opener >= 0 && copy.opener < homeStages[stage].openers.length) {
        visits[stage] = { headline: copy.headline, opener: copy.opener };
      }
    }
    return { day: saved.day, visits };
  } catch {
    return storageFallback;
  }
}

// Reading does not consume the animation: React may initialize a render more than once.
export function loadHomeGreeting(stage: HomeStage, now = new Date()): HomeGreeting {
  const day = dayKey(now);
  const saved = readDailyGreeting();
  const seenToday = saved?.day === day;
  const copy = seenToday ? saved.visits[stage] : undefined;
  return {
    day,
    stage,
    headline: copy?.headline ?? pickHeadline(stage, now),
    opener: copy?.opener ?? pickOpener(stage),
    animate: !seenToday,
  };
}

export function rememberHomeGreeting(greeting: HomeGreeting): void {
  const saved = readDailyGreeting();
  const daily: DailyGreeting = {
    day: greeting.day,
    visits: {
      ...(saved?.day === greeting.day ? saved.visits : {}),
      [greeting.stage]: { headline: greeting.headline, opener: greeting.opener },
    },
  };
  try {
    localStorage.setItem(HOME_GREETING_KEY, JSON.stringify(daily));
    storageFallback = null;
  } catch {
    // Blocked storage still allows same-tab navigation without repeating the greeting.
    storageFallback = daily;
  }
}
