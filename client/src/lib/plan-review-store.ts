// Where Alira's daily plan review keeps its state in this browser: each exercise's adjusted level
// and rest days, the change log the reminder and the Journey note read, and the admin emails still
// waiting to be sent. The rules themselves live in shared/plan-review.ts; the review runs in
// ./plan-review.ts. This file has no app dependencies so the Journey can read it without a cycle.
import {
  asLevel, isDay, isResting, PLAN_REVIEW_VERSION, readAdminAlert,
  type AdminAlert, type ChangeKind, type ChangeReason, type ExerciseStates, type Level, type PlanChange,
} from "@shared/plan-review";

import { EVERYDAY_EXERCISE_ID } from "./exercise-engine/config";

export const PLAN_REVIEW_KEY = "rehyn.plan.review.v1";
const CHANGE_LIMIT = 60;
const OUTBOX_LIMIT = 40;
const EMAILED_LIMIT = 100;

/** An admin email waiting to go out. */
export type QueuedAlert = { alert: AdminAlert; queuedAt: string; tries: number; lastError: string | null };

export type PlanReviewState = {
  v: 1;
  /** The movement check the levels belong to. A new check brings a new plan and a fresh start. */
  assessmentId: string | null;
  states: ExerciseStates;
  /** Every exercise rests through this day (a warning sign during the warm-up). */
  planRestingThrough: string | null;
  /** The last day the evening review has looked at. */
  reviewedThrough: string | null;
  /** What that day's review was based on; when it changes, the day is reviewed again. */
  reviewedEvidence: string | null;
  /** The newest "How did that feel?" answer already checked for warning signs. */
  reportsCheckedAt: string | null;
  changes: PlanChange[];
  /** The newest change the patient has acknowledged in the reminder. */
  seenAt: string | null;
  /** The newest change the reminder has already opened itself for. */
  shownAt: string | null;
  outbox: QueuedAlert[];
  /** Admin emails the server has confirmed, newest last. */
  emailed: string[];
};

export const emptyPlanReview = (): PlanReviewState => ({
  v: 1, assessmentId: null, states: {}, planRestingThrough: null, reviewedThrough: null, reviewedEvidence: null, reportsCheckedAt: null,
  changes: [], seenAt: null, shownAt: null, outbox: [], emailed: [],
});

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const KINDS: ChangeKind[] = ["easier", "harder", "rest", "rest_day", "steady"];
const REASONS: ChangeReason[] = ["pain_a_lot", "stopped_unwell", "pain_a_little", "felt_much_harder", "stopped_early", "low_score", "eased_during_session", "good_sessions"];
const levelOrNull = (value: unknown): Level | null => (typeof value === "number" && Number.isFinite(value) ? asLevel(value) : null);
const dayOrNull = (value: unknown) => (isDay(value) ? value : null);
const textOrNull = (value: unknown) => (typeof value === "string" && value ? value.slice(0, 80) : null);

function readChange(value: unknown): PlanChange | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.at !== "string") return null;
  const kind = KINDS.find(k => k === value.kind);
  if (!kind || !isDay(value.reviewedDay) || !isDay(value.effectiveDay)) return null;
  return {
    id: value.id.slice(0, 120), at: value.at.slice(0, 40), version: typeof value.version === "string" ? value.version.slice(0, 40) : PLAN_REVIEW_VERSION,
    reviewedDay: value.reviewedDay, effectiveDay: value.effectiveDay,
    exerciseId: typeof value.exerciseId === "string" ? value.exerciseId.slice(0, 60) : null,
    exerciseName: typeof value.exerciseName === "string" ? value.exerciseName.slice(0, 80) : "Exercise",
    kind, fromLevel: levelOrNull(value.fromLevel), toLevel: levelOrNull(value.toLevel), restingThrough: dayOrNull(value.restingThrough),
    reasons: Array.isArray(value.reasons) ? REASONS.filter(reason => (value.reasons as unknown[]).includes(reason)) : [],
    warning: value.warning === true,
  };
}

/** Rebuilds the state from known fields only, so a damaged entry can't break the Journey. */
export function readPlanReview(value: unknown): PlanReviewState {
  if (!isRecord(value) || value.v !== 1) return emptyPlanReview();
  const states: ExerciseStates = {};
  if (isRecord(value.states)) {
    for (const [id, state] of Object.entries(value.states)) {
      const level = isRecord(state) ? levelOrNull(state.level) : null;
      if (level && isRecord(state)) states[id.slice(0, 60)] = { level, restingThrough: dayOrNull(state.restingThrough) };
    }
  }
  const outbox: QueuedAlert[] = Array.isArray(value.outbox)
    ? value.outbox.flatMap(item => {
      const alert = isRecord(item) ? readAdminAlert(item.alert) : null;
      return alert && isRecord(item) ? [{ alert, queuedAt: typeof item.queuedAt === "string" ? item.queuedAt : "", tries: typeof item.tries === "number" ? item.tries : 0, lastError: textOrNull(item.lastError) }] : [];
    }).slice(-OUTBOX_LIMIT)
    : [];
  return {
    v: 1,
    assessmentId: typeof value.assessmentId === "string" ? value.assessmentId : null,
    states,
    planRestingThrough: dayOrNull(value.planRestingThrough),
    reviewedThrough: dayOrNull(value.reviewedThrough),
    reviewedEvidence: typeof value.reviewedEvidence === "string" ? value.reviewedEvidence.slice(0, 20000) : null,
    reportsCheckedAt: typeof value.reportsCheckedAt === "string" ? value.reportsCheckedAt : null,
    changes: Array.isArray(value.changes) ? value.changes.map(readChange).filter((c): c is PlanChange => c !== null).slice(-CHANGE_LIMIT) : [],
    seenAt: typeof value.seenAt === "string" ? value.seenAt : null,
    shownAt: typeof value.shownAt === "string" ? value.shownAt : null,
    outbox,
    emailed: Array.isArray(value.emailed) ? value.emailed.filter((id): id is string => typeof id === "string").map(id => id.slice(0, 160)).slice(-EMAILED_LIMIT) : [],
  };
}

// The reminder, the Journey and Alira read the same state; listeners re-read on change.
const listeners = new Set<() => void>();
let memory: PlanReviewState | null = null;
let version = 0;

export function subscribePlanReview(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const planReviewVersion = () => version;

export function loadPlanReview(): PlanReviewState {
  const store = storage();
  if (!store) return memory ?? emptyPlanReview();
  let raw: string | null;
  try {
    raw = store.getItem(PLAN_REVIEW_KEY);
  } catch {
    // Blocked storage: this tab's copy.
    return memory ?? emptyPlanReview();
  }
  // Readable storage is the only truth, so a reset that removed the key starts afresh.
  try {
    return readPlanReview(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyPlanReview();
  }
}

function notify() {
  version += 1;
  listeners.forEach(listener => {
    try { listener(); } catch { /* a listener must not break storage */ }
  });
}

/** Forgets every level, change and queued email (the Journey's local testing "Reset"). */
export function resetPlanReview(): void {
  memory = null;
  try {
    storage()?.removeItem(PLAN_REVIEW_KEY);
  } catch {
    /* nothing to clear */
  }
  notify();
}

export function savePlanReview(state: PlanReviewState): PlanReviewState {
  const clean = readPlanReview({
    ...state,
    changes: state.changes.slice(-CHANGE_LIMIT),
    outbox: state.outbox.slice(-OUTBOX_LIMIT),
    emailed: state.emailed.slice(-EMAILED_LIMIT),
  });
  memory = clean;
  try {
    storage()?.setItem(PLAN_REVIEW_KEY, JSON.stringify(clean));
  } catch {
    /* storage full or blocked: kept for this tab */
  }
  notify();
  return clean;
}

// ---------------------------------------------------------------- what the app reads

/** The level an exercise runs at: the review's, or the plan's own when nothing has changed it. */
export function adjustedLevel(exerciseId: string, baseLevel: Level, assessmentId: string | null | undefined, state = loadPlanReview()): Level {
  if (exerciseId === EVERYDAY_EXERCISE_ID) return 1;
  if (!assessmentId || state.assessmentId !== assessmentId) return baseLevel;
  return state.states[exerciseId]?.level ?? baseLevel;
}

/** Whether an exercise rests on a day after a warning sign. */
export function restingOn(exerciseId: string, day: string, assessmentId: string | null | undefined, state = loadPlanReview()): boolean {
  if (!assessmentId || state.assessmentId !== assessmentId) return false;
  return isResting(state.states[exerciseId], day, state.planRestingThrough);
}

/** Changes the patient hasn't acknowledged yet, oldest first. */
export function unseenChanges(state = loadPlanReview()): PlanChange[] {
  return state.changes.filter(change => !state.seenAt || change.at > state.seenAt);
}

/** The changes that came from a day's results: Alira's note mentions them the day after. */
export function changesFromDay(day: string, assessmentId: string | null | undefined, state = loadPlanReview()): PlanChange[] {
  if (!assessmentId || state.assessmentId !== assessmentId) return [];
  return state.changes.filter(change => change.reviewedDay === day);
}

/** The patient has read the reminder. */
export function markChangesSeen(state = loadPlanReview()): PlanReviewState {
  const newest = state.changes.at(-1)?.at ?? null;
  if (!newest || state.seenAt === newest) return state;
  return savePlanReview({ ...state, seenAt: newest, shownAt: newest });
}

/** The reminder opened itself for these changes, so it won't keep opening on every page. */
export function markChangesShown(state = loadPlanReview()): PlanReviewState {
  const newest = state.changes.at(-1)?.at ?? null;
  if (!newest || state.shownAt === newest) return state;
  return savePlanReview({ ...state, shownAt: newest });
}

/** Admin emails for a change: "sent", still "waiting" in the outbox, or "none" (no email for it). */
export function emailStatus(change: PlanChange, state = loadPlanReview()): "sent" | "waiting" | "none" {
  const ids = change.warning ? [`warning:${change.id}`] : [`summary:${change.reviewedDay}`];
  const queued = state.outbox.some(item => ids.includes(item.alert.id) || (!change.warning && item.alert.id.startsWith(`summary:${change.reviewedDay}:`)));
  if (queued) return "waiting";
  return state.emailed.some(id => ids.includes(id) || (!change.warning && id.startsWith(`summary:${change.reviewedDay}:`))) ? "sent" : "none";
}

export function queueAlert(state: PlanReviewState, alert: AdminAlert, at: string): PlanReviewState {
  if (state.outbox.some(item => item.alert.id === alert.id)) return state;
  return { ...state, outbox: [...state.outbox, { alert, queuedAt: at, tries: 0, lastError: null }] };
}
