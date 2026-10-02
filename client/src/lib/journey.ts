// The Journey's Progress tab: what unlocks it, what it remembers in this browser, and the
// model behind the page (timeline, scores, plan, Alira's notes, medals). Layout and copy come
// from the design canvas ("Day 1 — interactive: complete sessions to watch it evolve").
//
// The tab stays locked until the first movement check has produced scores AND Alira has
// designed the exercise plan from them. Everything after that counts from "day one", the day
// of that first assessment, and nothing is dropped when a new week or a re-assessment starts.
import { noteLead, patientLine, previousDay } from "@shared/plan-review";
import { withEverydayExercise, loadRememberedAssessment, type PlanExercise, type StoredAssessment } from "./assessment";
import { DOMAIN_LABEL, EVERYDAY_EXERCISE_ID, EXERCISES, patientExerciseReady, usesSeatedTargets } from "./exercise-engine/config";
import { dayKey, markExercisesDoneToday, PATIENT_NAME, REASSESSMENT_CYCLE_DAYS } from "./home-stage";
import { adjustedLevel, changesFromDay, loadPlanReview, resetPlanReview, restingOn, type PlanReviewState } from "./plan-review-store";
import { administrativeControlsEnabled } from "./administrative-controls";

export const JOURNEY_START_KEY = "rehyn.journey.start";
export const JOURNEY_SESSIONS_KEY = "rehyn.journey.sessions";
export const JOURNEY_WINS_KEY = "rehyn.journey.wins";
export const JOURNEY_SHARE_KEY = "rehyn.journey.share";
export const JOURNEY_ASSESSMENTS_KEY = "rehyn.journey.assessments";
/** Local testing only: shifts "today" forward so the page can be walked through day by day. */
export const JOURNEY_DEMO_KEY = "rehyn.journey.demo";

export const PLAN_LENGTH_DAYS = 84;
export const TIMELINE_DAYS = 12;

const DAY_MS = 86400000;
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): boolean {
  try {
    storage()?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- the gate

export type AreaKey = "upper_limb" | "hand" | "lower_limb";
export const AREA_ORDER: AreaKey[] = ["upper_limb", "hand", "lower_limb"];
export const AREA_LABEL: Record<AreaKey, string> = { upper_limb: "Upper limb", hand: "Hand", lower_limb: "Lower limb" };
export type AreaScores = Record<AreaKey, number | null>;

/** The three area scores of a movement check (null when that area was not measured). */
export function assessmentScores(assessment: StoredAssessment | null | undefined): AreaScores {
  const areas = assessment?.report?.metrics?.function_score?.areas ?? {};
  const pick = (...keys: string[]): number | null => {
    for (const key of keys) {
      const value = areas[key]?.display_score;
      if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
    }
    return null;
  };
  return { upper_limb: pick("upper_limb", "arm"), hand: pick("hand"), lower_limb: pick("lower_limb", "walking", "leg") };
}

export function hasAssessmentScores(assessment: StoredAssessment | null | undefined): boolean {
  return AREA_ORDER.some(area => assessmentScores(assessment)[area] !== null);
}

/** Alira has designed the plan: the plan conversation finished and the report carries a plan list. */
export function planDesigned(assessment: StoredAssessment | null | undefined): boolean {
  return !!assessment && assessment.planChatCompleted === true && Array.isArray(assessment.report?.rehab_plan);
}

/**
 * The Journey opens once the first movement check has scores and Alira has designed the exercise
 * plan from them. A journey that has already started stays open while a re-assessment's plan is
 * being prepared, so the history is never hidden again.
 */
export function journeyUnlocked(assessment: StoredAssessment | null | undefined): boolean {
  if (!assessment) return false;
  if (hasAssessmentScores(assessment) && planDesigned(assessment)) return true;
  return loadJourneyStart() !== null;
}

/** Why the Journey is still locked, for the locked page's call to action. */
export function journeyLockReason(assessment: StoredAssessment | null | undefined): "assessment" | "plan" | null {
  if (journeyUnlocked(assessment)) return null;
  return assessment && hasAssessmentScores(assessment) ? "plan" : "assessment";
}

// ---------------------------------------------------------------- day one and assessments

export type JourneyAssessment = { id: string; completedAt: string; scores: AreaScores };

export function loadJourneyStart(): Date | null {
  try {
    const raw = storage()?.getItem(JOURNEY_START_KEY);
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

export function loadJourneyAssessments(): JourneyAssessment[] {
  const list = readJson<unknown>(JOURNEY_ASSESSMENTS_KEY, []);
  return Array.isArray(list) ? list.filter((item): item is JourneyAssessment => !!item && typeof item.id === "string" && typeof item.completedAt === "string") : [];
}

/**
 * Called whenever the Journey renders with an unlocked assessment: fixes day one on the first
 * visit and keeps every assessment (starting point, then each re-assessment) for the table.
 */
export function ensureJourneyRecords(assessment: StoredAssessment): { start: Date; assessments: JourneyAssessment[] } {
  let start = loadJourneyStart();
  if (!start) {
    const completed = new Date(assessment.completedAt);
    start = Number.isNaN(completed.getTime()) ? new Date() : completed;
    try { storage()?.setItem(JOURNEY_START_KEY, start.toISOString()); } catch { /* the page still works for this visit */ }
  }
  const assessments = loadJourneyAssessments();
  if (hasAssessmentScores(assessment) && !assessments.some(item => item.id === assessment.id)) {
    assessments.push({ id: assessment.id, completedAt: assessment.completedAt, scores: assessmentScores(assessment) });
    assessments.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    writeJson(JOURNEY_ASSESSMENTS_KEY, assessments);
  }
  return { start, assessments };
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
/** Whole days from day one (the first assessment) to a date; day one is 0. */
export function dayIndexOf(start: Date, date: Date): number {
  return Math.round((startOfDay(date).getTime() - startOfDay(start).getTime()) / DAY_MS);
}
export function dateOfDay(start: Date, day: number): Date {
  const date = startOfDay(start);
  date.setDate(date.getDate() + day);
  return date;
}
export function shortDate(date: Date): string {
  return `${DOW[(date.getDay() + 6) % 7]} ${date.getDate()} ${MON[date.getMonth()]}`;
}
export function dayMonth(date: Date): string {
  return `${date.getDate()} ${MON[date.getMonth()]}`;
}

// ---------------------------------------------------------------- local testing clock

export function demoDayOffset(): number {
  if (!administrativeControlsEnabled()) return 0;
  const demo = readJson<{ dayOffset?: unknown }>(JOURNEY_DEMO_KEY, {});
  return typeof demo.dayOffset === "number" && Number.isFinite(demo.dayOffset) ? Math.max(0, Math.round(demo.dayOffset)) : 0;
}
/** Fired when local testing moves "today", so Alira's daily plan review treats it as a real new day. */
export const JOURNEY_CLOCK_EVENT = "rehyn:journey-clock";
function clockChanged() {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(JOURNEY_CLOCK_EVENT));
  } catch {
    /* no window: nothing listens */
  }
}
export function setDemoDayOffset(dayOffset: number): void {
  if (!administrativeControlsEnabled()) return;
  writeJson(JOURNEY_DEMO_KEY, { dayOffset: Math.max(0, Math.round(dayOffset)) });
  clockChanged();
}
/** "Now" for the Journey: the real clock, shifted by the local testing offset. */
export function journeyNow(now = new Date()): Date {
  const offset = demoDayOffset();
  if (!offset) return now;
  const shifted = new Date(now);
  shifted.setDate(shifted.getDate() + offset);
  return shifted;
}

// ---------------------------------------------------------------- exercise results

export type ExerciseResult = { score: number; at: string };
/** Day key (local date) → exercise id → the best score that day. */
export type SessionStore = Record<string, Record<string, ExerciseResult>>;

export function loadSessionStore(): SessionStore {
  const store = readJson<unknown>(JOURNEY_SESSIONS_KEY, {});
  return store && typeof store === "object" && !Array.isArray(store) ? (store as SessionStore) : {};
}

/** All engine exercises in the prepared plan, including those still being developed for patients. */
export function companionPlan(assessment: StoredAssessment | null | undefined): PlanExercise[] {
  if (!Array.isArray(assessment?.report?.rehab_plan)) return [];
  return withEverydayExercise(assessment.report.rehab_plan, assessment.report.clinical_review_gate).filter(exercise => Object.hasOwn(EXERCISES, exercise.id));
}

/**
 * Today's ready patient exercises, less any resting after a warning sign (see the daily plan
 * review, lib/plan-review.ts). "Done for today" and "what's next" count only these.
 */
export function launchablePlan(assessment: StoredAssessment | null | undefined, day = dayKey(journeyNow())): PlanExercise[] {
  const review = loadPlanReview();
  return companionPlan(assessment).filter(exercise => patientExerciseReady(exercise.id) && !restingOn(exercise.id, day, assessment?.id, review));
}

/**
 * Remembers an exercise score for the day it was done. The home page's "done for today" note
 * follows once every exercise in the plan has a score for that day.
 */
export function recordExerciseResult(exerciseId: string, score: number | null | undefined, now = journeyNow()): SessionStore {
  const store = loadSessionStore();
  if (typeof score !== "number" || !Number.isFinite(score)) return store;
  const key = dayKey(now);
  const day = { ...(store[key] ?? {}) };
  const previous = day[exerciseId];
  const rounded = Math.max(0, Math.min(100, Math.round(score)));
  if (!previous || rounded >= previous.score) day[exerciseId] = { score: rounded, at: now.toISOString() };
  const next = { ...store, [key]: day };
  writeJson(JOURNEY_SESSIONS_KEY, next);
  const plan = launchablePlan(loadRememberedAssessment(), key);
  if (plan.length && plan.every(exercise => Object.hasOwn(day, exercise.id))) markExercisesDoneToday(now);
  return next;
}

export function clearJourneyRecords(): void {
  for (const key of [JOURNEY_START_KEY, JOURNEY_SESSIONS_KEY, JOURNEY_WINS_KEY, JOURNEY_SHARE_KEY, JOURNEY_ASSESSMENTS_KEY, JOURNEY_DEMO_KEY]) {
    try { storage()?.removeItem(key); } catch { /* nothing to clear */ }
  }
  // The daily plan review's levels and changes belong to these records, so they start again too.
  resetPlanReview();
  clockChanged();
}

// ---------------------------------------------------------------- wins and sharing

export type Win = { text: string; on: string };

export function loadWins(): Win[] {
  const list = readJson<unknown>(JOURNEY_WINS_KEY, []);
  return Array.isArray(list) ? list.filter((item): item is Win => !!item && typeof item.text === "string" && typeof item.on === "string") : [];
}
export function saveWins(wins: Win[]): void {
  writeJson(JOURNEY_WINS_KEY, wins.slice(0, 200));
}

export const SHARE_SECTIONS = [
  { key: "scores", name: "Session scores", desc: "The score chart and this week’s numbers" },
  { key: "exercises", name: "By exercise", desc: "Progress on each exercise" },
  { key: "assessments", name: "Assessments", desc: "Starting point and reassessments" },
  { key: "plan", name: "Exercise plan", desc: "Today’s exercises and which days were done" },
  { key: "wins", name: "Everyday wins", desc: "The small things that got easier" },
  { key: "medals", name: "Medals", desc: "Milestones reached" },
  { key: "alira", name: "Notes from Alira", desc: "Weekly letters and daily notes" },
] as const;
export type ShareSectionKey = (typeof SHARE_SECTIONS)[number]["key"];
export type SharePerson = { name: string; email: string };
/** Sharing stays on, across weeks and re-assessments, until the patient turns it off. */
export type ShareSettings = { on: boolean; configured: boolean; sections: Record<ShareSectionKey, boolean>; people: SharePerson[] };

export const allSectionsOn = (): Record<ShareSectionKey, boolean> =>
  Object.fromEntries(SHARE_SECTIONS.map(section => [section.key, true])) as Record<ShareSectionKey, boolean>;

export function loadShareSettings(): ShareSettings {
  const saved = readJson<Partial<ShareSettings>>(JOURNEY_SHARE_KEY, {});
  const sections = allSectionsOn();
  for (const section of SHARE_SECTIONS) if (saved.sections && typeof saved.sections[section.key] === "boolean") sections[section.key] = saved.sections[section.key];
  const people = Array.isArray(saved.people) ? saved.people.filter((p): p is SharePerson => !!p && typeof p.name === "string" && typeof p.email === "string") : [];
  return { on: saved.on === true && people.length > 0, configured: saved.configured === true && people.length > 0, sections, people };
}
export function saveShareSettings(settings: ShareSettings): void {
  writeJson(JOURNEY_SHARE_KEY, settings);
}
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------- the model

export type JourneyExercise = {
  id: string;
  name: string;
  area: AreaKey;
  areaLabel: string;
  dose: string;
  /** The companion runs this exercise itself and records its score. */
  launchable: boolean;
  plan: PlanExercise;
};
export type JourneySession = { day: number; date: Date; score: number; scores: Record<string, number> };
export type TimelineDay = { day: number; n: number; state: "done" | "today" | "today-done" | "missed" | "future"; weekLabel: string | null; reassessment: boolean };
export type ChartPoint = { day: number; x: number; y: number; score: number; cont: boolean };
export type Chart = {
  cs: number;
  ce: number;
  points: ChartPoint[];
  lineD: string;
  dotsD: string;
  dividersD: string;
  dividerXs: number[];
  weekLabels: { x: number; text: string }[];
  axis: { lo: number; mid: number; labels: { y: number; text: string }[] };
  latest: ChartPoint | null;
};
export type ExerciseTrend = { exercise: JourneyExercise; latest: number | null; delta: number; count: number; chart: Chart };
/**
 * `rung` is the level the exercise runs at today, after the daily plan review. `resting` is true on
 * a rest day after a warning sign, and `levelChange` marks a level that changed from yesterday's results.
 */
export type PlanRow = { exercise: JourneyExercise; doneToday: boolean; score: number | null; rung: 1 | 2 | 3; resting: boolean; levelChange: "easier" | "harder" | null };
/** `changes` lists what the daily plan review changed after yesterday, under `changesLead`. */
export type AliraNote = { kind: "note" | "care" | "letter"; label: string; text: string; tips: string[]; changesLead?: string; changes?: string[] };
export type NextMedal = { id: "first-step" | "sunrise" | "month" | "reassessment"; name: string; description: string; pct: number };
export type AssessmentColumn = { label: string; date: string; scores: AreaScores | null };

export type JourneyModel = {
  day: number;
  week: number;
  today: Date;
  todayLong: string;
  headline: string;
  timeline: TimelineDay[];
  sessions: JourneySession[];
  latest: JourneySession | null;
  previous: JourneySession | null;
  doneToday: boolean;
  streak: number;
  maxStreak: number;
  thisWeek: JourneySession[];
  thisWeekAvg: number;
  chart: Chart;
  byExercise: ExerciseTrend[];
  exercises: JourneyExercise[];
  planRows: PlanRow[];
  nextExercise: JourneyExercise | null;
  planTitle: string;
  weekDays: { label: string; day: number; state: "done" | "today" | "missed" | "future" }[];
  assessments: AssessmentColumn[];
  startingScores: AreaScores;
  alira: AliraNote;
  nextMedal: NextMedal;
  earnedMedalIds: ("first-step" | "sunrise" | "month")[];
  unlocks: { progress: boolean; wins: boolean; letter: boolean; letterWhen: string };
  winsUnlocked: boolean;
  reassessmentDay: number;
};

export type ChartRange = "7d" | "4w" | "all";

const CHART = { x0: 36, x1: 724, top: 28, height: 156 };

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}
function avgOf(sessions: { score: number }[]): number {
  return sessions.length ? Math.round(sessions.reduce((total, s) => total + s.score, 0) / sessions.length) : 0;
}
const round1 = (value: number) => Math.round(value * 10) / 10;

export function areaOfExercise(exercise: PlanExercise): AreaKey {
  const config = EXERCISES[exercise.id];
  if (config) return config.domain;
  const text = `${exercise.id} ${exercise.name}`.toLowerCase();
  if (/hand|grasp|grip|pinch|finger|thumb/.test(text)) return "hand";
  if (/leg|ankle|knee|hip|sit|stand|step|walk|gait|trunk|lower|balance/.test(text)) return "lower_limb";
  return "upper_limb";
}

export function journeyExercises(assessment: StoredAssessment | null | undefined): JourneyExercise[] {
  if (!Array.isArray(assessment?.report?.rehab_plan)) return [];
  return withEverydayExercise(assessment.report.rehab_plan, assessment.report.clinical_review_gate).map(plan => {
    const area = areaOfExercise(plan);
    return {
      id: plan.id,
      name: EXERCISES[plan.id]?.name ?? plan.name,
      area,
      areaLabel: DOMAIN_LABEL[area] ?? AREA_LABEL[area],
      dose: `${plan.sets} ${plan.sets === 1 ? "set" : "sets"} × ${plan.reps}`,
      launchable: patientExerciseReady(plan.id),
      plan,
    };
  });
}

export function rungFor(exercise: PlanExercise): 1 | 2 | 3 {
  return exercise.difficulty === "hard" ? 3 : exercise.difficulty === "medium" ? 2 : 1;
}

/** Sessions (one per day with at least one scored exercise), oldest first, up to and including today. */
export function sessionsFrom(store: SessionStore, start: Date, day: number): JourneySession[] {
  const sessions: JourneySession[] = [];
  for (const [key, results] of Object.entries(store)) {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (Number.isNaN(date.getTime())) continue;
    const scores: Record<string, number> = {};
    for (const [id, result] of Object.entries(results ?? {})) if (typeof result?.score === "number") scores[id] = result.score;
    const values = Object.values(scores);
    const index = dayIndexOf(start, date);
    if (!values.length || index < 0 || index > day) continue;
    sessions.push({ day: index, date, scores, score: avgOf(values.map(score => ({ score }))) });
  }
  return sessions.sort((a, b) => a.day - b.day);
}

/** The chart window for a range: 7 days, 4 weeks or everything since day one (the data is never dropped). */
export function chartWindow(range: ChartRange, day: number): { cs: number; N: number } {
  if (range === "7d") return { cs: Math.max(0, day - 6), N: 7 };
  if (range === "4w") return { cs: Math.max(0, day - 27), N: 28 };
  return { cs: 0, N: Math.max(7, (Math.floor(day / 7) + 1) * 7) };
}

export function buildChart(points: { day: number; score: number }[], range: ChartRange, day: number, geometry = CHART): Chart {
  const { cs, N } = chartWindow(range, day);
  const ce = cs + N - 1;
  const step = (geometry.x1 - geometry.x0) / (N - 1);
  const xOf = (i: number) => round1(geometry.x0 + (i - cs) * step);
  const inWindow = points.filter(p => p.day >= cs && p.day <= ce);
  const lo = points.some(p => p.score < 50) ? 0 : 50;
  const yOf = (score: number) => round1(geometry.top + (100 - clamp(score, lo, 100)) / (100 - lo) * geometry.height);
  const chartPoints: ChartPoint[] = inWindow.map((p, idx) => ({
    day: p.day, score: p.score, x: xOf(p.day), y: yOf(p.score),
    cont: idx > 0 && p.day - inWindow[idx - 1].day === 1,
  }));
  const lineD = chartPoints.map(p => `${p.cont ? "L" : "M"}${p.x} ${p.y}`).join("");
  const dotsD = chartPoints.map(p => `M${p.x - 4} ${p.y}a4 4 0 1 0 8 0a4 4 0 1 0 -8 0`).join("");
  const dividerXs: number[] = [];
  const weekLabels: { x: number; text: string }[] = [];
  for (let k = Math.floor(cs / 7); k * 7 <= ce; k++) {
    const wa = Math.max(cs, k * 7);
    const wb = Math.min(ce, k * 7 + 6);
    if (wb - wa >= 2) weekLabels.push({ x: Math.round((xOf(wa) + xOf(wb)) / 2), text: `Week ${k + 1}` });
    if (k * 7 > cs) dividerXs.push(round1((xOf(k * 7 - 1) + xOf(k * 7)) / 2));
  }
  const dividersD = dividerXs.map(x => `M${x} ${geometry.top - 6}L${x} ${geometry.top + geometry.height}`).join("");
  const mid = Math.round((100 + lo) / 2);
  const axis = { lo, mid, labels: [{ y: yOf(100), text: "100" }, { y: yOf(mid), text: String(mid) }, { y: yOf(lo), text: String(lo) }] };
  return { cs, ce, points: chartPoints, lineD, dotsD, dividersD, dividerXs, weekLabels, axis, latest: chartPoints.length ? chartPoints[chartPoints.length - 1] : null };
}

const EXERCISE_TIPS: Record<string, string> = {
  ex_reach: "Forward reach: slow the return. Count three on the way back and let your hand land softly.",
  ex_h2m: "Hand to mouth: bring the cup up slowly, pause at your lips, and lower it with control.",
  ex_wallslide: "Wall slide: keep the palm flat and slide only a little higher than feels easy, then rest.",
  ex_handopen: "Hand opening: open every finger fully, hold for three, then relax. Rest between sets.",
  ex_grasp: "Grasp: squeeze for three, then open every finger fully before the next rep.",
  ex_pinch: "Pinch: thumb to each fingertip slowly, light pressure, wrist straight.",
  ex_lower_selective: "Knee movement: move the knee on its own, keep the hip still, slower than you think.",
  ex_ankle_dorsiflexion: "Ankle: lift the toes towards you, hold for two, lower slowly. Keep the heel down.",
};
export function exerciseTip(exercise: JourneyExercise): string {
  return EXERCISE_TIPS[exercise.id] ?? `${exercise.name}: slower and steadier today, quality over reps, and rest between sets.`;
}

export type BuildInput = {
  assessment: StoredAssessment;
  start: Date;
  assessments: JourneyAssessment[];
  store: SessionStore;
  now: Date;
  range: ChartRange;
  name?: string;
  /** The daily plan review's levels, rest days and changes. Without it the plan shows as designed. */
  planReview?: PlanReviewState;
};

export function buildJourney({ assessment, start, assessments, store, now, range, name = PATIENT_NAME, planReview }: BuildInput): JourneyModel {
  const day = clamp(dayIndexOf(start, now), 0, PLAN_LENGTH_DAYS - 1);
  const week = Math.floor(day / 7) + 1;
  const weekStart = (week - 1) * 7;
  const today = dateOfDay(start, day);
  const exercises = journeyExercises(assessment);
  const launchable = exercises.filter(exercise => exercise.launchable);
  const sessions = sessionsFrom(store, start, day);
  const n = sessions.length;
  const latest = n ? sessions[n - 1] : null;
  const previous = n > 1 ? sessions[n - 2] : null;
  const first = n ? sessions[0] : null;
  const todayKey = dayKey(today);
  const todayResults = store[todayKey] ?? {};
  // The daily plan review can rest an exercise after a warning sign; only the others make up today.
  const restingToday = (exercise: JourneyExercise) => !!planReview && restingOn(exercise.id, todayKey, assessment.id, planReview);
  const activeToday = launchable.filter(exercise => !restingToday(exercise));
  const restDay = launchable.length > 0 && activeToday.length === 0;
  const doneToday = activeToday.length > 0 && activeToday.every(exercise => typeof todayResults[exercise.id]?.score === "number");
  const fromYesterday = planReview ? changesFromDay(previousDay(todayKey), assessment.id, planReview) : [];
  const sessionToday = !!latest && latest.day === day;

  let streak = 0;
  if (latest && (latest.day === day || latest.day === day - 1)) {
    streak = 1;
    for (let i = n - 1; i > 0; i--) { if (sessions[i].day - sessions[i - 1].day === 1) streak++; else break; }
  }
  let maxStreak = 0;
  let run = 0;
  sessions.forEach((session, j) => { run = j > 0 && session.day - sessions[j - 1].day === 1 ? run + 1 : 1; if (run > maxStreak) maxStreak = run; });

  const inWeek = (w: number) => sessions.filter(session => session.day >= (w - 1) * 7 && session.day < w * 7);
  const thisWeek = inWeek(week);
  const prevWeek = week > 1 ? inWeek(week - 1) : [];
  const thisWeekAvg = avgOf(thisWeek);

  // Re-assessment: the companion checks again two weeks after the latest assessment.
  const latestAssessment = assessments.length ? assessments[assessments.length - 1] : null;
  const latestAssessmentDay = latestAssessment ? Math.max(0, dayIndexOf(start, new Date(latestAssessment.completedAt))) : 0;
  const reassessmentDay = latestAssessmentDay + REASSESSMENT_CYCLE_DAYS;

  const headline = n === 0 && day === 0 ? "Day one. Your starting point is set."
    : week === 1 ? `Day ${day + 1}. ${n === 0 ? "No sessions yet." : n === 1 ? "One session in." : `${n} sessions in.`}`
    : `Week ${week}. ${n} session${n === 1 ? "" : "s"} since day one.`;

  const winStart = clamp(day - 2, 0, PLAN_LENGTH_DAYS - TIMELINE_DAYS);
  const timeline: TimelineDay[] = Array.from({ length: TIMELINE_DAYS }, (_, i) => {
    const d0 = winStart + i;
    const done = sessions.some(session => session.day === d0);
    const isToday = d0 === day;
    return {
      day: d0, n: d0 + 1,
      state: isToday ? (done ? "today-done" : "today") : done ? "done" : d0 < day ? "missed" : "future",
      weekLabel: d0 % 7 === 0 ? `Week ${Math.floor(d0 / 7) + 1}` : null,
      reassessment: d0 === reassessmentDay,
    };
  });

  const chart = buildChart(sessions, range, day);
  const byExercise: ExerciseTrend[] = exercises.map(exercise => {
    const points = sessions.flatMap(session => typeof session.scores[exercise.id] === "number" ? [{ day: session.day, score: session.scores[exercise.id] }] : []);
    const latestScore = points.length ? points[points.length - 1].score : null;
    return {
      exercise, latest: latestScore, delta: points.length ? points[points.length - 1].score - points[0].score : 0, count: points.length,
      chart: buildChart(points, range, day, { x0: CHART.x0, x1: CHART.x1, top: 12, height: 76 }),
    };
  });

  const planRows: PlanRow[] = exercises.map(exercise => {
    const result = todayResults[exercise.id];
    const base = usesSeatedTargets(exercise.id) ? 1 : rungFor(exercise.plan);
    const changed = exercise.id === EVERYDAY_EXERCISE_ID ? undefined : fromYesterday.find(change => change.exerciseId === exercise.id && (change.kind === "easier" || change.kind === "harder"));
    return {
      exercise, doneToday: typeof result?.score === "number", score: typeof result?.score === "number" ? result.score : null,
      rung: planReview ? adjustedLevel(exercise.id, base, assessment.id, planReview) : base,
      resting: restingToday(exercise),
      levelChange: changed?.kind === "easier" || changed?.kind === "harder" ? changed.kind : null,
    };
  });
  const nextExercise = planRows.find(row => row.exercise.launchable && !row.doneToday && !row.resting)?.exercise ?? null;
  const planTitle = restDay ? "Today is a rest day" : n === 0 && day === 0 && !doneToday ? "Your plan for week 1" : doneToday ? "Today’s session is done" : "Today’s session";
  const weekDays = DOW.map((label, i) => {
    const d = weekStart + i;
    const done = sessions.some(session => session.day === d);
    return { label, day: d, state: (done ? "done" : d === day ? "today" : d < day ? "missed" : "future") as "done" | "today" | "missed" | "future" };
  });

  const startingScores = assessments.length ? assessments[0].scores : assessmentScores(assessment);
  const assessmentColumns: AssessmentColumn[] = assessments.map((item, i) => ({
    label: i === 0 ? "Starting point" : `Week ${Math.floor(Math.max(0, dayIndexOf(start, new Date(item.completedAt))) / 7) + 1}`,
    date: dayMonth(new Date(item.completedAt)), scores: item.scores,
  }));
  if (!assessmentColumns.length) assessmentColumns.push({ label: "Starting point", date: dayMonth(start), scores: startingScores });
  assessmentColumns.push({ label: "Next check", date: dayMonth(dateOfDay(start, reassessmentDay)), scores: null });

  // Alira: a daily note, a gentler red note when the latest session dipped, a Sunday letter on day 7 of each week.
  const isSunday = day % 7 === 6;
  const dropped = !!(latest && previous && latest.score < previous.score);
  const dropBy = dropped && latest && previous ? previous.score - latest.score : 0;
  const dipped = dropped && latest && previous
    ? exercises.filter(exercise => typeof latest.scores[exercise.id] === "number" && typeof previous.scores[exercise.id] === "number" && latest.scores[exercise.id] < previous.scores[exercise.id])
      .sort((a, b) => (previous.scores[b.id] - latest.scores[b.id]) - (previous.scores[a.id] - latest.scores[a.id]))
    : [];
  const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
  let alira: AliraNote;
  if (n === 0) {
    const count = launchable.length;
    alira = { kind: "note", label: "A note from Alira", tips: [], text: day === 0
      ? `${name}, your starting point is set. The plan starts small on purpose: ${count === 1 ? "one exercise" : `${count} exercises`}, a few minutes each. Show up today and we’ll build from there.`
      : `${name}, no session yet — that’s alright. A few minutes today is enough to begin.` };
  } else if (dropped && !isSunday) {
    const names = dipped.slice(0, 2).map(exercise => lower(exercise.name));
    const phrase = names.length === 0 ? "your score" : names.length === 1 ? `your ${names[0]}` : `your ${names[0]} and ${names[1]}`;
    alira = { kind: "care", label: "A note from Alira", tips: sessionToday ? [] : dipped.slice(0, 2).map(exerciseTip),
      text: `${name}, ${sessionToday ? "today’s" : "your last"} session came in ${dropBy} point${dropBy === 1 ? "" : "s"} lower, mostly in ${phrase}. That happens — tired days are part of recovery, not a step back. ${sessionToday ? "Rest tonight, and tomorrow we’ll go slower and steadier." : "Let’s go slower and steadier today. Two small things to try:"}` };
  } else if (isSunday) {
    const cmp = prevWeek.length && thisWeek.length
      ? ` and your average is ${thisWeekAvg}, ${thisWeekAvg >= avgOf(prevWeek) ? "up " : "down "}${Math.abs(thisWeekAvg - avgOf(prevWeek))} on last week`
      : thisWeek.length ? ` with an average of ${thisWeekAvg}` : "";
    const weakest = byExercise.filter(trend => trend.count > 0).sort((a, b) => a.delta - b.delta)[0];
    alira = { kind: "letter", label: "Sunday letter from Alira", tips: [],
      text: `${name}, this week you showed up ${thisWeek.length} time${thisWeek.length === 1 ? "" : "s"}${cmp}.${weakest ? ` Next week, let’s keep the ${lower(weakest.exercise.name)} slow and steady.` : " Next week, let’s keep every movement slow and steady."}` };
  } else {
    const best = byExercise.filter(trend => trend.count > 0).sort((a, b) => b.delta - a.delta)[0];
    const lead = n === 1 ? `One session in, ${name}.` : `${n} sessions in, ${name}.`;
    const mid = best && best.delta > 0 ? ` Your ${lower(best.exercise.name)} is up ${best.delta} since day one.` : " Every session is being kept, so the trend will show soon.";
    alira = { kind: "note", label: "A note from Alira", tips: [], text: `${lead}${mid}${sessionToday ? " Today is done: rest well." : " Today, slow each movement down: quality over reps."}` };
  }
  // The day after the plan review changed something, Alira's note says what and why first.
  if (fromYesterday.length) alira = { ...alira, changesLead: noteLead(name), changes: fromYesterday.map(change => patientLine(change, todayKey, "note")) };

  const earnedMedalIds: ("first-step" | "sunrise" | "month")[] = [];
  if (n >= 1) earnedMedalIds.push("first-step");
  if (maxStreak >= 7) earnedMedalIds.push("sunrise");
  if (n >= 30) earnedMedalIds.push("month");
  const nextMedal: NextMedal = n === 0 ? { id: "first-step", name: "First Step", description: "Complete your very first session.", pct: 0 }
    : maxStreak < 7 ? { id: "sunrise", name: "Seven Sunrises", description: "Practise seven days in a row.", pct: Math.round(streak / 7 * 100) }
    : n < 30 ? { id: "month", name: "Month of Mornings", description: "Practise on thirty different days.", pct: Math.round(n / 30 * 100) }
    : { id: "reassessment", name: "Reassessment Ready", description: "Reach your next reassessment.", pct: Math.min(100, Math.round(day / Math.max(1, reassessmentDay) * 100)) };

  const toLetter = 6 - day;
  return {
    day, week, today, todayLong: today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
    headline, timeline, sessions, latest, previous, doneToday, streak, maxStreak, thisWeek, thisWeekAvg,
    chart, byExercise, exercises, planRows, nextExercise, planTitle, weekDays,
    assessments: assessmentColumns, startingScores, alira, nextMedal, earnedMedalIds,
    unlocks: { progress: n === 0, wins: day < 1, letter: day < 6, letterWhen: `Your first weekly letter arrives in ${toLetter} day${toLetter === 1 ? "" : "s"}` },
    winsUnlocked: day >= 1,
    reassessmentDay,
  };
}
