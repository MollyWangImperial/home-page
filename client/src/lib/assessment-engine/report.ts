// The native movement check's report (pure): the function score, one task row per task with its ladder evidence in
// the backend's rehyn-ladder-1 shape (Alira's learning reads stopped_by from it and best_alone from the score), the
// walking analysis, and the exercise plan. Stored with rememberAssessment like the camera runner's report, so Journey,
// Alira and the plan conversation read it without asking the assessment service.

import type { OnboardingAnswers } from "../alira-onboarding";
import type { AssessmentReport } from "../assessment";
import { buildFunctionScore, notRunTaskScore, taskScore, walkingScore, type ScoredTask } from "./function-score";
import { planSelection } from "./plan";
import { CAMERA_TASKS, startLevel } from "./tasks";
import type { AssessmentTaskId, AssessmentTaskResult, CameraTaskId, GaitResult, StopReason } from "./types";

export const LADDER_VERSION = "rehyn-ladder-1";
export const GAIT_VERSION = "rehyn-native-gait-1";

export type NativeReportInput = {
  results: AssessmentTaskResult[];
  walking: GaitResult | null;
  answers: OnboardingAnswers;
  /** The tasks this check asked for, in order (walking included when it was offered). */
  assignedTaskIds: AssessmentTaskId[];
  /** Tasks the patient skipped, or the page skipped (pinch after hand opening); a run task keeps its own result. */
  skipped: AssessmentTaskId[];
  /** Admin/dev simulated patient: the report is marked as a test (testing_random), never real marks. */
  simulated: boolean;
  now: Date;
};

const isCamera = (id: AssessmentTaskId): id is CameraTaskId => id !== "L6";
const completedAlone = (result: AssessmentTaskResult | undefined) => !!result?.attempts?.some(attempt => attempt.completed && attempt.assist === null);

/** The ladder evidence of a task that ran, as the backend's ladder snapshot (rung ids, explicit assistance, checks). */
function ladderOf(result: AssessmentTaskResult): Record<string, unknown> {
  const rungs = CAMERA_TASKS[result.taskId].levels.map(level => level.id);
  const attempts = result.attempts ?? [];
  const best = (helped: boolean) => attempts.filter(attempt => attempt.completed && (attempt.assist !== null) === helped)
    .reduce<string | null>((top, attempt) => top === null || rungs.indexOf(attempt.levelId) > rungs.indexOf(top) ? attempt.levelId : top, null);
  return {
    version: LADDER_VERSION, clinical_measure: false, task_id: result.taskId, exercise_id: result.exerciseId,
    rungs, full_rung: rungs[rungs.length - 1], start_rung: rungs[result.startLevel] ?? rungs[rungs.length - 1],
    attempts: attempts.map(attempt => ({
      rung: attempt.levelId, assist: attempt.assist, completed: attempt.completed, touched: attempt.touched,
      peak_progress: attempt.peakProgress, duration_ms: Math.round(attempt.durationMs), compensations: { ...attempt.compensations },
    })),
    try_out: { completed: result.tryOut?.completed === true, peak_progress: result.tryOut?.peakProgress ?? 0 },
    best_alone: best(false), best_assisted: best(true),
    movement_seen: result.movementSeen || attempts.some(attempt => attempt.completed),
    // A task that ran never waited for hand opening (a skip from inside the runner is the patient's choice): only the
    // page's own pinch skip, an empty ladder, says that.
    prerequisite_not_met: false,
    measured: result.measured, stopped_by: result.stoppedBy,
  };
}

/** A camera task that did not run: an empty ladder that still says where it would have started and why it stopped. */
function emptyLadder(taskId: CameraTaskId, answers: OnboardingAnswers, stoppedBy: StopReason, prerequisite: boolean): Record<string, unknown> {
  const rungs = CAMERA_TASKS[taskId].levels.map(level => level.id);
  return {
    version: LADDER_VERSION, clinical_measure: false, task_id: taskId, exercise_id: CAMERA_TASKS[taskId].exerciseId,
    rungs, full_rung: rungs[rungs.length - 1], start_rung: rungs[startLevel(taskId, answers.arm_hand_movement)],
    attempts: [], best_alone: null, best_assisted: null, movement_seen: false, prerequisite_not_met: prerequisite,
    measured: false, stopped_by: stoppedBy,
  };
}

/** The movement check's report, ready for rememberAssessment and the results dashboard. */
export function buildNativeReport({ results, walking, answers, assignedTaskIds, skipped, simulated, now }: NativeReportInput): AssessmentReport {
  const byTask = (id: AssessmentTaskId) => results.find(result => result.taskId === id);
  // The assigned order first; a task that ran without being assigned is still reported.
  const ids: AssessmentTaskId[] = [];
  for (const id of [...assignedTaskIds, ...results.map(result => result.taskId)]) if (!ids.includes(id)) ids.push(id);
  if (walking && !ids.includes("L6")) ids.push("L6");

  const rows: ScoredTask[] = [];
  const taskResults: Record<string, unknown>[] = [];
  for (const id of ids) {
    if (!isCamera(id)) {
      const gait = walking ?? (skipped.includes("L6") ? { status: "skipped" as const, reason: "Skipped" } : null);
      rows.push(walkingScore(gait));
      taskResults.push({ task_id: "L6", metrics: {
        gait: gait ? { version: GAIT_VERSION, clinical_measure: false, ...gait } : null,
        walking_skipped: !gait || gait.status === "skipped", measured: gait?.status === "scored",
      } });
      continue;
    }
    const result = byTask(id);
    if (result) {
      rows.push(taskScore(result));
      taskResults.push({ task_id: id, duration_ms: Math.round((result.attempts ?? []).reduce((sum, attempt) => sum + (attempt.durationMs || 0), 0)),
        metrics: { ladder: ladderOf(result), measured: result.measured, side: result.side, insights: { ...result.insights } } });
      continue;
    }
    // Pinch skipped because hand opening ran but was never held alone: level 0, as the backend's gated pinch.
    const prerequisite = id === "H3" && skipped.includes("H3") && !!byTask("H4")?.measured && !completedAlone(byTask("H4"));
    const why = prerequisite ? "prerequisite" : skipped.includes(id) ? "skipped" : "missing";
    rows.push(notRunTaskScore(id, why));
    taskResults.push({ task_id: id, metrics: { ladder: emptyLadder(id, answers, why === "missing" ? "not_measured" : "skipped", prerequisite), measured: false, skipped: why !== "missing" } });
  }

  const score = buildFunctionScore(rows);
  const plan = planSelection(score, answers, walking);
  return {
    id: `native-${now.getTime()}`, assessment_package: "initial", preview_only: false, testing_random: simulated === true,
    task_results: taskResults, metrics: { function_score: score },
    rehab_plan: plan.exercises, function_rehab_plan: { caregiver_domains: plan.caregiver_domains, candidate_only: false },
    clinical_review_gate: { rehab_access: "allowed", patient_message: "Your measured movements and everyday goal guide this plan." },
  };
}
