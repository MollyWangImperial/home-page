// What the home page shows, built from saved progress: the next step, the three areas of the
// latest movement check, this week's practice and Alira's line. Layout and motion come from the
// design canvas ("Home 1 · Settle and sway"); nothing here invents scores or practice days.
import type { SurpriseId } from "./home-surprise";
import type { HomeAction, HomeActionKind, HomeActionSnapshot } from "./home-next-action";
import { dayKey, type HomeStage } from "./home-stage";
import { AREA_ORDER, assessmentScores, launchablePlan, type AreaKey, type SessionStore } from "./journey";
import type { StoredAssessment } from "./assessment";

export type NextStep = {
  title: string;
  cta: string;
  note: string;
  /** The note starts with a duration ("About ten minutes…"), so it gets the clock. */
  timed: boolean;
  step: { current: number; total: number; label: string } | null;
};

const TITLES: Record<HomeActionKind, string> = {
  onboarding: "Let’s get to know you.",
  assessment: "Let’s finish your movement check.",
  reassessment: "Time to see how far you’ve come.",
  plan: "Your plan is almost ready.",
  review: "Let’s look at your plan together.",
  exercises: "A gentle start for today.",
  journal: "Well done today.",
  share: "Lovely work today.",
  medals: "That’s today done.",
};

/** Getting started has three steps: a few questions, the movement check, then the plan with Alira. */
const SETUP_STEP: Partial<Record<HomeActionKind, number>> = { onboarding: 1, assessment: 2, plan: 3 };

export function nextStep(action: HomeAction, snapshot: HomeActionSnapshot): NextStep {
  const base = { cta: action.cta, note: action.note, timed: /^About\b/.test(action.note) };
  const setup = SETUP_STEP[action.kind];
  if (setup) return { ...base, title: TITLES[action.kind], step: { current: setup, total: 3, label: `Step ${setup} of 3` } };
  if (action.kind === "reassessment" || action.kind === "review") return { ...base, title: TITLES[action.kind], step: null };

  const plan = launchablePlan(snapshot.assessment, dayKey(snapshot.now));
  const results = snapshot.sessions[dayKey(snapshot.now)] ?? {};
  const done = plan.filter(exercise => Number.isFinite(results[exercise.id]?.score)).length;
  if (!plan.length) return { ...base, title: TITLES[action.kind], step: null };
  if (action.kind === "exercises") {
    // A single exercise has no steps to count.
    return { ...base, title: done ? "Ready for the next one?" : TITLES.exercises,
      step: plan.length > 1 ? { current: done + 1, total: plan.length, label: `Step ${done + 1} of ${plan.length}` } : null };
  }
  return { ...base, title: TITLES[action.kind],
    step: { current: plan.length, total: plan.length, label: plan.length === 1 ? "Done for today" : `All ${plan.length} done today` } };
}

export type AreaTone = "building" | "steady" | "unmeasured";
export type ProgressArea = { key: AreaKey; label: string; value: number | null; tone: AreaTone; status: string };

const AREA_NAMES: Record<AreaKey, string> = { upper_limb: "Reaching", hand: "Hand control", lower_limb: "Moving about" };
/** At or above this an area reads as steady; below it, as still building. */
export const STEADY_FROM = 70;

/** The three areas of the latest movement check; an area it did not measure says so. */
export function progressAreas(assessment: StoredAssessment | null | undefined): ProgressArea[] {
  const scores = assessmentScores(assessment);
  return AREA_ORDER.map(key => {
    const value = scores[key];
    if (value === null) return { key, label: AREA_NAMES[key], value: null, tone: "unmeasured", status: "Not measured yet" };
    const clamped = Math.max(0, Math.min(100, value));
    return clamped >= STEADY_FROM
      ? { key, label: AREA_NAMES[key], value: clamped, tone: "steady", status: "Steady" }
      : { key, label: AREA_NAMES[key], value: clamped, tone: "building", status: "Building" };
  });
}

export type WeekDayState = "done" | "today" | "today-done" | "missed" | "future";
export type WeekDay = { key: string; letter: string; date: number; state: WeekDayState; label: string };

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** Monday to Sunday of the current week, with the days that have a scored exercise ticked. */
export function weekDays(now: Date, sessions: SessionStore): WeekDay[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return LETTERS.map((letter, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const key = dayKey(date);
    const practised = Object.values(sessions[key] ?? {}).some(result => Number.isFinite(result?.score));
    const isToday = date.getTime() === today.getTime();
    const state: WeekDayState = isToday ? (practised ? "today-done" : "today") : practised ? "done" : date < today ? "missed" : "future";
    const name = date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const label = `${name}${isToday ? ", today" : ""}${practised ? ", practised" : ""}`;
    return { key, letter, date: date.getDate(), state, label };
  });
}

/** Alira's line on her card: about getting started for a new patient, otherwise about the plan. */
export function aliraLine(stage: HomeStage): string {
  return stage === "assessment" ? "Hi, I’m Alira. Questions before we begin? I can help." : "Questions about your plan? I can help.";
}

/** How long an optional activity takes, where its own words say so. */
const DURATIONS: Partial<Record<SurpriseId, string>> = { sounds: "20 min", "warning-signs": "30 sec" };
export const activityDuration = (id: SurpriseId): string | null => DURATIONS[id] ?? null;
