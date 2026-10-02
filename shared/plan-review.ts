// The daily plan review: fixed rules that decide, exercise by exercise, whether the next day's level
// goes down, up or stays the same, and when an exercise rests after a warning sign. No model makes
// these decisions; Alira only explains them. Every threshold is a named constant, and each one is an
// engineering default that needs clinician review.
//
// The rules run in the browser (all of the patient's results live there), and the server uses the
// same types to email the admin. See docs/plan-review.md.

import { previousDay, safetyFrom, type DifficultyReport } from "./alira-adaptation";

export const PLAN_REVIEW_VERSION = "rehyn-plan-review-1";

export const REVIEW_HOUR = 20; // engineering default, needs clinician review: the evening review, local time
export const GOOD_SCORE = 80; // engineering default, needs clinician review: a session at or above this went well
export const LOW_SCORE = 50; // engineering default, needs clinician review: a best score below this makes the next day easier
export const PROGRESS_DAYS = 2; // engineering default, needs clinician review: good session days in a row before a level up
export const MAX_LEVELS_ABOVE_CHECK = 1; // engineering default, needs clinician review: never further above the movement check's level
export const REST_DAYS_AFTER_WARNING = 1; // engineering default, needs clinician review: rest the rest of that day and this many days after
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 3;

export type Level = 1 | 2 | 3;
/** One exercise in the plan as the review sees it. */
export type PlanItem = { id: string; name: string; baseLevel: Level; fixedLevel: boolean; locked?: boolean };
/** Where an exercise stands after earlier reviews. */
export type ExerciseState = { level: Level; restingThrough: string | null };
export type ExerciseStates = Record<string, ExerciseState>;
/** One go at an exercise. `repsDone`, `level` and `repsPlanned` are null when only the day's score is known. */
export type Attempt = {
  exerciseId: string;
  day: string;
  level: Level | null;
  score: number | null;
  repsPlanned: number | null;
  repsDone: number | null;
  /** The target moved closer during the session after two misses in a row. */
  eased: boolean;
};

/** "steady": a hard day at the gentlest level (or a fixed-level exercise), so nothing can go lower; Alira still says so. */
export type ChangeKind = "easier" | "harder" | "rest" | "rest_day" | "steady";
export type ChangeReason =
  | "pain_a_lot" | "stopped_unwell" | "pain_a_little" | "felt_much_harder"
  | "stopped_early" | "low_score" | "eased_during_session" | "good_sessions";

export type PlanChange = {
  id: string;
  at: string;
  version: string;
  /** The day whose results led to the change. Alira's note mentions it the day after. */
  reviewedDay: string;
  /** The first day the change applies. */
  effectiveDay: string;
  /** null when the change covers every exercise (a rest day). */
  exerciseId: string | null;
  exerciseName: string;
  kind: ChangeKind;
  fromLevel: Level | null;
  toLevel: Level | null;
  /** The last day of rest, for "rest" and "rest_day". */
  restingThrough: string | null;
  reasons: ChangeReason[];
  /** A warning sign: the admin is emailed straight away. */
  warning: boolean;
};

// ---------------------------------------------------------------- days

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (value: unknown): value is string => typeof value === "string" && DAY.test(value);

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export const nextDay = (day: string) => addDays(day, 1);

/** Every day from `from` to `to`, inclusive, oldest first. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to && out.length < 400; day = nextDay(day)) out.push(day);
  return out;
}

export const asLevel = (value: number): Level => (Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(value))) as Level);

export function stateFor(item: PlanItem, states: ExerciseStates): ExerciseState {
  const state = states[item.id] ?? { level: item.baseLevel, restingThrough: null };
  return item.locked ? { ...state, level: item.baseLevel } : state;
}

/** Whether an exercise rests on a day, on its own or because the whole plan rests. */
export function isResting(state: ExerciseState | undefined, day: string, planRestingThrough: string | null = null): boolean {
  return (!!planRestingThrough && day <= planRestingThrough) || (!!state?.restingThrough && day <= state.restingThrough);
}

// ---------------------------------------------------------------- warning signs, straight away

/** A lot of pain, or stopping because of feeling unwell. */
export const isWarning = (report: DifficultyReport) => report.pain === "a_lot" || report.stopped === true;

function changeId(day: string, exerciseId: string | null, kind: ChangeKind) {
  return `${day}:${exerciseId ?? "all"}:${kind}`;
}

/**
 * Warning signs rest the exercise for the rest of that day and the next, and it comes back one
 * level easier. A warning from the warm-up, or one that isn't tied to an exercise in the plan,
 * rests every exercise instead. Each warning is reported once: a second one while the exercise is
 * already resting changes nothing.
 */
export function warningChanges({
  reports, plan, states, planRestingThrough, at,
}: {
  reports: readonly DifficultyReport[];
  plan: readonly PlanItem[];
  states: ExerciseStates;
  planRestingThrough: string | null;
  at: string;
}): PlanChange[] {
  const changes: PlanChange[] = [];
  let working = { ...states };
  let planRest = planRestingThrough;
  for (const report of reports) {
    if (!isWarning(report) || !isDay(report.day)) continue;
    const reasons: ChangeReason[] = [];
    if (report.pain === "a_lot") reasons.push("pain_a_lot");
    if (report.stopped) reasons.push("stopped_unwell");
    const through = addDays(report.day, REST_DAYS_AFTER_WARNING);
    const item = report.source === "exercise" ? plan.find(p => p.id === report.exerciseId) : undefined;
    if (item) {
      const state = stateFor(item, working);
      if (state.restingThrough && state.restingThrough >= through) continue;
      const toLevel = item.fixedLevel ? state.level : asLevel(state.level - 1);
      changes.push({
        id: changeId(report.day, item.id, "rest"), at, version: PLAN_REVIEW_VERSION, reviewedDay: report.day, effectiveDay: report.day,
        exerciseId: item.id, exerciseName: item.name, kind: "rest", fromLevel: state.level, toLevel, restingThrough: through, reasons, warning: true,
      });
      working = { ...working, [item.id]: { level: toLevel, restingThrough: through } };
    } else {
      if (planRest && planRest >= through) continue;
      changes.push({
        id: changeId(report.day, null, "rest_day"), at, version: PLAN_REVIEW_VERSION, reviewedDay: report.day, effectiveDay: report.day,
        exerciseId: null, exerciseName: "All exercises", kind: "rest_day", fromLevel: null, toLevel: null, restingThrough: through, reasons, warning: true,
      });
      planRest = through;
    }
  }
  return changes;
}

// ---------------------------------------------------------------- the evening review

const completed = (attempt: Attempt) => attempt.repsDone === null || attempt.repsPlanned === null || attempt.repsDone >= attempt.repsPlanned;
const bestScore = (attempts: Attempt[]) => attempts.reduce<number | null>((best, a) => (a.score === null ? best : best === null ? a.score : Math.max(best, a.score)), null);

/**
 * Reviews one day's results and returns the changes for the day after. An exercise with no session
 * that day stays as it is: nothing is made harder or easier without evidence.
 *
 * - Easier by one level after a hard day: it felt much harder, a little pain, the session stopped
 *   early, the best score was low, or the target had to move closer during the session.
 * - Harder by one level after PROGRESS_DAYS good session days in a row at the current level, as
 *   long as nothing felt harder or hurt in the last two days and the movement check's review gate
 *   is open. Never above the movement check's level plus MAX_LEVELS_ABOVE_CHECK.
 * - Exercises with a fixed level (the seated reach targets) can only rest, never change level.
 */
export function reviewDay({
  day, plan, states, attempts, reports, at, rehabBlocked = false,
}: {
  day: string;
  plan: readonly PlanItem[];
  states: ExerciseStates;
  attempts: readonly Attempt[];
  reports: readonly DifficultyReport[];
  at: string;
  rehabBlocked?: boolean;
}): PlanChange[] {
  const changes: PlanChange[] = [];
  const easierOnly = safetyFrom(reports, day).easierOnly || rehabBlocked;
  const effectiveDay = nextDay(day);
  for (const item of plan) {
    // The everyday exercise stays as designed. Warning-sign rests are handled separately.
    if (item.locked) continue;
    const state = stateFor(item, states);
    if (state.restingThrough && state.restingThrough >= day) continue;
    const dayReports = reports.filter(r => r.day === day && r.source === "exercise" && r.exerciseId === item.id);
    if (dayReports.some(isWarning)) continue;
    const today = attempts.filter(a => a.exerciseId === item.id && a.day === day);
    if (!today.length) continue;

    const reasons: ChangeReason[] = [];
    if (dayReports.some(r => r.pain === "a_little")) reasons.push("pain_a_little");
    if (dayReports.some(r => r.felt === "much_harder")) reasons.push("felt_much_harder");
    if (!today.some(completed)) reasons.push("stopped_early");
    const best = bestScore(today);
    if (best !== null && best < LOW_SCORE) reasons.push("low_score");
    if (today.some(a => a.eased)) reasons.push("eased_during_session");
    const base = { at, version: PLAN_REVIEW_VERSION, reviewedDay: day, effectiveDay, exerciseId: item.id, exerciseName: item.name, restingThrough: null, warning: false };

    if (reasons.length) {
      if (!item.fixedLevel && state.level > MIN_LEVEL) {
        changes.push({ ...base, id: changeId(day, item.id, "easier"), kind: "easier", fromLevel: state.level, toLevel: asLevel(state.level - 1), reasons });
      } else {
        // Already as gentle as it goes: the level stays, but the patient still hears from Alira.
        changes.push({ ...base, id: changeId(day, item.id, "steady"), kind: "steady", fromLevel: state.level, toLevel: state.level, reasons });
      }
      continue;
    }

    const ceiling = Math.min(MAX_LEVEL, item.baseLevel + MAX_LEVELS_ABOVE_CHECK);
    if (easierOnly || item.fixedLevel || state.level >= ceiling) continue;
    if (dayReports.some(r => r.felt === "harder")) continue;
    const sessionDays = Array.from(new Set(attempts.filter(a => a.exerciseId === item.id && a.day <= day).map(a => a.day))).sort().reverse().slice(0, PROGRESS_DAYS);
    if (sessionDays.length < PROGRESS_DAYS) continue;
    const good = sessionDays.every(d => {
      // A result with no level (only the day's score is known) is taken to be at the level the plan gave that day.
      const onDay = attempts.filter(a => a.exerciseId === item.id && a.day === d && (a.level === null || a.level === state.level));
      const feltOnDay = reports.filter(r => r.day === d && r.source === "exercise" && r.exerciseId === item.id);
      const dayBest = bestScore(onDay);
      return onDay.length > 0 && onDay.some(completed) && dayBest !== null && dayBest >= GOOD_SCORE
        && !feltOnDay.some(r => r.felt === "harder" || r.felt === "much_harder" || (r.pain !== undefined && r.pain !== "none") || r.stopped);
    });
    if (good) changes.push({ ...base, id: changeId(day, item.id, "harder"), kind: "harder", fromLevel: state.level, toLevel: asLevel(state.level + 1), reasons: ["good_sessions"] });
  }
  return changes;
}

/**
 * Everything the review used for one day. When it differs from what was reviewed (a session after
 * the evening review, or a "How did that feel?" answer added later), that day is reviewed again.
 */
export function evidenceKey(day: string, attempts: readonly Attempt[], reports: readonly DifficultyReport[]): string {
  const tried = attempts.filter(a => a.day === day).map(a => [a.exerciseId, a.level, a.score, a.repsPlanned, a.repsDone, a.eased].join("|")).sort();
  const felt = reports.filter(r => r.day === day).map(r => [r.source, r.exerciseId ?? "", r.felt ?? "", r.pain ?? "", r.stopped ? 1 : 0, r.at].join("|")).sort();
  return JSON.stringify([tried, felt]);
}

/**
 * Reviews a day again with everything known now. Each exercise goes back to where it stood before
 * that day's evening decision and is decided afresh, still at most one step. An exercise changed
 * again since (a rest after a later warning sign, say) keeps what it has.
 */
export function reviewDayAgain({
  day, plan, states, planRestingThrough, changes, attempts, reports, at, rehabBlocked = false,
}: {
  day: string;
  plan: readonly PlanItem[];
  states: ExerciseStates;
  planRestingThrough: string | null;
  changes: readonly PlanChange[];
  attempts: readonly Attempt[];
  reports: readonly DifficultyReport[];
  at: string;
  rehabBlocked?: boolean;
}): { states: ExerciseStates; changes: PlanChange[]; added: PlanChange[]; removed: PlanChange[] } {
  const evening = changes.filter(c => c.reviewedDay === day && !c.warning && c.exerciseId !== null);
  const locked = new Set(evening.filter(e => changes.some(c => c.exerciseId === e.exerciseId && c.at > e.at)).map(e => e.exerciseId));
  let before = { ...states };
  for (const change of evening) {
    if (locked.has(change.exerciseId) || change.fromLevel === null || !change.exerciseId) continue;
    before = { ...before, [change.exerciseId]: { level: change.fromLevel, restingThrough: before[change.exerciseId]?.restingThrough ?? null } };
  }
  const open = plan.filter(item => !locked.has(item.id));
  const decided = reviewDay({ day, plan: open, states: before, attempts, reports, at, rehabBlocked });
  const same = (a: PlanChange, b: PlanChange) => a.id === b.id && a.fromLevel === b.fromLevel && a.toLevel === b.toLevel;
  const added = decided.filter(change => !evening.some(old => same(old, change)));
  const removed = evening.filter(old => !locked.has(old.exerciseId) && !decided.some(change => same(old, change)));
  const next = applyChanges(before, planRestingThrough, plan, decided).states;
  return { states: next, changes: [...changes.filter(change => !removed.includes(change)), ...added], added, removed };
}

/** The exercise states and the plan's rest day after some changes. */
export function applyChanges(
  states: ExerciseStates,
  planRestingThrough: string | null,
  plan: readonly PlanItem[],
  changes: readonly PlanChange[]
): { states: ExerciseStates; planRestingThrough: string | null } {
  let next = { ...states };
  let rest = planRestingThrough;
  for (const change of changes) {
    if (change.kind === "rest_day") {
      if (change.restingThrough && (!rest || change.restingThrough > rest)) rest = change.restingThrough;
      continue;
    }
    const item = plan.find(p => p.id === change.exerciseId);
    if (!item) continue;
    const state = stateFor(item, next);
    next = {
      ...next,
      [item.id]: {
        level: change.toLevel ?? state.level,
        restingThrough: change.kind === "rest" ? change.restingThrough : state.restingThrough,
      },
    };
  }
  return { states: next, planRestingThrough: rest };
}

// ---------------------------------------------------------------- what Alira says

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven"];
const inWords = (n: number) => NUMBER_WORDS[n] ?? String(n);
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** The most telling reason first. */
const REASON_ORDER: ChangeReason[] = ["pain_a_lot", "stopped_unwell", "pain_a_little", "felt_much_harder", "stopped_early", "low_score", "eased_during_session", "good_sessions"];
export function mainReason(change: PlanChange): ChangeReason | null {
  return REASON_ORDER.find(reason => change.reasons.includes(reason)) ?? null;
}

function whenFrom(day: string, today: string): string {
  return day > today ? "from tomorrow" : day === today ? "from today" : "now";
}

function restWhen(change: PlanChange, today: string): string {
  const through = change.restingThrough ?? today;
  if (through < today) return "for a day";
  if (through === today) return "today";
  if (change.effectiveDay <= today && through === nextDay(today)) return "for the rest of today and tomorrow";
  if (through === nextDay(today)) return "tomorrow";
  return "for a few days";
}

/**
 * Alira's words about a change, for the reminder ("popup", seen the same day or later) or for the
 * Journey note on the day after ("note"). Plain words, no numbers, never "fail".
 */
export function patientLine(change: PlanChange, today: string, style: "popup" | "note" = "popup"): string {
  const name = change.exerciseName;
  const reason = mainReason(change);
  if (style === "note") {
    const why: Partial<Record<ChangeReason, string>> = {
      pain_a_lot: "the pain you mentioned yesterday",
      stopped_unwell: "you stopped yesterday because you felt unwell",
      pain_a_little: "you mentioned a little pain yesterday",
      felt_much_harder: "it felt much harder yesterday",
      stopped_early: "yesterday was hard going",
      low_score: "yesterday was hard going",
      eased_during_session: "yesterday was hard going",
    };
    switch (change.kind) {
      case "easier":
        return `${name} is one level easier, because ${why[reason ?? "low_score"] ?? "yesterday was hard going"}.`;
      case "harder":
        return `${name} is one level harder, after ${inWords(PROGRESS_DAYS)} good sessions in a row.`;
      case "rest":
        return `${name} is resting today, after ${why[reason ?? "pain_a_lot"] ?? "how you felt yesterday"}.`;
      case "rest_day":
        return "All your exercises are resting today, after you felt unwell during yesterday's warm-up.";
      case "steady":
        return `${name} stays at its gentlest level, because ${why[reason ?? "low_score"] ?? "yesterday was hard going"}.`;
    }
  }
  const because: Partial<Record<ChangeReason, string>> = {
    pain_a_little: "You mentioned a little pain.",
    felt_much_harder: "It felt much harder than expected.",
    stopped_early: "It was hard going, so we'll take a step back and build up again.",
    low_score: "It was hard going, so we'll take a step back and build up again.",
    eased_during_session: "It was hard going, so we'll take a step back and build up again.",
  };
  switch (change.kind) {
    case "easier":
      return `${name} is one level easier ${whenFrom(change.effectiveDay, today)}. ${because[reason ?? "low_score"] ?? ""}`.trim();
    case "harder":
      return `${name} is one level harder ${whenFrom(change.effectiveDay, today)}. You've done it well ${inWords(PROGRESS_DAYS)} sessions in a row.`;
    case "rest": {
      const cause = reason === "stopped_unwell" ? "you stopped because you felt unwell" : "it hurt a lot";
      const back = change.toLevel !== null && change.fromLevel !== null && change.toLevel < change.fromLevel ? " When it comes back, it will be one level easier." : "";
      return `${name} is resting ${restWhen(change, today)} because ${cause}.${back} I've let the Rehyn team know.`;
    }
    case "rest_day":
      return `All your exercises are resting ${restWhen(change, today)}, because you didn't feel well during the warm-up. I've let the Rehyn team know.`;
    case "steady":
      return `${name} stays at its gentlest level ${whenFrom(change.effectiveDay, today)}. ${reason === "pain_a_little" ? "You mentioned a little pain, so take it slowly." : reason === "felt_much_harder" ? "It felt much harder than expected, so take it slowly." : "It was hard going, so we'll keep it gentle and build up from here."}`;
  }
}

/** The lead line of Alira's note on the day after changes. */
export const noteLead = (name: string) => `${name}, I've adjusted today's plan:`;

const ADMIN_REASON: Record<ChangeReason, string> = {
  pain_a_lot: "reported a lot of pain",
  stopped_unwell: "stopped because they felt unwell",
  pain_a_little: "reported a little pain",
  felt_much_harder: "said it felt much harder",
  stopped_early: "stopped before the last rep",
  low_score: `best score below ${LOW_SCORE}`,
  eased_during_session: "the target moved closer during the session",
  good_sessions: `${PROGRESS_DAYS} good sessions in a row (score ${GOOD_SCORE}+)`,
};

/** One line for the admin email, with the detail the patient doesn't see. */
export function adminLine(change: PlanChange): string {
  const why = change.reasons.map(reason => ADMIN_REASON[reason]).join("; ");
  const levels = change.fromLevel !== null && change.toLevel !== null && change.fromLevel !== change.toLevel ? ` Level ${change.fromLevel} to ${change.toLevel}.` : "";
  switch (change.kind) {
    case "easier":
      return `${change.exerciseName}: one level easier from ${change.effectiveDay}.${levels} Why: ${why}.`;
    case "harder":
      return `${change.exerciseName}: one level harder from ${change.effectiveDay}.${levels} Why: ${why}.`;
    case "rest":
      return `${change.exerciseName}: resting through ${change.restingThrough}, then back one level easier.${levels} Why: ${why} (${change.reviewedDay}).`;
    case "rest_day":
      return `Every exercise resting through ${change.restingThrough}. Why: during the warm-up, ${why} (${change.reviewedDay}).`;
    case "steady":
      return `${change.exerciseName}: kept at the easiest level from ${change.effectiveDay} (no lower level). Why: ${why}.`;
  }
}

// ---------------------------------------------------------------- admin alerts

export type AdminAlertKind = "warning" | "plan_changes";
/**
 * What the browser asks the server to email to the admin. `test` marks alerts from a simulated day
 * (the Journey's local "Next day" control), so they can't be mistaken for real ones.
 */
export type AdminAlert = { id: string; kind: AdminAlertKind; day: string; patient: string; title: string; lines: string[]; test?: boolean };

export const ALERT_LIMITS = { maxLines: 12, maxLineChars: 400, maxTitleChars: 120, maxIdChars: 120 } as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const cleanText = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : "");

/** Rebuilds an alert from known fields only, or null if it isn't one. */
export function readAdminAlert(value: unknown): AdminAlert | null {
  if (!isRecord(value)) return null;
  const id = cleanText(value.id, ALERT_LIMITS.maxIdChars);
  const kind = value.kind === "warning" || value.kind === "plan_changes" ? value.kind : null;
  const title = cleanText(value.title, ALERT_LIMITS.maxTitleChars);
  const patient = cleanText(value.patient, 60) || "The patient";
  const lines = Array.isArray(value.lines) ? value.lines.map(line => cleanText(line, ALERT_LIMITS.maxLineChars)).filter(Boolean).slice(0, ALERT_LIMITS.maxLines) : [];
  if (!id || !kind || !title || !isDay(value.day) || !lines.length) return null;
  return { id, kind, day: value.day, patient, title, lines, ...(value.test === true ? { test: true } : {}) };
}

/** The warning email for one change made straight after a warning sign. */
export function warningAlert(change: PlanChange, patient: string, test = false): AdminAlert {
  return {
    id: `warning:${change.id}`, kind: "warning", day: change.reviewedDay, patient,
    title: change.exerciseId ? `${patient}: warning sign during ${change.exerciseName}` : `${patient}: warning sign during the warm-up`,
    lines: [adminLine(change)],
    ...(test ? { test: true } : {}),
  };
}

/**
 * The evening summary of one reviewed day's changes (warnings are emailed on their own). A day
 * reviewed again gets a new summary, with `revision` in its id so it isn't taken for a duplicate.
 */
export function summaryAlert(day: string, changes: readonly PlanChange[], patient: string, test = false, revision = 0): AdminAlert | null {
  const lines = changes.filter(change => !change.warning).map(adminLine);
  if (!lines.length) return null;
  return {
    id: revision ? `summary:${day}:${revision}` : `summary:${day}`, kind: "plan_changes", day, patient,
    title: `${patient}: plan changes after ${day}${revision ? " (updated)" : ""}`, lines,
    ...(test ? { test: true } : {}),
  };
}

export { previousDay };
