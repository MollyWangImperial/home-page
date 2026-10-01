// Runs Alira's daily plan review in the browser, where the patient's results live:
//  - straight away, warning signs in "How did that feel?" (a lot of pain, stopping because of
//    feeling unwell) rest the exercise and queue an email to the admin;
//  - each evening at REVIEW_HOUR, or the next time the app opens, every finished day not yet
//    reviewed is looked at with the fixed rules in shared/plan-review.ts, and the changes apply
//    from the next day. A summary email goes to the admin when the plan changed.
// The state lives in ./plan-review-store.ts. See docs/plan-review.md.
import {
  addDays, applyChanges, daysBetween, evidenceKey, nextDay, previousDay, REVIEW_HOUR, reviewDay, reviewDayAgain, summaryAlert,
  warningAlert, warningChanges, type AdminAlert, type Attempt, type Level, type PlanChange, type PlanItem,
} from "@shared/plan-review";
import { learningToday, loadReports } from "./alira-learning-store";
import { type StoredAssessment, loadRememberedAssessment } from "./assessment";
import { EXERCISES, usesSeatedTargets } from "./exercise-engine/config";
import { readLabSessions, type LabSession } from "./exercise-engine/lab-storage";
import { dayKey, PATIENT_NAME } from "./home-stage";
import { companionPlan, demoDayOffset, journeyNow, loadSessionStore, planDesigned, rungFor, type SessionStore } from "./journey";
import { loadPlanReview, queueAlert, savePlanReview, type PlanReviewState } from "./plan-review-store";

/** How far back a review catches up after the app has been closed for a while. */
const CATCH_UP_DAYS = 7;
/** Admin emails older than this are dropped rather than sent late. */
const ALERT_MAX_AGE_DAYS = 30;

/** The plan's exercises the companion runs itself, as the review sees them. */
export function planItems(assessment: StoredAssessment | null | undefined): PlanItem[] {
  return companionPlan(assessment).map(exercise => ({
    id: exercise.id,
    name: EXERCISES[exercise.id]?.name ?? exercise.name,
    baseLevel: usesSeatedTargets(exercise.id) ? 1 : rungFor(exercise),
    fixedLevel: usesSeatedTargets(exercise.id),
  }));
}

/**
 * Every go at an exercise: from the session records where they are still kept (the newest twenty),
 * and otherwise from the Journey's best score of the day. Simulated sessions count only in local
 * development, as on the Journey.
 */
export function attemptsFrom(sessions: readonly LabSession[], store: SessionStore, includeSimulated: boolean): Attempt[] {
  const attempts: Attempt[] = [];
  for (const session of sessions) {
    if (!session || typeof session.exercise_id !== "string" || session.not_attempted) continue;
    if (session.sim && !includeSimulated) continue;
    const finished = new Date(session.finished_at);
    if (Number.isNaN(finished.getTime())) continue;
    const level = [1, 2, 3].includes(session.rung_start) ? (session.rung_start as Level) : null;
    attempts.push({
      exerciseId: session.exercise_id,
      day: dayKey(journeyNow(finished)),
      level,
      score: typeof session.score === "number" && Number.isFinite(session.score) ? session.score : null,
      repsPlanned: typeof session.reps_planned === "number" ? session.reps_planned : null,
      repsDone: Array.isArray(session.repetition_scores) ? session.repetition_scores.length : null,
      eased: typeof session.rung_end === "number" && level !== null && session.rung_end < level,
    });
  }
  for (const [day, results] of Object.entries(store)) {
    for (const [exerciseId, result] of Object.entries(results ?? {})) {
      if (typeof result?.score !== "number" || attempts.some(a => a.exerciseId === exerciseId && a.day === day)) continue;
      attempts.push({ exerciseId, day, level: null, score: result.score, repsPlanned: null, repsDone: null, eased: false });
    }
  }
  return attempts;
}

export type ReviewOptions = { now?: Date; includeSimulated?: boolean };

/**
 * One review pass: warning signs first, then each finished day not yet reviewed. Returns the
 * changes it made (already saved, with their admin emails queued).
 */
export function reviewNow({ now = new Date(), includeSimulated = import.meta.env.DEV }: ReviewOptions = {}): PlanChange[] {
  const assessment = loadRememberedAssessment();
  if (!assessment || !planDesigned(assessment)) return [];
  const plan = planItems(assessment);
  if (!plan.length) return [];
  const before = loadPlanReview();
  let state: PlanReviewState = before;
  const at = now.toISOString();
  const today = learningToday(now);
  const startAgain = (current: PlanReviewState): PlanReviewState => ({
    ...current, assessmentId: assessment.id, states: {}, planRestingThrough: null, reviewedThrough: null, reviewedEvidence: null,
  });
  // A new movement check brought a new plan: levels start again from it. The log and emails stay.
  if (state.assessmentId !== assessment.id) state = startAgain(state);
  // The clock went back (testing's "Reset" undoes simulated days): start again from today.
  if (state.reviewedThrough && state.reviewedThrough > today) state = startAgain(state);
  // A simulated day (the Journey's local "Next day" control) still counts as a real one, but its
  // admin emails are marked as tests.
  const testing = demoDayOffset() > 0;
  const reports = loadReports();
  const attempts = attemptsFrom(readLabSessions(), loadSessionStore(), includeSimulated);
  const rehabBlocked = assessment.report?.clinical_review_gate?.rehab_access === "blocked";
  const added: PlanChange[] = [];
  const apply = (changes: PlanChange[]) => {
    const next = applyChanges(state.states, state.planRestingThrough, plan, changes);
    state = { ...state, ...next, changes: [...state.changes, ...changes] };
    added.push(...changes);
  };

  // Warning signs, straight away. The first time, only yesterday's and today's answers count.
  const fresh = reports.filter(report => (state.reportsCheckedAt ? report.at > state.reportsCheckedAt : report.day >= previousDay(today)));
  const warnings = warningChanges({ reports: fresh, plan, states: state.states, planRestingThrough: state.planRestingThrough, at })
    .filter(change => !state.changes.some(old => old.id === change.id));
  if (warnings.length) {
    apply(warnings);
    for (const change of warnings) state = queueAlert(state, warningAlert(change, PATIENT_NAME, testing), at);
  }
  const newest = reports.reduce((latest, report) => (report.at > latest ? report.at : latest), state.reportsCheckedAt ?? "");
  if (newest) state = { ...state, reportsCheckedAt: newest };

  // The evening review: today once it is past REVIEW_HOUR, and any earlier day not yet reviewed.
  const lastFinished = now.getHours() >= REVIEW_HOUR ? today : previousDay(today);

  // Results that arrived after a day was reviewed (a session after 8pm, or scores entered while
  // testing) review that day again, so today's results always shape tomorrow's plan.
  const reviewed = state.reviewedThrough;
  if (reviewed && reviewed <= lastFinished && state.reviewedEvidence !== null && evidenceKey(reviewed, attempts, reports) !== state.reviewedEvidence) {
    const again = reviewDayAgain({ day: reviewed, plan, states: state.states, planRestingThrough: state.planRestingThrough, changes: state.changes, attempts, reports, at, rehabBlocked });
    state = { ...state, states: again.states, changes: again.changes, reviewedEvidence: evidenceKey(reviewed, attempts, reports) };
    added.push(...again.added);
    if (again.added.length || again.removed.length) {
      // An unsent summary for that day is replaced; one already emailed gets an updated one.
      const emailedBefore = state.emailed.some(id => id === `summary:${reviewed}` || id.startsWith(`summary:${reviewed}:`));
      state = { ...state, outbox: state.outbox.filter(item => !(item.alert.kind === "plan_changes" && item.alert.day === reviewed)) };
      const summary = summaryAlert(reviewed, state.changes.filter(change => change.reviewedDay === reviewed), PATIENT_NAME, testing, emailedBefore ? Date.parse(at) : 0);
      if (summary) state = queueAlert(state, summary, at);
    }
  }

  let from = state.reviewedThrough ? nextDay(state.reviewedThrough) : lastFinished;
  const earliest = addDays(lastFinished, -(CATCH_UP_DAYS - 1));
  if (from < earliest) from = earliest;
  if (from <= lastFinished) {
    for (const day of daysBetween(from, lastFinished)) {
      const changes = reviewDay({ day, plan, states: state.states, attempts, reports, at, rehabBlocked })
        .filter(change => !state.changes.some(old => old.id === change.id));
      if (!changes.length) continue;
      apply(changes);
      const summary = summaryAlert(day, changes, PATIENT_NAME, testing);
      if (summary) state = queueAlert(state, summary, at);
    }
    state = { ...state, reviewedThrough: lastFinished, reviewedEvidence: evidenceKey(lastFinished, attempts, reports) };
  }

  if (JSON.stringify(state) !== JSON.stringify(before)) savePlanReview(state);
  return added;
}

// ---------------------------------------------------------------- admin emails

export type SendOutcome = "sent" | "not_configured" | "rejected" | "failed";
export type AlertSender = (alert: AdminAlert) => Promise<SendOutcome>;

export const sendAdminAlert: AlertSender = async alert => {
  try {
    const response = await fetch("/api/admin-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alert),
    });
    if (response.ok) return "sent";
    if (response.status === 503) return "not_configured";
    if (response.status === 400) return "rejected";
    return "failed";
  } catch {
    return "failed";
  }
};

let lastTry = 0;
const RETRY_MS = 60000;

/**
 * Sends the queued admin emails. An email stays queued until the server confirms it, so nothing is
 * lost while email isn't set up or the connection is down; it is dropped only if the server says
 * it is malformed or it is older than ALERT_MAX_AGE_DAYS.
 */
export async function flushAlerts({ send = sendAdminAlert, now = new Date(), force = false }: { send?: AlertSender; now?: Date; force?: boolean } = {}): Promise<void> {
  const queued = loadPlanReview().outbox;
  if (!queued.length || (!force && now.getTime() - lastTry < RETRY_MS)) return;
  lastTry = now.getTime();
  const oldest = new Date(now.getTime() - ALERT_MAX_AGE_DAYS * 86400000).toISOString();
  for (const item of queued) {
    const outcome = item.queuedAt < oldest ? "rejected" : await send(item.alert);
    const state = loadPlanReview();
    const outbox = outcome === "sent" || outcome === "rejected"
      ? state.outbox.filter(entry => entry.alert.id !== item.alert.id)
      : state.outbox.map(entry => (entry.alert.id === item.alert.id ? { ...entry, tries: entry.tries + 1, lastError: outcome } : entry));
    savePlanReview({ ...state, outbox, emailed: outcome === "sent" ? [...state.emailed, item.alert.id] : state.emailed });
    if (outcome === "not_configured" || outcome === "failed") break;
  }
}

// ---------------------------------------------------------------- running it

let active: Promise<void> | null = null;
let again = false;

/** Reviews now and sends any queued emails. Calls while one is running fold into one more pass. */
export function runPlanReview(options: ReviewOptions & { send?: AlertSender } = {}): Promise<void> {
  if (active) {
    again = true;
    return active;
  }
  active = (async () => {
    do {
      again = false;
      let added: PlanChange[] = [];
      try {
        added = reviewNow(options);
      } catch {
        /* A damaged store must never break the page; the next pass tries again. */
      }
      // New changes go out at once; older queued emails are retried at most once a minute.
      await flushAlerts({ send: options.send, now: options.now, force: added.length > 0 });
    } while (again);
  })().finally(() => {
    active = null;
  });
  return active;
}
