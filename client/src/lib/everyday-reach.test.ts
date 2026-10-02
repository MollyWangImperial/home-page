import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_EXERCISE_TUNING, exerciseTuning } from "@shared/alira-adaptation";
import { reviewDay, warningChanges } from "@shared/plan-review";
import { withEverydayExercise, type StoredAssessment } from "./assessment";
import { buildJourney, companionPlan, journeyExercises, launchablePlan } from "./journey";
import { planItems } from "./plan-review";
import { adjustedLevel, emptyPlanReview } from "./plan-review-store";
import { EXERCISES } from "./exercise-engine/config";
import { ExerciseSession } from "./exercise-engine/session";
import { bestLine } from "./exercise-engine/spoken";
import { aliraSpokenLines } from "./alira-spoken-lines";
import { aliraVoiceKey } from "../../../server/alira-voice";
import { ALIRA_VOICE } from "@shared/alira-voice";

const hand = { id: "ex_handopen", name: "Active Hand Opening", description: "Open your hand.", sets: 2, reps: 8, frequency: "Daily", difficulty: "medium" };
const assessment: StoredAssessment = { id: "daily-reach", completedAt: "2026-10-02T09:00:00Z", planChatCompleted: true, report: { rehab_plan: [hand] } };
afterEach(() => vi.unstubAllGlobals());

describe("the fixed everyday forward reach", () => {
  it("is first even in an in-memory plan without a reach, with the other exercise unchanged", () => {
    const plan = companionPlan(assessment);
    expect(plan.map(item => item.id)).toEqual(["ex_reach", "ex_handopen"]);
    expect(plan[0]).toMatchObject({ difficulty: "easy", sets: 1, reps: 6, frequency: "Daily", target_rung: null });
    expect(plan[1]).toBe(hand);
    expect(assessment.report?.rehab_plan).toEqual([hand]);
    const model = buildJourney({ assessment, start: new Date(assessment.completedAt), assessments: [], store: {}, now: new Date(assessment.completedAt), range: "all" });
    expect(model.nextExercise?.id).toBe("ex_reach");
    expect(model.planRows[0].rung).toBe(1);
  });

  it("normalizes old reach doses and duplicate entries, retaining the rest of the plan", () => {
    const reach = { ...hand, id: "ex_reach", difficulty: "hard", sets: 3, reps: 10, frequency: "Weekly", target_rung: "high" };
    const plan = withEverydayExercise([hand, reach, reach]);
    expect(plan.map(item => item.id)).toEqual(["ex_reach", "ex_handopen"]);
    expect(plan[0]).toMatchObject({ difficulty: "easy", sets: 1, reps: 6, frequency: "Daily", target_rung: null });
  });

  it("ignores old reviewed levels and learned tuning while other exercises still adapt", () => {
    const state = { ...emptyPlanReview(), assessmentId: assessment.id, states: { ex_reach: { level: 3 as const, restingThrough: null }, ex_handopen: { level: 3 as const, restingThrough: null } } };
    expect(adjustedLevel("ex_reach", 3, assessment.id, state)).toBe(1);
    expect(adjustedLevel("ex_handopen", 2, assessment.id, state)).toBe(3);
    const tuning = exerciseTuning({ "exercise.hold_seconds": 0.8, "exercise.reps_scale": 0.5, "exercise.target_size_scale": 1.3, "exercise.one_compensation_points": 60 });
    const voice = { say: vi.fn(), busy: () => false, stop: vi.fn() };
    const reach = new ExerciseSession({ exerciseId: "ex_reach", rung: 3, side: "left", tuning }, voice);
    expect(reach.snapshot()).toMatchObject({ rung: 1, rungStart: 1, repsPlanned: 6 });
    expect(reach.tuning).toEqual(DEFAULT_EXERCISE_TUNING);
    const other = new ExerciseSession({ exerciseId: "ex_handopen", rung: 2, side: "left", tuning }, voice);
    expect(other.tuning).toEqual(tuning);
    expect(other.snapshot().repsPlanned).toBe(4);
  });

  it("keeps reach out of Alira's daily adjustments while preserving warning rests", () => {
    const plan = planItems(assessment);
    const at = "2026-10-02T19:00:00Z";
    const attempts = plan.map(item => ({ exerciseId: item.id, day: "2026-10-02", level: item.baseLevel, score: 20, repsPlanned: 6, repsDone: 6, eased: false }));
    const changes = reviewDay({ day: "2026-10-02", plan, states: {}, attempts, reports: [], at });
    expect(changes.map(change => change.exerciseId)).toEqual(["ex_handopen"]);
    expect(changes[0].kind).toBe("easier");
    const rests = warningChanges({ reports: [{ day: "2026-10-02", at, source: "exercise", exerciseId: "ex_reach", pain: "a_lot" }], plan, states: {}, planRestingThrough: null, at });
    expect(rests[0]).toMatchObject({ exerciseId: "ex_reach", kind: "rest", toLevel: 1, restingThrough: "2026-10-03" });
  });

  it("makes reach available in candidate and empty prepared plans without inventing an unprepared plan", () => {
    const gate = { rehab_access: "blocked", patient_message: "Sitting support needs have not yet been confirmed." };
    const candidate = { ...assessment, report: { rehab_plan: [hand], clinical_review_gate: gate } };
    expect(companionPlan(candidate).map(item => item.id)).toEqual(["ex_reach", "ex_handopen"]);
    expect(launchablePlan(candidate).map(item => item.id)).toEqual(["ex_reach"]);
    expect(journeyExercises(candidate).map(item => item.launchable)).toEqual([true, false]);
    expect(candidate.report.clinical_review_gate).toBe(gate);
    expect(withEverydayExercise([], gate)[0]).toMatchObject({ id: "ex_reach", difficulty: "easy", reps: 6 });
    expect(companionPlan(null)).toEqual([]);
    expect(journeyExercises({ ...assessment, report: {} })).toEqual([]);
    const model = buildJourney({ assessment: candidate, start: new Date(assessment.completedAt), assessments: [], store: { "2026-10-02": { ex_reach: { score: 80, at: assessment.completedAt } } }, now: new Date(assessment.completedAt), range: "all" });
    expect(model.doneToday).toBe(true);
    expect(model.nextExercise).toBeNull();
    expect(planItems(candidate).map(item => item.id)).toEqual(["ex_reach", "ex_handopen"]);
  });

  it("has reusable Alira clips for all reach instructions, corrections, scores and best-angle results", () => {
    const lines = Object.entries(aliraSpokenLines).filter(([id]) => id.startsWith("reach-")).map(([, text]) => text);
    for (let degrees = 0; degrees <= 180; degrees++) expect(lines).toContain(bestLine(EXERCISES.ex_reach.bestLabel, degrees));
    const missing = lines.filter(text => {
      const file = path.join(process.cwd(), "server/voice-pack", `${aliraVoiceKey(ALIRA_VOICE, text)}.mp3`);
      return !existsSync(file) || readFileSync(file).length < 100;
    });
    expect(missing).toEqual([]);
  });
});
