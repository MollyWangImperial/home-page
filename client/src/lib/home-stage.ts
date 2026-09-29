// The home page follows the patient's next step: the first assessment, then daily exercises
// counting down to the re-assessment, a rest note once today's session is done, and the
// re-assessment itself when its date arrives. Copy and stages come from the design canvas (B2).
import type { StoredAssessment } from "./assessment";

export type HomeStage = "assessment" | "exercises" | "done_today" | "reassessment";

export const REASSESSMENT_CYCLE_DAYS = 14;
export const EXERCISES_DONE_KEY = "rehyn.exercises.lastDone";
export const PATIENT_NAME = "Zak";

export type Opener = { text: string; cta: string; href: string };
export type StageCopy = { headline?: string; note: string; openers: Opener[] };

export const homeStages: Record<HomeStage, StageCopy> = {
  assessment: {
    headline: "Welcome to Rehyn, {n}.",
    note: "You can pause at any point. Your answers are saved as you go.",
    openers: [
      { text: "Hi {n}, I'm Alira. Shall we start with a few simple questions about you? There are no wrong answers, and we can pause whenever you like.", cta: "Yes, let's get to know each other", href: "/alira?onboarding=1&from=home" },
      { text: "Hello {n}, I'm Alira. Before we plan anything I'd like to get to know you a little: a few questions, then a short look at how you move.", cta: "Let's begin", href: "/alira?onboarding=1&from=home" },
    ],
  },
  exercises: {
    note: "About ten minutes. You can pause at any point.",
    openers: [
      { text: "Welcome back, {n}. Today's gentle session is ready: three short movements, about ten minutes. Your re-assessment is in {d}.", cta: "Start today's exercises", href: "/journey" },
      { text: "Hello again, {n}. {D} until we check your progress. Shall we do today's movements while your energy is good?", cta: "Yes, let's go", href: "/journey" },
      { text: "Good to see you, {n}. One small session a day is what builds it up. Ready for today's?", cta: "Start today's session", href: "/journey" },
      { text: "Hi {n}. I've set today's movements from how you did last time, a little lighter on the reach. Shall we?", cta: "Start today's session", href: "/journey" },
      { text: "Hi {n}, nice to see you again. Tell me how today has been, or we can go straight to your movements.", cta: "Go to my movements", href: "/journey" },
    ],
  },
  done_today: {
    note: "Rest is part of the plan. Alira will be here tomorrow.",
    openers: [
      { text: "Lovely work today, {n}. Today's session is done, and rest is part of the plan too. I'll see you tomorrow; your re-assessment is in {d}.", cta: "See my journey", href: "/journey" },
      { text: "That's today done, {n}. Every session counts, even the short ones. Would you like to see how the week is shaping up?", cta: "See my week", href: "/journey" },
      { text: "All done for today, {n}. Put your feet up. If you feel like a quiet moment later, My time has a breathing guide.", cta: "Open My time", href: "/my-time" },
    ],
  },
  reassessment: {
    note: "Same short movements as your first check. You can pause at any point.",
    openers: [
      { text: "It's re-assessment day, {n}. Two weeks of practice, and now we get to see how far you've come. Same short movements as your first check.", cta: "Start my re-assessment", href: "/assessment" },
      { text: "Welcome back, {n}. Today we measure again: a few gentle movements in front of the camera, about ten minutes. No pressure, just a picture of where you are now.", cta: "Let's see my progress", href: "/assessment" },
    ],
  },
};

const headlines = {
  morning: ["Good morning, {n}.", "Morning, {n}.", "A new day, {n}."],
  afternoon: ["Good afternoon, {n}.", "Hello again, {n}.", "Good to see you, {n}."],
  evening: ["Good evening, {n}.", "Welcome back, {n}.", "Lovely to see you, {n}."],
};

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Whole days from today until the re-assessment (never negative). */
export function daysToReassessment(assessment: StoredAssessment | null, now = new Date()): number {
  if (!assessment) return REASSESSMENT_CYCLE_DAYS;
  const completed = new Date(assessment.completedAt);
  if (Number.isNaN(completed.getTime())) return REASSESSMENT_CYCLE_DAYS;
  const due = startOfDay(completed);
  due.setDate(due.getDate() + REASSESSMENT_CYCLE_DAYS);
  const diff = Math.round((due.getTime() - startOfDay(now).getTime()) / 86400000);
  return Math.max(0, diff);
}

export function homeStage(assessment: StoredAssessment | null, lastExerciseDay: string | null, now = new Date()): { stage: HomeStage; days: number } {
  if (!assessment) return { stage: "assessment", days: REASSESSMENT_CYCLE_DAYS };
  const days = daysToReassessment(assessment, now);
  if (days === 0) return { stage: "reassessment", days };
  if (lastExerciseDay === dayKey(now)) return { stage: "done_today", days };
  return { stage: "exercises", days };
}

export function fillCopy(text: string, days: number, name = PATIENT_NAME): string {
  const span = days === 1 ? "1 day" : `${days} days`;
  return text.split("{n}").join(name).split("{d}").join(span).split("{D}").join(span.charAt(0).toUpperCase() + span.slice(1));
}

export function timeOfDay(now = new Date()): keyof typeof headlines {
  const h = now.getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

/** The headline for a visit: the stage's fixed one, else a time-of-day greeting drawn at random. */
export function pickHeadline(stage: HomeStage, now = new Date(), random = Math.random): string {
  const fixed = homeStages[stage].headline;
  if (fixed) return fixed;
  const options = headlines[timeOfDay(now)];
  return options[Math.floor(random() * options.length)];
}

/** One of the stage's openers, never the same as the previous one when there is a choice. */
export function pickOpener(stage: HomeStage, previous: number | null = null, random = Math.random): number {
  const count = homeStages[stage].openers.length;
  let index = Math.floor(random() * count);
  if (previous !== null && count > 1 && index === previous) index = (index + 1) % count;
  return index;
}

export function loadLastExerciseDay(): string | null {
  try {
    return localStorage.getItem(EXERCISES_DONE_KEY);
  } catch {
    return null;
  }
}

/** Records that today's exercises were done, so the home page shows the rest note until tomorrow. */
export function markExercisesDoneToday(now = new Date()): boolean {
  try {
    localStorage.setItem(EXERCISES_DONE_KEY, dayKey(now));
    return true;
  } catch {
    return false;
  }
}
