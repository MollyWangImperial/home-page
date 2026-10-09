import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_CONSENT } from "@shared/alira-adaptation";
import { buildSnapshot } from "../alira-learning-store";
import { ASSESSMENT_RESULT_KEY, loadRememberedAssessment, rememberAssessment, type AssessmentReport } from "../assessment";
import { assessmentCompletionMessages, requestAssessmentPlan, scoreSummary } from "../assessment-plan";
import { EVERYDAY_EXERCISE_ID, EXERCISES } from "../exercise-engine/config";
import { assessmentScores, companionPlan, hasAssessmentScores, journeyExercises } from "../journey";
import type { NativeFunctionScore } from "./function-score";
import { buildNativeReport, type NativeReportInput } from "./report";
import { CAMERA_TASKS } from "./tasks";
import type { AssessmentTaskResult, AttemptRecord, CameraTaskId, CompStatus, GaitResult } from "./types";

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

const ids = (taskId: CameraTaskId) => CAMERA_TASKS[taskId].levels.map(level => level.id);
const clean = (taskId: CameraTaskId): Record<string, CompStatus> => Object.fromEntries(CAMERA_TASKS[taskId].compensations.map(rule => [rule.id, "not_detected"]));
const attempt = (taskId: CameraTaskId, levelId: string, completed: boolean, over: Partial<AttemptRecord> = {}): AttemptRecord => ({
  level: ids(taskId).indexOf(levelId), levelId, assist: null, completed, touched: completed, peakProgress: completed ? 1 : 0.5,
  compensations: clean(taskId), durationMs: 4200.4, ...over,
});
const result = (taskId: CameraTaskId, attempts: AttemptRecord[], over: Partial<AssessmentTaskResult> = {}): AssessmentTaskResult => ({
  taskId, exerciseId: CAMERA_TASKS[taskId].exerciseId, levelIds: ids(taskId), startLevel: ids(taskId).length - 1,
  tryOut: { completed: true, peakProgress: 1 }, attempts, movementSeen: attempts.some(item => item.peakProgress >= 0.3),
  stoppedBy: "top_reached", measured: true, side: "right", insights: {}, ...over,
});
const walking: GaitResult = {
  status: "scored", score: 66.4, areaScore: 66.4, assist: "none",
  metrics: { speedLegPerS: 0.82, speedMpsEstimate: 0.697, cadence: 92, stepLengthSymmetry: 0.86, stepTimeSymmetry: 0.9, steps: 14, passes: 2, seenShare: 0.92, sideOnRatio: 0.31 },
  components: { speed: 44.8, cadence: 76.4, step_length_symmetry: 81.25, step_time_symmetry: 93.75 },
};
const NOW = new Date("2026-10-09T10:00:00Z");

/** Reach held overhead; hand to mouth held at the chest only; hand opening only moved; pinch then skipped by the page. */
function input(over: Partial<NativeReportInput> = {}): NativeReportInput {
  return {
    results: [
      result("T1", [attempt("T1", "r160", true)], { insights: { shoulder_flexion: 132.5 } }),
      result("T3", [attempt("T3", "mouth", false), attempt("T3", "chest", true)], { stoppedBy: "reversal" }),
      result("H4", [attempt("H4", "full", false), attempt("H4", "partial", false)], { stoppedBy: "help_declined", startLevel: 1 }),
    ],
    walking, answers: { arm_hand_movement: "fairly_well", main_goal: "eating" },
    // As the page does when hand opening ran and was never held alone: pinch is never run.
    assignedTaskIds: ["T1", "T3", "H4", "H3", "L6"], skipped: ["H3"], simulated: false, now: NOW, ...over,
  };
}
const fs = (report: AssessmentReport) => report.metrics!.function_score as NativeFunctionScore;
const taskRow = (report: AssessmentReport, id: string) => report.task_results!.find(row => row.task_id === id)!;
const ladderOf = (report: AssessmentReport, id: string) => (taskRow(report, id).metrics as Record<string, Record<string, unknown>>).ladder;

describe("the native report", () => {
  it("is a completed initial check with its own id, not a preview and not a test", () => {
    const report = buildNativeReport(input());
    expect(report).toMatchObject({ id: `native-${NOW.getTime()}`, assessment_package: "initial", preview_only: false, testing_random: false });
    expect(report.clinical_review_gate?.rehab_access).toBe("allowed");
  });

  it("scores every task and keeps the unrounded means beside their displays", () => {
    const score = fs(buildNativeReport(input()));
    expect(score.tasks.map(task => [task.task_id, task.level, task.points, task.label])).toEqual([
      ["T1", 4, 100, "Can do well"], ["T3", 2, 50, "Partly"], ["H4", 1, 25, "Getting started"],
      ["H3", 0, 0, "Not yet: comes after hand opening"], ["L6", null, 66.4, "Walking score"],
    ]);
    expect(score.areas.upper_limb).toMatchObject({ score: 75, display_score: 75 });
    expect(score.areas.hand).toMatchObject({ score: 12.5, display_score: 13 });
    expect(score.areas.lower_limb).toMatchObject({ score: 66.4, display_score: 66 });
    expect(score.total).toBeCloseTo((75 + 12.5 + 66.4) / 3, 10);
    expect(score.display_total).toBe(51);
  });

  it("stores each camera task's ladder in the backend's rehyn-ladder-1 shape", () => {
    const report = buildNativeReport(input());
    expect(ladderOf(report, "T1")).toMatchObject({
      version: "rehyn-ladder-1", task_id: "T1", rungs: ["r80", "r120", "r160"], full_rung: "r160", start_rung: "r160",
      attempts: [{ rung: "r160", assist: null, completed: true, touched: true, peak_progress: 1, duration_ms: 4200, compensations: clean("T1") }],
      best_alone: "r160", best_assisted: null, measured: true, movement_seen: true, stopped_by: "top_reached", prerequisite_not_met: false,
    });
    expect(ladderOf(report, "T3")).toMatchObject({ start_rung: "mouth", best_alone: "chest", stopped_by: "reversal", attempts: [{ rung: "mouth", completed: false }, { rung: "chest", completed: true }] });
    expect(ladderOf(report, "H4")).toMatchObject({ full_rung: "full", start_rung: "full", best_alone: null, movement_seen: true, stopped_by: "help_declined" });
    expect(ladderOf(report, "H3")).toMatchObject({ prerequisite_not_met: true, stopped_by: "skipped", measured: false, attempts: [] });
    expect(taskRow(report, "T1")).toMatchObject({ duration_ms: 4200, metrics: { measured: true, side: "right", insights: { shoulder_flexion: 132.5 } } });
  });

  it("keeps an assisted attempt's explicit help in the ladder", () => {
    const report = buildNativeReport(input({ results: [result("T1", [attempt("T1", "r80", false), attempt("T1", "r80", true, { assist: "helper" })], { stoppedBy: "lowest_failed", startLevel: 0 })], assignedTaskIds: ["T1"], walking: null }));
    expect(ladderOf(report, "T1")).toMatchObject({ start_rung: "r80", best_alone: null, best_assisted: "r80", attempts: [{ assist: null }, { assist: "helper", completed: true }] });
    expect(fs(report).tasks[0]).toMatchObject({ level: 1, assisted: true });
  });

  it("stores walking's analysis as metrics.gait", () => {
    const row = taskRow(buildNativeReport(input()), "L6");
    expect(row.metrics).toMatchObject({ walking_skipped: false, measured: true, gait: { version: "rehyn-native-gait-1", status: "scored", score: 66.4, areaScore: 66.4, assist: "none", metrics: { cadence: 92 }, components: { speed: 44.8 } } });
    const notMeasured = buildNativeReport(input({ walking: { status: "not_measured", reason: "I saw too few steps. Walk a little further across the picture.", assist: "none" } }));
    expect(taskRow(notMeasured, "L6").metrics).toMatchObject({ measured: false, gait: { status: "not_measured", reason: "I saw too few steps. Walk a little further across the picture." } });
    expect(fs(notMeasured).tasks[4]).toMatchObject({ points: null, label: "Not measured" });
    expect(fs(notMeasured).areas.lower_limb.display_score).toBeNull();
  });

  it("walking skipped is Not assessed; walking not offered (wheelchair) has no row and no area", () => {
    const skipped = buildNativeReport(input({ walking: null, skipped: ["H3", "L6"] }));
    expect(fs(skipped).tasks[4]).toMatchObject({ task_id: "L6", points: null, label: "Not assessed" });
    expect(taskRow(skipped, "L6").metrics).toMatchObject({ walking_skipped: true, gait: { status: "skipped" } });
    // The page passes the skip as walking's own result: the same row, and no leg exercises.
    const asResult = buildNativeReport(input({ walking: { status: "skipped", reason: "Skipped" }, skipped: ["H3", "L6"] }));
    expect(fs(asResult).tasks[4]).toMatchObject({ task_id: "L6", points: null, label: "Not assessed", reason: "walking_skipped" });
    expect(taskRow(asResult, "L6").metrics).toEqual(taskRow(skipped, "L6").metrics);
    expect(asResult.rehab_plan!.map(exercise => exercise.id)).not.toContain("ex_lower_selective");
    const seated = buildNativeReport(input({ walking: null, assignedTaskIds: ["T1", "T3", "H4", "H3"] }));
    expect(seated.task_results!.map(row => row.task_id)).toEqual(["T1", "T3", "H4", "H3"]);
    expect(Object.keys(fs(seated).areas)).toEqual(["upper_limb", "hand"]);
  });

  it("pinch skipped by the page after hand opening was never held alone is level 0", () => {
    const report = buildNativeReport(input({ results: input().results.slice(0, 3), skipped: ["H3"] }));
    expect(fs(report).tasks[3]).toMatchObject({ task_id: "H3", level: 0, points: 0, label: "Not yet: comes after hand opening" });
    expect(ladderOf(report, "H3")).toMatchObject({ prerequisite_not_met: true, stopped_by: "skipped", start_rung: "full", attempts: [] });
  });

  it("a pinch skipped inside the runner keeps the level it held, never 'comes after hand opening', and no carer hand domain", () => {
    const opened = [...input().results.slice(0, 2), result("H4", [attempt("H4", "full", true)])];
    const report = buildNativeReport(input({ results: [...opened, result("H3", [attempt("H3", "partial", true)], { stoppedBy: "skipped" })], skipped: [] }));
    expect(fs(report).tasks[3]).toMatchObject({ task_id: "H3", level: 2, points: 50, label: "Partly" });
    expect(fs(report).areas.hand).toMatchObject({ score: 75, display_score: 75 });
    expect(ladderOf(report, "H3")).toMatchObject({ prerequisite_not_met: false, stopped_by: "skipped", measured: true, best_alone: "partial" });
    expect(report.function_rehab_plan?.caregiver_domains).not.toContain("hand");
    // Skipped before any attempt: Not assessed, left out of the hand area rather than counted as 0.
    const early = buildNativeReport(input({ results: [...opened, result("H3", [], { stoppedBy: "skipped", measured: false, movementSeen: false })], skipped: [] }));
    expect(fs(early).tasks[3]).toMatchObject({ task_id: "H3", level: null, points: null, label: "Not assessed" });
    expect(fs(early).areas.hand).toMatchObject({ score: 100, partial: true });
    expect(ladderOf(early, "H3")).toMatchObject({ prerequisite_not_met: false, stopped_by: "skipped", measured: false, attempts: [] });
  });

  it("hand opening skipped inside the runner after holding a level keeps it", () => {
    const report = buildNativeReport(input({ results: [...input().results.slice(0, 2), result("H4", [attempt("H4", "partial", true), attempt("H4", "full", false)], { stoppedBy: "skipped" })], skipped: [] }));
    expect(fs(report).tasks[2]).toMatchObject({ task_id: "H4", level: 2, points: 50, label: "Partly" });
    expect(ladderOf(report, "H4")).toMatchObject({ best_alone: "partial", stopped_by: "skipped", prerequisite_not_met: false });
  });

  it("a task the patient skipped is Not assessed; an assigned task that never ran is Not measured", () => {
    const report = buildNativeReport(input({
      results: [result("H4", [attempt("H4", "partial", true)])], skipped: ["T1", "H3"], answers: { arm_hand_movement: "little_help" },
    }));
    const score = fs(report);
    expect(score.tasks.map(task => [task.task_id, task.points, task.label])).toEqual([
      ["T1", null, "Not assessed"], ["T3", null, "Not measured"], ["H4", 50, "Partly"], ["H3", null, "Not assessed"], ["L6", 66.4, "Walking score"],
    ]);
    // Never a made-up score: the arm area has nothing measured.
    expect(score.areas.upper_limb.display_score).toBeNull();
    expect(ladderOf(report, "T1")).toMatchObject({ stopped_by: "skipped", start_rung: "r80", measured: false, prerequisite_not_met: false });
    expect(ladderOf(report, "T3")).toMatchObject({ stopped_by: "not_measured", start_rung: "chest" });
    expect(taskRow(report, "T3").metrics).toMatchObject({ skipped: false });
  });

  it("reports a task that ran without being assigned, after the assigned ones", () => {
    const report = buildNativeReport(input({ assignedTaskIds: ["T3"], walking: null, results: [result("T1", [attempt("T1", "r160", true)]), result("T3", [attempt("T3", "mouth", true)])] }));
    expect(fs(report).tasks.map(task => task.task_id)).toEqual(["T3", "T1"]);
  });

  it("builds the plan from the levels, the goal and walking", () => {
    const report = buildNativeReport(input());
    // Lowest: H3 (0) and H4 (1) → carer-supported hand; goal (eating) T3 → hand to mouth; success T1 (4) → grasp; walking 66.
    expect(report.rehab_plan!.map(exercise => exercise.id)).toEqual(["ex_h2m", "ex_grasp", "ex_lower_selective", "ex_ankle_dorsiflexion"]);
    expect(report.function_rehab_plan).toEqual({ caregiver_domains: ["hand"], candidate_only: false });
  });

  it("marks a simulated check as a test, so Alira never shows its marks", () => {
    const report = buildNativeReport(input({ simulated: true }));
    expect(report.testing_random).toBe(true);
    expect(assessmentCompletionMessages(report).marks).toBeNull();
    expect(assessmentCompletionMessages(buildNativeReport(input())).marks).toBe("Your marks today: Arm 75/100 · Hand 13/100 · Walking 66/100.");
  });
});

describe("storing the native report", () => {
  it("round-trips through rememberAssessment and loadRememberedAssessment", () => {
    const report = buildNativeReport(input());
    const stored = rememberAssessment(report);
    expect(stored?.id).toBe(report.id);
    expect(values.has(ASSESSMENT_RESULT_KEY)).toBe(true);
    const loaded = loadRememberedAssessment()!;
    expect(loaded).toMatchObject({ id: report.id, package: "initial", planChatCompleted: false });
    expect(loaded.report?.metrics?.function_score).toEqual(JSON.parse(JSON.stringify(report.metrics!.function_score)));
    expect(loaded.report?.testing_random).toBe(false);
    expect(loaded.report?.task_results?.map(row => row.task_id)).toEqual(["T1", "T3", "H4", "H3", "L6"]);
    expect(ladderOf(loaded.report!, "T1")).toEqual(JSON.parse(JSON.stringify(ladderOf(report, "T1"))));
    expect((taskRow(loaded.report!, "L6").metrics as Record<string, unknown>).gait).toMatchObject({ status: "scored", score: 66.4 });
    // The storage code puts the everyday reach first.
    expect(loaded.report?.rehab_plan?.map(exercise => exercise.id)).toEqual([EVERYDAY_EXERCISE_ID, "ex_h2m", "ex_grasp", "ex_lower_selective", "ex_ankle_dorsiflexion"]);
    expect(loaded.report?.function_rehab_plan?.caregiver_domains).toEqual(["hand"]);
  });

  it("Journey and the plan conversation read the right numbers", () => {
    rememberAssessment(buildNativeReport(input()));
    const loaded = loadRememberedAssessment()!;
    expect(assessmentScores(loaded)).toEqual({ upper_limb: 75, hand: 13, lower_limb: 66 });
    expect(hasAssessmentScores(loaded)).toBe(true);
    expect(scoreSummary(loaded.report!)).toBe("Arm 75/100 · Hand 13/100 · Walking 66/100");
    const exercises = journeyExercises(loaded);
    expect(exercises.map(exercise => [exercise.id, exercise.name, exercise.area, exercise.dose])).toEqual([
      ["ex_reach", EXERCISES.ex_reach.name, "upper_limb", "1 set × 6"],
      ["ex_h2m", EXERCISES.ex_h2m.name, "upper_limb", "1 set × 6"],
      ["ex_grasp", EXERCISES.ex_grasp.name, "hand", "1 set × 6"],
      ["ex_lower_selective", EXERCISES.ex_lower_selective.name, "lower_limb", "1 set × 6"],
      ["ex_ankle_dorsiflexion", EXERCISES.ex_ankle_dorsiflexion.name, "lower_limb", "1 set × 6"],
    ]);
    expect(companionPlan(loaded)).toHaveLength(5);
  });

  it("requestAssessmentPlan returns the stored plan without asking the assessment service", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    rememberAssessment(buildNativeReport(input()));
    const loaded = loadRememberedAssessment()!;
    const planned = await requestAssessmentPlan(loaded, { main_goal: "eating" });
    expect(planned).toBe(loaded.report);
    expect(planned.rehab_plan?.length).toBe(5);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Alira's learning reads each task's level, best level held alone and why the ladder stopped", () => {
    rememberAssessment(buildNativeReport(input()));
    const snapshot = buildSnapshot({ ...NO_CONSENT, movement: true });
    const assessment = snapshot.movement?.assessment;
    expect(assessment).toMatchObject({ testing: false, total: 51, areas: { upper_limb: 75, hand: 13, lower_limb: 66 } });
    expect(assessment?.tasks.map(task => [task.taskId, task.level, task.points, task.bestAlone, task.stoppedBy])).toEqual([
      ["T1", 4, 100, "r160", "top_reached"], ["T3", 2, 50, "chest", "reversal"], ["H4", 1, 25, null, "help_declined"],
      ["H3", 0, 0, null, "skipped"], ["L6", null, 66.4, null, null],
    ]);
    expect(assessment?.tasks[0]).toMatchObject({ label: "Reach", reason: "full_rung_alone_clean", compensations: clean("T1") });
    expect(assessment?.tasks[3].reason).toBe("prerequisite_not_met");
  });
});
