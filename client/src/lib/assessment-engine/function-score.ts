// The movement check's daily function score from the native tasks (pure): one level per camera task from what the
// patient held on their own, walking's own continuous score, and the areas' means. A port of the Rehyn backend's
// function_scoring.py (rehyn-function-level-1) for native results: target completion is the ruler, angles are not.
// Not a clinical scale; engineering defaults, to be reviewed by a clinician.

import type { FunctionScore } from "../assessment";
import type { Domain } from "../exercise-engine/config";
import { CAMERA_TASKS, type CameraTaskSpec } from "./tasks";
import type { AssessmentTaskId, AssessmentTaskResult, AttemptRecord, CameraTaskId, CompStatus, GaitResult, NativeTaskScore } from "./types";

export const FUNCTION_SCORE_VERSION = "rehyn-function-level-1";
/** Points per level 0-4, engineering default (function_scoring.py LEVEL_POINTS). */
export const LEVEL_POINTS = [0, 25, 50, 75, 100] as const;
export const LEVEL_LABELS = ["Not yet", "Getting started", "Partly", "Can do", "Can do well"] as const;
export const NOT_MEASURED = "Not measured";
export const NOT_ASSESSED = "Not assessed";
/** Pinch waits for hand opening: level 0 without an attempt (function_scoring.py prerequisite_not_met). */
export const PREREQUISITE_LABEL = "Not yet: comes after hand opening";
export const WALKING_LABEL = "Walking score";
export const WALKING_HELPED_LABEL = "Walking score (with help)";

/** Which area each task counts toward; an area is the mean of its measured tasks. */
export const TASK_AREA: Record<AssessmentTaskId, Domain> = { T1: "upper_limb", T3: "upper_limb", H4: "hand", H3: "hand", L6: "lower_limb" };
const AREA_ORDER: Domain[] = ["upper_limb", "hand", "lower_limb"];

/** What the stored row adds for Alira's learning (alira-learning-store reads reason, best_alone, best_assisted). */
export type TaskEvidence = {
  domain: Domain;
  /** Why this level: function_scoring.py's reason codes (full_rung_alone_clean, easier_rung_alone, ...). */
  reason: string;
  measured: boolean;
  /** The hardest level id held without help / with help (the ladder's rung ids, e.g. "r120"). */
  best_alone: string | null;
  best_assisted: string | null;
  clinical_measure: false;
};
export type ScoredTask = NativeTaskScore & TaskEvidence;

export type FunctionArea = { score: number | null; display_score: number | null; partial: boolean; task_ids: AssessmentTaskId[]; clinical_measure: false };
/** FunctionScore with the unrounded means kept beside their displays, and the dashboard's task rows. */
export type NativeFunctionScore = FunctionScore & {
  version: string;
  /** Unrounded mean of the scored areas; display_total rounds it once, half up. */
  total: number | null;
  areas: Record<string, FunctionArea>;
  tasks: NativeTaskScore[];
  clinical_measure: false;
};

/** A whole number, half up, rounded once from the unrounded value; float noise is trimmed first, as Decimal(str(x)) does. */
export function roundHalfUp(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const clean = Number(value.toPrecision(12));
  return clean < 0 ? -Math.floor(-clean + 0.5) : Math.floor(clean + 0.5);
}

const mean = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** The next level as Alira says it after "Next: " (the levels' own `say` when a task has no phrase). */
const NEXT_PHRASE: Record<CameraTaskId, Record<string, string>> = {
  T1: { r80: "the circle at chest height", r120: "the circle above your shoulder", r160: "the overhead circle" },
  T3: { chest: "your hand to your chest", mouth: "your hand to your mouth" },
  H4: { partial: "opening your fingers part way", full: "opening your fingers wide" },
  H3: { partial: "your thumb close to your first finger", full: "your thumb and first finger tip to tip" },
};
/** A detected check as something to practise without (after "without "); the rule's own label otherwise. */
const COMP_ACTION: Record<string, string> = {
  trunk_lean: "leaning forward", trunk_forward: "leaning forward", shoulder_hike: "lifting your shoulder",
  head_forward: "bringing your head to your hand", other_hand: "your other hand helping", wrist_bend: "bending your wrist",
  forearm_turn: "turning your palm", mass_flexion: "curling your other fingers",
};

/** "a", "a or b", "a, b or c". */
const orList = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;

const STATUSES: CompStatus[] = ["detected", "not_detected", "not_measured"];

/** The task's approved checks for one attempt; a missing status is never clear posture (not_measured). */
function checksOf(spec: CameraTaskSpec, attempt: AttemptRecord): Record<string, CompStatus> {
  const out: Record<string, CompStatus> = {};
  for (const rule of spec.compensations) {
    const status: unknown = attempt.compensations?.[rule.id];
    out[rule.id] = STATUSES.find(known => known === status) ?? "not_measured";
  }
  return out;
}

function nextStep(spec: CameraTaskSpec, level: number | null, reason: string, checks: Record<string, CompStatus>, bestAlone: number): string {
  const phrase = (index: number) => NEXT_PHRASE[spec.taskId]?.[spec.levels[index]?.id] ?? spec.levels[index]?.say ?? "the next level";
  const top = spec.levels.length - 1;
  if (reason === "prerequisite_not_met") return "Next: hand opening first, then pinch.";
  if (reason === "task_skipped" || reason === "task_missing") return "Next: try this task at your next check-up.";
  if (level === null) return "Next: set the camera up so it sees you clearly, and try again.";
  if (level === 4) return "Next: use this movement in everyday tasks.";
  if (level === 3) {
    const actions: string[] = [];
    for (const rule of spec.compensations) {
      const action = COMP_ACTION[rule.id] ?? rule.label;
      if (checks[rule.id] === "detected" && !actions.includes(action)) actions.push(action);
    }
    return actions.length ? `Next: ${phrase(top)} without ${orList(actions)}.` : `Next: ${phrase(top)} again, with your posture clearly in view.`;
  }
  if (level === 2) return `Next: ${phrase(Math.min(top, bestAlone + 1))}.`;
  if (level === 1) return reason === "assisted_movement" ? `Next: ${phrase(0)} on your own.` : "Next: small, supported movements, a little further each time.";
  return "Next: gentle, supported movement.";
}

function row(spec: CameraTaskSpec, level: number | null, reason: string, extra: Partial<ScoredTask> = {}): ScoredTask {
  return {
    task_id: spec.taskId, task_label: spec.name, domain: TASK_AREA[spec.taskId], level,
    points: level === null ? null : LEVEL_POINTS[level], label: level === null ? NOT_MEASURED : LEVEL_LABELS[level],
    reason, measured: level !== null, best_alone: null, best_assisted: null, clinical_measure: false, ...extra,
  };
}

/**
 * One camera task's level from its completed attempts (never from a claimed summary): the full level held alone with
 * every check clear → 4; held alone with a check detected or not seen → 3; a lower level alone → 2; held with help, or
 * movement seen → 1; otherwise 0. Not measured → null. Skipped before any attempt → "Not assessed".
 */
export function taskScore(result: AssessmentTaskResult, spec: CameraTaskSpec = CAMERA_TASKS[result.taskId]): ScoredTask {
  const ids = spec.levels.map(level => level.id);
  const top = ids.length - 1;
  const attempts = Array.isArray(result.attempts) ? result.attempts : [];
  // Skipped inside the runner: not assessed only when nothing was measured; attempts made before the skip still count.
  // Never "comes after hand opening": only the page's own pinch skip says that (report.ts, from its skipped list).
  if (result.stoppedBy === "skipped" && (!result.measured || !attempts.length)) return notRunTaskScore(spec.taskId, "skipped");
  if (!result.measured || result.stoppedBy === "not_measured") return row(spec, null, "tracking_unavailable", { next_step: nextStep(spec, null, "tracking_unavailable", {}, -1) });
  // A level id the task does not have is unreadable evidence: unmeasured rather than guessed.
  if (attempts.some(attempt => !ids.includes(attempt.levelId) || typeof attempt.completed !== "boolean")) return row(spec, null, "invalid_attempt_evidence", { next_step: nextStep(spec, null, "invalid_attempt_evidence", {}, -1) });
  const index = (attempt: AttemptRecord) => ids.indexOf(attempt.levelId);
  // The first of the hardest, as Python's max() keeps on a tie.
  const hardest = (rows: AttemptRecord[]) => rows.reduce<AttemptRecord | null>((best, attempt) => !best || index(attempt) > index(best) ? attempt : best, null);
  const completed = attempts.filter(attempt => attempt.completed);
  const alone = completed.filter(attempt => attempt.assist === null);
  const assisted = completed.filter(attempt => attempt.assist !== null);
  const bestAloneAttempt = hardest(alone), bestAssistedAttempt = hardest(assisted);
  const bestAlone = bestAloneAttempt ? index(bestAloneAttempt) : -1;
  const evidence: Partial<ScoredTask> = {
    best_alone: bestAloneAttempt?.levelId ?? null, best_assisted: bestAssistedAttempt?.levelId ?? null,
    ...(bestAloneAttempt ? { best_level: spec.levels[bestAlone].label } : {}),
  };
  const finish = (level: number, reason: string, checks: Record<string, CompStatus> = {}, assistedLevel = false) =>
    row(spec, level, reason, { ...evidence, ...(Object.keys(checks).length ? { compensations: checks } : {}), assisted: assistedLevel, next_step: nextStep(spec, level, reason, checks, bestAlone) });
  const full = alone.filter(attempt => index(attempt) === top);
  if (full.length) {
    // A later clean full completion shows the higher ability; on a tie the first is kept.
    let best: { level: number; reason: string; checks: Record<string, CompStatus> } | null = null;
    for (const attempt of full) {
      const checks = checksOf(spec, attempt);
      const statuses = Object.values(checks);
      const candidate = statuses.includes("detected") ? { level: 3, reason: "full_rung_alone_compensated", checks }
        : !statuses.length || statuses.includes("not_measured") ? { level: 3, reason: "full_rung_alone_posture_unobserved", checks }
        : { level: 4, reason: "full_rung_alone_clean", checks };
      if (!best || candidate.level > best.level) best = candidate;
    }
    return finish(best!.level, best!.reason, best!.checks);
  }
  if (bestAloneAttempt) return finish(2, "easier_rung_alone", checksOf(spec, bestAloneAttempt));
  if (bestAssistedAttempt) return finish(1, "assisted_movement", checksOf(spec, bestAssistedAttempt), true);
  if (result.movementSeen) return finish(1, "movement_seen");
  return finish(0, "no_movement_seen");
}

/** A camera task that did not run: skipped by the patient ("Not assessed"), pinch waiting for hand opening, or missing. */
export function notRunTaskScore(taskId: CameraTaskId, why: "skipped" | "prerequisite" | "missing"): ScoredTask {
  const spec = CAMERA_TASKS[taskId];
  if (why === "prerequisite") return row(spec, 0, "prerequisite_not_met", { label: PREREQUISITE_LABEL, measured: true, next_step: nextStep(spec, 0, "prerequisite_not_met", {}, -1) });
  const reason = why === "skipped" ? "task_skipped" : "task_missing";
  return row(spec, null, reason, { label: why === "skipped" ? NOT_ASSESSED : NOT_MEASURED, next_step: nextStep(spec, null, reason, {}, -1) });
}

/**
 * Walking keeps its continuous gait score (never a made-up level): the walking area's score (at most 50 when someone
 * held the patient), unrounded. Skipped or no evidence → "Not assessed"; tried but not measurable → "Not measured".
 */
export function walkingScore(gait: GaitResult | null): ScoredTask {
  const base = { task_id: "L6" as const, task_label: "Walking", domain: "lower_limb" as const, level: null, best_alone: null, best_assisted: null, clinical_measure: false as const };
  if (gait?.status === "scored" && Number.isFinite(gait.areaScore) && gait.areaScore >= 0 && gait.areaScore <= 100) {
    const helped = gait.assist === "holds";
    return { ...base, points: gait.areaScore, label: helped ? WALKING_HELPED_LABEL : WALKING_LABEL, reason: "gait_score", measured: true, assisted: helped };
  }
  if (gait?.status === "scored" || gait?.status === "not_measured") {
    return { ...base, points: null, label: NOT_MEASURED, reason: "walking_not_measured", measured: false, next_step: "Next: try walking again at your next check-up." };
  }
  return { ...base, points: null, label: NOT_ASSESSED, reason: "walking_skipped", measured: false, next_step: "Next: try walking at your next check-up." };
}

/** Areas average their measured tasks, the total averages the scored areas equally; each display rounds once. */
export function buildFunctionScore(tasks: NativeTaskScore[]): NativeFunctionScore {
  const areas: Record<string, FunctionArea> = {};
  const areaScores: number[] = [];
  for (const area of AREA_ORDER) {
    const rows = tasks.filter(task => TASK_AREA[task.task_id] === area);
    if (!rows.length) continue;
    const points = rows.flatMap(task => typeof task.points === "number" && Number.isFinite(task.points) ? [task.points] : []);
    const score = mean(points);
    if (score !== null) areaScores.push(score);
    areas[area] = { score, display_score: roundHalfUp(score), partial: points.length < rows.length, task_ids: rows.map(task => task.task_id), clinical_measure: false };
  }
  const total = mean(areaScores);
  return { version: FUNCTION_SCORE_VERSION, total, display_total: roundHalfUp(total), areas, tasks, clinical_measure: false };
}
