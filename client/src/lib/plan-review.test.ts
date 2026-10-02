import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminLine, evidenceKey, GOOD_SCORE, LOW_SCORE, patientLine, readAdminAlert, reviewDay, reviewDayAgain, summaryAlert, warningAlert, warningChanges,
  type Attempt, type PlanChange, type PlanItem,
} from "@shared/plan-review";
import type { DifficultyReport } from "@shared/alira-adaptation";
import { REPORTS_KEY } from "./alira-learning-store";
import { rememberAssessment, rememberAssessmentPlan, type AssessmentReport } from "./assessment";
import { buildJourney, clearJourneyRecords, ensureJourneyRecords, JOURNEY_CLOCK_EVENT, launchablePlan, setDemoDayOffset } from "./journey";
import { attemptsFrom, flushAlerts, planItems, reviewNow, type AlertSender } from "./plan-review";
import { emailStatus, emptyPlanReview, loadPlanReview, markChangesSeen, PLAN_REVIEW_KEY, savePlanReview, unseenChanges } from "./plan-review-store";

const plan: PlanItem[] = [
  { id: "ex_handopen", name: "Active Hand Opening", baseLevel: 2, fixedLevel: false },
  { id: "ex_reach", name: "Graded Forward Reach", baseLevel: 1, fixedLevel: true },
];
const at = "2026-10-01T19:00:00.000Z";
const report = (r: Partial<DifficultyReport>): DifficultyReport => ({ day: "2026-10-01", at, source: "exercise", exerciseId: "ex_handopen", ...r });
const attempt = (a: Partial<Attempt>): Attempt => ({ exerciseId: "ex_handopen", day: "2026-10-01", level: 2, score: 85, repsPlanned: 8, repsDone: 8, eased: false, ...a });
const review = (attempts: Attempt[], reports: DifficultyReport[] = [], extra: { states?: Record<string, { level: 1 | 2 | 3; restingThrough: string | null }>; rehabBlocked?: boolean } = {}) =>
  reviewDay({ day: "2026-10-01", plan, states: extra.states ?? {}, attempts, reports, at, rehabBlocked: extra.rehabBlocked });

describe("warning signs", () => {
  it("rest the exercise for the rest of the day and the next, then bring it back one level easier", () => {
    const changes = warningChanges({ reports: [report({ pain: "a_lot" })], plan, states: {}, planRestingThrough: null, at });
    expect(changes).toEqual([expect.objectContaining({
      kind: "rest", exerciseId: "ex_handopen", reviewedDay: "2026-10-01", effectiveDay: "2026-10-01",
      restingThrough: "2026-10-02", fromLevel: 2, toLevel: 1, reasons: ["pain_a_lot"], warning: true,
    })]);
  });
  it("are reported once, rest everything after a warm-up warning, and never change a fixed level", () => {
    const twice = warningChanges({ reports: [report({ stopped: true }), report({ pain: "a_lot", at: "2026-10-01T19:05:00.000Z" })], plan, states: {}, planRestingThrough: null, at });
    expect(twice).toHaveLength(1);
    expect(twice[0].reasons).toEqual(["stopped_unwell"]);
    const warmUp = warningChanges({ reports: [report({ source: "warm_rep", exerciseId: undefined, stopped: true })], plan, states: {}, planRestingThrough: null, at });
    expect(warmUp).toEqual([expect.objectContaining({ kind: "rest_day", exerciseId: null, restingThrough: "2026-10-02" })]);
    const fixed = warningChanges({ reports: [report({ exerciseId: "ex_reach", pain: "a_lot" })], plan, states: {}, planRestingThrough: null, at });
    expect(fixed[0]).toMatchObject({ fromLevel: 1, toLevel: 1 });
    expect(warningChanges({ reports: [report({ pain: "a_little", felt: "much_harder" })], plan, states: {}, planRestingThrough: null, at })).toEqual([]);
  });
});

describe("the evening review", () => {
  it("leaves an exercise alone without a session that day", () => {
    expect(review([])).toEqual([]);
  });
  it("makes the next day one level easier after a hard day, never below the easiest", () => {
    const cases: [Attempt[], DifficultyReport[], string][] = [
      [[attempt({})], [report({ felt: "much_harder" })], "felt_much_harder"],
      [[attempt({})], [report({ pain: "a_little" })], "pain_a_little"],
      [[attempt({ score: LOW_SCORE - 1 })], [], "low_score"],
      [[attempt({ repsDone: 5 })], [], "stopped_early"],
      [[attempt({ eased: true })], [], "eased_during_session"],
    ];
    for (const [attempts, reports, reason] of cases) {
      const [change] = review(attempts, reports);
      expect(change).toMatchObject({ kind: "easier", fromLevel: 2, toLevel: 1, effectiveDay: "2026-10-02", warning: false });
      expect(change.reasons).toContain(reason);
    }
    // At the easiest level the level stays, but Alira still tells the patient.
    const [steady] = review([attempt({ level: 1, score: 20 })], [], { states: { ex_handopen: { level: 1, restingThrough: null } } });
    expect(steady).toMatchObject({ kind: "steady", fromLevel: 1, toLevel: 1, reasons: ["low_score"] });
    expect(patientLine(steady, "2026-10-02")).toBe("Active Hand Opening stays at its gentlest level from today. It was hard going, so we'll keep it gentle and build up from here.");
  });
  it("makes it one level harder after two good days at the current level, up to one above the movement check", () => {
    const twoGoodDays = [attempt({ day: "2026-09-30", score: GOOD_SCORE }), attempt({ score: 92 })];
    expect(review(twoGoodDays)).toEqual([expect.objectContaining({ kind: "harder", fromLevel: 2, toLevel: 3, reasons: ["good_sessions"] })]);
    expect(review([attempt({ score: 92 })])).toEqual([]);
    expect(review(twoGoodDays, [], { states: { ex_handopen: { level: 3, restingThrough: null } } })).toEqual([]);
    expect(review([attempt({ day: "2026-09-30", level: 1 }), attempt({})])).toEqual([]);
  });
  it("counts a day known only by its score as done at that day's level", () => {
    const scoresOnly = [attempt({ day: "2026-09-30", level: null, repsDone: null, repsPlanned: null }), attempt({ level: null, repsDone: null, repsPlanned: null, score: 90 })];
    expect(review(scoresOnly)).toEqual([expect.objectContaining({ kind: "harder", fromLevel: 2, toLevel: 3 })]);
  });

  it("decides a day again from scratch, keeping an exercise changed again since", () => {
    const states = { ex_handopen: { level: 1 as const, restingThrough: null } };
    const easier: PlanChange = { id: "2026-10-01:ex_handopen:easier", at, version: "v", reviewedDay: "2026-10-01", effectiveDay: "2026-10-02", exerciseId: "ex_handopen", exerciseName: "Active Hand Opening", kind: "easier", fromLevel: 2, toLevel: 1, restingThrough: null, reasons: ["low_score"], warning: false };
    const better = [attempt({ score: 30 }), attempt({ score: 85 })];
    const later = "2026-10-01T21:00:00.000Z";
    // Still a hard day overall (it felt much harder): the same decision, kept as it was.
    const same = reviewDayAgain({ day: "2026-10-01", plan, states, planRestingThrough: null, changes: [easier], attempts: better, reports: [report({ felt: "much_harder" })], at: later });
    expect(same).toMatchObject({ added: [], removed: [], changes: [easier] });
    // Only good results now: the easier step is undone.
    const undone = reviewDayAgain({ day: "2026-10-01", plan, states, planRestingThrough: null, changes: [easier], attempts: [attempt({ score: 85 })], reports: [], at: later });
    expect(undone).toMatchObject({ added: [], removed: [easier], changes: [] });
    expect(undone.states.ex_handopen.level).toBe(2);
    // A rest after a later warning sign locks the exercise.
    const rest: PlanChange = { ...easier, id: "2026-10-01:ex_handopen:rest", at: later, kind: "rest", fromLevel: 1, toLevel: 1, restingThrough: "2026-10-02", reasons: ["pain_a_lot"], warning: true };
    const locked = reviewDayAgain({ day: "2026-10-01", plan, states: { ex_handopen: { level: 1, restingThrough: "2026-10-02" } }, planRestingThrough: null, changes: [easier, rest], attempts: [attempt({ score: 85 })], reports: [], at: "2026-10-01T22:00:00.000Z" });
    expect(locked).toMatchObject({ removed: [], added: [] });
    expect(locked.states.ex_handopen).toEqual({ level: 1, restingThrough: "2026-10-02" });
    expect(evidenceKey("2026-10-01", better, [])).not.toBe(evidenceKey("2026-10-01", [attempt({ score: 85 })], []));
  });

  it("holds when something felt harder or hurt lately, when the review gate is closed, or for a fixed level", () => {
    const twoGoodDays = [attempt({ day: "2026-09-30" }), attempt({})];
    expect(review(twoGoodDays, [report({ felt: "harder" })])).toEqual([]);
    expect(review(twoGoodDays, [report({ exerciseId: "ex_reach", pain: "a_little", day: "2026-09-30" })])).toEqual([]);
    expect(review(twoGoodDays, [], { rehabBlocked: true })).toEqual([]);
    expect(review([attempt({ exerciseId: "ex_reach", level: 1, score: 10 })])).toEqual([expect.objectContaining({ kind: "steady", exerciseId: "ex_reach", fromLevel: 1, toLevel: 1 })]);
    expect(review(twoGoodDays, [], { states: { ex_handopen: { level: 2, restingThrough: "2026-10-01" } } })).toEqual([]);
  });
});

describe("what Alira says", () => {
  const change = (c: Partial<PlanChange>): PlanChange => ({
    id: "x", at, version: "v", reviewedDay: "2026-10-01", effectiveDay: "2026-10-02", exerciseId: "ex_handopen", exerciseName: "Active Hand Opening",
    kind: "easier", fromLevel: 2, toLevel: 1, restingThrough: null, reasons: ["felt_much_harder"], warning: false, ...c,
  });
  it("speaks plainly, with no numbers and never 'fail'", () => {
    const lines = [
      patientLine(change({}), "2026-10-01"),
      patientLine(change({ kind: "harder", fromLevel: 1, toLevel: 2, reasons: ["good_sessions"] }), "2026-10-01"),
      patientLine(change({ kind: "rest", restingThrough: "2026-10-02", effectiveDay: "2026-10-01", reasons: ["pain_a_lot"], warning: true }), "2026-10-01"),
      patientLine(change({ kind: "rest_day", exerciseId: null, restingThrough: "2026-10-02", effectiveDay: "2026-10-01", reasons: ["stopped_unwell"], warning: true }), "2026-10-01"),
      patientLine(change({}), "2026-10-02", "note"),
      patientLine(change({ kind: "rest", restingThrough: "2026-10-02", reasons: ["pain_a_lot"] }), "2026-10-02", "note"),
    ];
    expect(lines).toEqual([
      "Active Hand Opening is one level easier from tomorrow. It felt much harder than expected.",
      "Active Hand Opening is one level harder from tomorrow. You've done it well two sessions in a row.",
      "Active Hand Opening is resting for the rest of today and tomorrow because it hurt a lot. When it comes back, it will be one level easier. I've let the Rehyn team know.",
      "All your exercises are resting for the rest of today and tomorrow, because you didn't feel well during the warm-up. I've let the Rehyn team know.",
      "Active Hand Opening is one level easier, because it felt much harder yesterday.",
      "Active Hand Opening is resting today, after the pain you mentioned yesterday.",
    ]);
    for (const line of lines) expect(line).not.toMatch(/\d|fail/i);
  });
  it("gives the admin the detail, and emails warnings on their own", () => {
    const rest = change({ kind: "rest", restingThrough: "2026-10-02", reasons: ["pain_a_lot"], warning: true });
    expect(adminLine(rest)).toBe("Active Hand Opening: resting through 2026-10-02, then back one level easier. Level 2 to 1. Why: reported a lot of pain (2026-10-01).");
    expect(warningAlert(rest, "Zak")).toMatchObject({ kind: "warning", title: "Zak: warning sign during Active Hand Opening" });
    expect(summaryAlert("2026-10-01", [rest], "Zak")).toBeNull();
    expect(summaryAlert("2026-10-01", [rest, change({})], "Zak")?.lines).toHaveLength(1);
  });
  it("accepts only well-formed alerts", () => {
    const good = { id: "a", kind: "warning", day: "2026-10-01", patient: "Zak", title: "T", lines: ["one\nline", ""] };
    expect(readAdminAlert(good)).toEqual({ ...good, lines: ["one line"] });
    for (const bad of [null, { ...good, kind: "spam" }, { ...good, day: "yesterday" }, { ...good, lines: [] }, { ...good, title: "" }]) expect(readAdminAlert(bad)).toBeNull();
  });
});

// ---------------------------------------------------------------- in the browser

const assessmentReport: AssessmentReport = {
  id: "a1", preview_only: true,
  metrics: { function_score: { display_total: 60, tasks: [], areas: { upper_limb: { display_score: 62 }, hand: { display_score: 48 }, lower_limb: { display_score: null } } } },
  rehab_plan: [
    { id: "ex_handopen", name: "Hand opening", description: "Open the hand.", sets: 2, reps: 8, frequency: "Daily", difficulty: "medium" },
    { id: "ex_reach", name: "Reach", description: "Reach forward.", sets: 3, reps: 8, frequency: "Daily", difficulty: "easy" },
  ],
};
const session = (s: Record<string, unknown>) => ({
  engine: "test", exercise_id: "ex_handopen", rung_start: 2, rung_end: 2, reps_planned: 8, repetition_scores: [80, 80, 80, 80, 80, 80, 80, 80],
  quality_reps: 8, best_attainment: 1, best_value: null, best_label: "", compensation_counts: {}, hold_pass_count: 0, not_attempted: false,
  assisted: false, chair_back: false, score: 85, wrap: "", finished_at: new Date(2026, 9, 1, 18, 0).toISOString(), side: "right", sim: false, ...s,
});

let values: Map<string, string>;
beforeEach(() => {
  values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  vi.stubGlobal("localStorage", store);
  vi.stubGlobal("window", { localStorage: store });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function withPlan() {
  return rememberAssessmentPlan(rememberAssessment(assessmentReport)!, assessmentReport, true);
}
const writeReports = (reports: DifficultyReport[]) => values.set(REPORTS_KEY, JSON.stringify(reports));
const writeSessions = (sessions: Record<string, unknown>[]) => values.set("rehyn.exerciseLab.sessions", JSON.stringify(sessions));

describe("the review in the app", () => {
  it("rests an exercise straight after a warning sign and queues the admin email", () => {
    const assessment = withPlan();
    writeReports([report({ pain: "a_lot", at: new Date(2026, 9, 1, 18, 5).toISOString() })]);
    const changes = reviewNow({ now: new Date(2026, 9, 1, 18, 10), includeSimulated: false });
    expect(changes.map(c => c.kind)).toEqual(["rest"]);
    const state = loadPlanReview();
    expect(state.states.ex_handopen).toEqual({ level: 1, restingThrough: "2026-10-02" });
    expect(state.outbox.map(item => item.alert.id)).toEqual(["warning:2026-10-01:ex_handopen:rest"]);
    expect(launchablePlan(assessment, "2026-10-01").map(e => e.id)).toEqual(["ex_reach"]);
    expect(launchablePlan(assessment, "2026-10-03").map(e => e.id)).toEqual(["ex_reach", "ex_handopen"]);
    expect(unseenChanges()).toHaveLength(1);
    markChangesSeen();
    expect(unseenChanges()).toHaveLength(0);
    // Running again changes nothing and sends nothing twice.
    expect(reviewNow({ now: new Date(2026, 9, 1, 18, 20), includeSimulated: false })).toEqual([]);
    expect(loadPlanReview().outbox).toHaveLength(1);
  });

  it("reviews the day at 8pm, not before, and the change applies the next day", () => {
    withPlan();
    writeSessions([session({ score: 30 })]);
    expect(reviewNow({ now: new Date(2026, 9, 1, 19, 59), includeSimulated: false })).toEqual([]);
    const changes = reviewNow({ now: new Date(2026, 9, 1, 20, 1), includeSimulated: false });
    expect(changes).toEqual([expect.objectContaining({ kind: "easier", reviewedDay: "2026-10-01", effectiveDay: "2026-10-02", reasons: ["low_score"] })]);
    expect(loadPlanReview().outbox.map(item => item.alert.kind)).toEqual(["plan_changes"]);
    expect(loadPlanReview().reviewedThrough).toBe("2026-10-01");
  });

  it("catches up on missed days the next time the app opens", () => {
    withPlan();
    savePlanReview({ ...emptyPlanReview(), assessmentId: "a1", reviewedThrough: "2026-09-29" });
    writeSessions([
      session({ finished_at: new Date(2026, 8, 30, 10, 0).toISOString() }),
      session({ finished_at: new Date(2026, 9, 1, 10, 0).toISOString(), score: 90 }),
    ]);
    const changes = reviewNow({ now: new Date(2026, 9, 2, 9, 0), includeSimulated: false });
    expect(changes).toEqual([expect.objectContaining({ kind: "harder", reviewedDay: "2026-10-01", effectiveDay: "2026-10-02", fromLevel: 2, toLevel: 3 })]);
  });

  it("starts afresh with a new movement check's plan", () => {
    withPlan();
    savePlanReview({ ...emptyPlanReview(), assessmentId: "old", states: { ex_handopen: { level: 1, restingThrough: null } } });
    reviewNow({ now: new Date(2026, 9, 1, 9, 0), includeSimulated: false });
    expect(loadPlanReview()).toMatchObject({ assessmentId: "a1", states: {} });
  });

  it("counts simulated sessions only when asked, and falls back to the day's score", () => {
    const attempts = attemptsFrom([session({ sim: true }) as never], { "2026-09-28": { ex_handopen: { score: 40, at: "x" } } }, false);
    expect(attempts).toEqual([{ exerciseId: "ex_handopen", day: "2026-09-28", level: null, score: 40, repsPlanned: null, repsDone: null, eased: false }]);
    expect(planItems(withPlan())).toEqual([
      // The everyday exercise comes first, at level 1, and never changes level.
      { id: "ex_reach", name: expect.any(String), baseLevel: 1, fixedLevel: true },
      { id: "ex_handopen", name: expect.any(String), baseLevel: 2, fixedLevel: false },
    ]);
  });

  it("keeps admin emails queued until the server confirms them", async () => {
    withPlan();
    writeReports([report({ stopped: true, at: new Date(2026, 9, 1, 18, 5).toISOString() })]);
    reviewNow({ now: new Date(2026, 9, 1, 18, 10), includeSimulated: false });
    const later = new Date(2026, 9, 1, 18, 30);
    const notReady: AlertSender = vi.fn(async () => "not_configured" as const);
    await flushAlerts({ send: notReady, now: later, force: true });
    expect(loadPlanReview().outbox).toEqual([expect.objectContaining({ tries: 1, lastError: "not_configured" })]);
    const sent: AlertSender = vi.fn(async () => "sent" as const);
    await flushAlerts({ send: sent, now: later, force: true });
    expect(sent).toHaveBeenCalledWith(expect.objectContaining({ kind: "warning", patient: "Zak" }));
    expect(loadPlanReview().outbox).toEqual([]);
  });

  it("shows the changes on the Journey: rest days, today's level and Alira's note", () => {
    const assessment = withPlan();
    const { assessments } = ensureJourneyRecords(assessment);
    const start = new Date(2026, 9, 1, 9, 0);
    const yesterday: PlanChange[] = [
      { id: "1", at, version: "v", reviewedDay: "2026-10-01", effectiveDay: "2026-10-02", exerciseId: "ex_handopen", exerciseName: "Active Hand Opening", kind: "easier", fromLevel: 2, toLevel: 1, restingThrough: null, reasons: ["felt_much_harder"], warning: false },
      { id: "2", at, version: "v", reviewedDay: "2026-10-01", effectiveDay: "2026-10-01", exerciseId: "ex_reach", exerciseName: "Graded Forward Reach", kind: "rest", fromLevel: 1, toLevel: 1, restingThrough: "2026-10-02", reasons: ["pain_a_lot"], warning: true },
    ];
    const planReview = { ...emptyPlanReview(), assessmentId: "a1", states: { ex_handopen: { level: 1 as const, restingThrough: null }, ex_reach: { level: 1 as const, restingThrough: "2026-10-02" } }, changes: yesterday };
    const model = buildJourney({ assessment, start, assessments, store: {}, now: new Date(2026, 9, 2, 9, 0), range: "all", planReview });
    const rows = Object.fromEntries(model.planRows.map(row => [row.exercise.id, row]));
    expect(rows.ex_handopen).toMatchObject({ rung: 1, resting: false, levelChange: "easier" });
    expect(rows.ex_reach).toMatchObject({ resting: true });
    expect(model.nextExercise?.id).toBe("ex_handopen");
    expect(model.alira.changesLead).toBe("Zak, I've adjusted today's plan:");
    expect(model.alira.changes).toEqual([
      "Active Hand Opening is one level easier, because it felt much harder yesterday.",
      "Graded Forward Reach is resting today, after the pain you mentioned yesterday.",
    ]);
    const withoutReview = buildJourney({ assessment, start, assessments, store: {}, now: new Date(2026, 9, 2, 9, 0), range: "all" });
    expect(withoutReview.planRows.map(row => row.resting)).toEqual([false, false]);
    expect(withoutReview.alira.changes).toBeUndefined();
    const restDay = buildJourney({ assessment, start, assessments, store: {}, now: new Date(2026, 9, 2, 9, 0), range: "all", planReview: { ...planReview, planRestingThrough: "2026-10-02" } });
    expect(restDay.planTitle).toBe("Today is a rest day");
    expect(restDay.nextExercise).toBeNull();
  });

  it("reviews a day again when results arrive after its evening review", () => {
    withPlan();
    // Reviewed at 8.30pm with nothing done; then a hard session at 9pm.
    expect(reviewNow({ now: new Date(2026, 9, 1, 20, 30), includeSimulated: false })).toEqual([]);
    writeSessions([session({ score: 30, finished_at: new Date(2026, 9, 1, 21, 0).toISOString() })]);
    const late = reviewNow({ now: new Date(2026, 9, 1, 21, 5), includeSimulated: false });
    expect(late).toEqual([expect.objectContaining({ kind: "easier", reviewedDay: "2026-10-01", effectiveDay: "2026-10-02" })]);
    // A better session later still only allows one step for the day, decided from all of it.
    writeSessions([session({ score: 30, finished_at: new Date(2026, 9, 1, 21, 0).toISOString() }), session({ score: 90, finished_at: new Date(2026, 9, 1, 21, 30).toISOString() })]);
    expect(reviewNow({ now: new Date(2026, 9, 1, 21, 35), includeSimulated: false })).toEqual([]);
    expect(loadPlanReview().states.ex_handopen.level).toBe(2);
    expect(loadPlanReview().changes.filter(change => change.reviewedDay === "2026-10-01")).toEqual([]);
    expect(loadPlanReview().outbox).toEqual([]);
  });

  it("treats the local Next day control as a real new day, with test emails and the note the day after", () => {
    vi.stubEnv("DEV", true);
    const assessment = withPlan();
    const { assessments } = ensureJourneyRecords(assessment);
    values.set("rehyn.journey.demo", JSON.stringify({ dayOffset: 0 }));
    reviewNow({ now: new Date(2026, 9, 1, 10, 0), includeSimulated: false });
    // The testing strip records only the day's scores.
    values.set("rehyn.journey.sessions", JSON.stringify({ "2026-10-01": { ex_handopen: { score: 40, at: "x" } } }));
    const listener = vi.fn();
    const dispatch = vi.fn((event: Event) => { listener(event.type); return true; });
    vi.stubGlobal("window", { localStorage: globalThis.localStorage, dispatchEvent: dispatch });
    setDemoDayOffset(1);
    expect(listener).toHaveBeenCalledWith(JOURNEY_CLOCK_EVENT);
    const changes = reviewNow({ now: new Date(2026, 9, 1, 10, 5), includeSimulated: false });
    expect(changes).toEqual([expect.objectContaining({ kind: "easier", reviewedDay: "2026-10-01", effectiveDay: "2026-10-02" })]);
    expect(loadPlanReview().outbox[0].alert).toMatchObject({ kind: "plan_changes", test: true });
    const model = buildJourney({ assessment, start: new Date(2026, 9, 1, 9, 0), assessments, store: {}, now: new Date(2026, 9, 2, 10, 5), range: "all", planReview: loadPlanReview() });
    expect(model.alira.changes).toEqual(["Active Hand Opening is one level easier, because yesterday was hard going."]);
    // Two good days on the strip make it harder again.
    values.set("rehyn.journey.sessions", JSON.stringify({
      "2026-10-01": { ex_handopen: { score: 40, at: "x" } }, "2026-10-02": { ex_handopen: { score: 88, at: "x" } }, "2026-10-03": { ex_handopen: { score: 91, at: "x" } },
    }));
    setDemoDayOffset(3);
    expect(reviewNow({ now: new Date(2026, 9, 1, 10, 10), includeSimulated: false })).toEqual([expect.objectContaining({ kind: "harder", reviewedDay: "2026-10-03", fromLevel: 1, toLevel: 2 })]);
    // Reset starts the review again.
    clearJourneyRecords();
    expect(loadPlanReview()).toEqual(emptyPlanReview());
    vi.unstubAllEnvs();
  });

  it("says whether each change's admin email went out", async () => {
    withPlan();
    writeReports([report({ pain: "a_lot", at: new Date(2026, 9, 1, 18, 5).toISOString() })]);
    const [rest] = reviewNow({ now: new Date(2026, 9, 1, 18, 10), includeSimulated: false });
    expect(emailStatus(rest)).toBe("waiting");
    await flushAlerts({ send: async () => "sent", now: new Date(2026, 9, 1, 18, 30), force: true });
    expect(emailStatus(rest)).toBe("sent");
    expect(loadPlanReview().emailed).toEqual(["warning:2026-10-01:ex_handopen:rest"]);
  });

  it("survives a damaged store", () => {
    values.set(PLAN_REVIEW_KEY, "{not json");
    expect(loadPlanReview()).toEqual(emptyPlanReview());
    values.set(PLAN_REVIEW_KEY, JSON.stringify({ v: 1, states: { x: { level: 9 } }, changes: [{ id: 1 }], outbox: [{ alert: { id: "a" } }] }));
    expect(loadPlanReview()).toMatchObject({ states: { x: { level: 3, restingThrough: null } }, changes: [], outbox: [] });
  });
});
