// The movement check's results: a movement map whose arm, hand and legs glow by area score, the daily function score
// counting up, each area's climbed level ladder with one body insight and one curiosity line, walking's pace, rhythm,
// step evenness and knee bend, the change since the last check, the next check-up and how it was all scored. Every
// number shown is measured (never invented); a line whose data is missing is left out. Reduced motion: the final state.

import { useEffect, useId, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ArrowRight, CalendarDays } from "lucide-react";
import type { AssessmentReport } from "@/lib/assessment";
import { CAMERA_TASKS } from "@/lib/assessment-engine/tasks";
import type { AssessmentTaskId, AssessmentTaskResult, AttemptRecord, CameraTaskId, GaitComponentId, GaitMetrics, GaitResult, NativeTaskScore } from "@/lib/assessment-engine/types";
import { REASSESSMENT_CYCLE_DAYS } from "@/lib/home-stage";
import type { AreaKey, AreaScores, JourneyAssessment } from "@/lib/journey";
import "./assessment-results.css";

export type AssessmentResultsProps = {
  report: AssessmentReport;
  /** Earlier checks kept by the Journey (loadJourneyAssessments); this check's own entry is ignored. */
  previous: JourneyAssessment[];
  walking?: GaitResult | null;
  taskResults: AssessmentTaskResult[];
  onContinue(): void;
  onHome(): void;
  /** When this check finished (default: the time in the report's "native-<time>" id, else now). */
  completedAt?: string | Date;
};

// ---------------------------------------------------------------- numbers

/** The score rings fill and their numbers count up over 1.2 s, easing out. */
export const COUNT_UP_MS = 1200;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
/** Displays round once, half up, from the unrounded value (as the scoring does). */
export const roundHalfUp = (value: number) => Math.floor(value + 0.5);

export type ResultArea = { key: AreaKey; name: string; tasks: AssessmentTaskId[] };
/** The three areas, as the function score groups its tasks. */
export const RESULT_AREAS: ResultArea[] = [
  { key: "upper_limb", name: "Arm", tasks: ["T1", "T3"] },
  { key: "hand", name: "Hand", tasks: ["H4", "H3"] },
  { key: "lower_limb", name: "Walking", tasks: ["L6"] },
];

export type Band = "strong" | "building" | "starting" | "unmeasured";
/** An area's colour: green from 75, amber from 50, coral below, grey when not measured (words go with it). */
export function scoreBand(score: number | null | undefined): Band {
  if (!finite(score)) return "unmeasured";
  return score >= 75 ? "strong" : score >= 50 ? "building" : "starting";
}
export const BAND_WORD: Record<Band, string> = { strong: "Strong", building: "Building", starting: "Early days", unmeasured: "Not measured" };

/** The daily function score as displayed (null: no area measured). */
export function totalScore(report: AssessmentReport): number | null {
  const value = report.metrics?.function_score?.display_total;
  return finite(value) ? roundHalfUp(value) : null;
}

/** An area's displayed score; walking falls back to the gait result's area score when the report lacks it. */
export function areaScore(report: AssessmentReport, key: AreaKey, walking?: GaitResult | null): number | null {
  const value = report.metrics?.function_score?.areas?.[key]?.display_score;
  if (finite(value)) return roundHalfUp(value);
  return key === "lower_limb" && walking?.status === "scored" && finite(walking.areaScore) ? roundHalfUp(walking.areaScore) : null;
}

/** The report's per-task rows (the native score's NativeTaskScore rows), by task. */
export function taskRows(report: AssessmentReport): Partial<Record<AssessmentTaskId, NativeTaskScore>> {
  const rows: Partial<Record<AssessmentTaskId, NativeTaskScore>> = {};
  const tasks = report.metrics?.function_score?.tasks;
  if (Array.isArray(tasks)) for (const row of tasks) if (row && typeof row.task_id === "string") rows[row.task_id as AssessmentTaskId] = row as NativeTaskScore;
  return rows;
}

// ---------------------------------------------------------------- the level ladders

export type RungState = "held" | "below" | "helped" | "tried" | "next" | "ahead";
export type Rung = { id: string; label: string; state: RungState };

/** An attempt's level in its task's ladder: by the stored id, else the stored index. */
function levelIndex(taskId: CameraTaskId, attempt: Pick<AttemptRecord, "level" | "levelId">): number {
  const index = CAMERA_TASKS[taskId].levels.findIndex(level => level.id === attempt.levelId);
  return index >= 0 ? index : attempt.level;
}

/** The task ran attempts the camera could judge (not lost to tracking); one skipped part-way keeps the attempts it made, as the scoring does. */
const ran = (result: AssessmentTaskResult | undefined): result is AssessmentTaskResult =>
  !!result && result.measured && result.stoppedBy !== "not_measured" && (result.stoppedBy !== "skipped" || (result.attempts?.length ?? 0) > 0);

/** The hardest level held for the full hold on the patient's own (−1: none). */
export function bestAlone(result: AssessmentTaskResult | undefined): number {
  if (!result) return -1;
  return result.attempts.reduce((best, attempt) => (attempt.completed && !attempt.assist ? Math.max(best, levelIndex(result.taskId, attempt)) : best), -1);
}

/**
 * Each level of a task, easiest first: held alone, below a level held alone (the levels nest, so it is within reach),
 * held with help, tried and not held, the next challenge, or still ahead. Without attempts (an older report), the
 * row's best level is the only evidence used.
 */
export function ladderRungs(taskId: CameraTaskId, result?: AssessmentTaskResult, row?: NativeTaskScore): Rung[] {
  const levels = CAMERA_TASKS[taskId].levels;
  const held: number[] = [], helped: number[] = [], tried: number[] = [];
  for (const attempt of ran(result) ? result.attempts : []) (attempt.completed ? (attempt.assist ? helped : held) : tried).push(levelIndex(taskId, attempt));
  const best = result ? bestAlone(ran(result) ? result : undefined) : levels.findIndex(level => level.label === row?.best_level);
  if (!result && best >= 0) held.push(best);
  const climbing = result ? ran(result) : finite(row?.level);
  return levels.map((level, index) => ({
    id: level.id, label: level.label,
    state: held.includes(index) ? "held" : index < best ? "below" : helped.includes(index) ? "helped" : tried.includes(index) ? "tried" : climbing && index === best + 1 ? "next" : "ahead",
  }));
}

const RUNG_MARK: Record<RungState, string> = { held: "✓", below: "✓", helped: "✓", tried: "○", next: "○", ahead: "○" };
const RUNG_TAG: Partial<Record<RungState, string>> = { helped: "with help", tried: "not yet", next: "next" };
const RUNG_SAY: Record<RungState, string> = {
  held: "held on your own", below: "within reach, you held a harder level", helped: "held with help",
  tried: "not this time", next: "your next challenge", ahead: "still ahead",
};

// ---------------------------------------------------------------- the patient's words for each level

/** Holding a level on one's own, as part of "You … on your own." */
const HELD: Record<CameraTaskId, Record<string, string>> = {
  T1: { r80: "lifted your hand to chest height", r120: "lifted your hand above your shoulder", r160: "reached overhead" },
  T3: { chest: "brought your hand to your chest", mouth: "brought your hand to your mouth" },
  H4: { partial: "opened your fingers part of the way", full: "opened your fingers wide" },
  H3: { partial: "brought your thumb close to your first finger", full: "touched your thumb and first finger tip to tip" },
};
/** Each level's target, for "about N% of the way to …" and "… reached …". */
const TARGET: Record<CameraTaskId, Record<string, string>> = {
  T1: { r80: "the chest-height circle", r120: "the circle above your shoulder", r160: "the overhead circle" },
  T3: { chest: "your chest", mouth: "your mouth" },
  H4: { partial: "the inner ring", full: "the wide ring" },
  // Pinch's partial target is the spot its level asks for (close to the finger, tasks.ts), which its progress measures toward.
  H3: { partial: "the spot close to your first finger", full: "your first finger" },
};
const MOVED: Record<CameraTaskId, string> = { T1: "Your hand moved", T3: "Your hand moved", H4: "Your fingers opened", H3: "Your thumb moved" };
const REACHED: Record<CameraTaskId, string> = { T1: "Your hand reached", T3: "Your hand reached", H4: "Your fingers reached", H3: "Your thumb reached" };
/** When a helping move was seen, at each level. */
const WHEN: Record<CameraTaskId, Record<string, string>> = {
  T1: { r80: "when the target was at chest height", r120: "when the target was above your shoulder", r160: "when the target was overhead" },
  T3: { chest: "as your hand came to your chest", mouth: "as your hand came to your mouth" },
  H4: { partial: "as your fingers opened part way", full: "as your fingers opened wide" },
  H3: { partial: "as your thumb closed toward your finger", full: "as you pinched tip to tip" },
};
/** A helping move the camera confirmed, and why it is worth being curious about. */
const COMP_CURIOSITY: Record<string, (when: string) => string> = {
  shoulder_hike: when => `Your shoulder tried to help ${when}. A sign your shoulder wants to join in; gentle practice can teach it to relax.`,
  trunk_lean: when => `Your body leaned in to help ${when}. Practice can teach your arm to do more of the work.`,
  trunk_forward: when => `Your body leaned in to help ${when}. Practice can teach your arm to do more of the work.`,
  other_hand: when => `Your other hand came over to help ${when}. A clever helper; practice can teach this side to manage alone.`,
  head_forward: when => `Your head moved toward your hand ${when}. With practice, your hand can travel more of the way.`,
  wrist_bend: when => `Your wrist bent to help ${when}. Practice can teach your fingers to do it on their own.`,
  forearm_turn: when => `Your palm turned ${when}. With practice, your fingers can move while your palm stays still.`,
  mass_flexion: when => `Your other fingers curled in ${when}. They can learn to stay relaxed while your thumb and first finger work.`,
};
/** A level as something to practise before the next check-up (after "Until then, try to:"). */
const CHALLENGE: Record<CameraTaskId, Record<string, string>> = {
  T1: { r80: "lift your hand to chest height", r120: "lift your hand above your shoulder", r160: "reach overhead" },
  T3: { chest: "bring your hand to your chest", mouth: "bring your hand to your mouth" },
  H4: { partial: "open your fingers part of the way", full: "open your fingers wide" },
  H3: { partial: "bring your thumb close to your first finger", full: "touch your thumb and first finger tip to tip" },
};
/** The top level again, without the helping move that was seen. */
const COMP_CLEAN: Record<string, string> = {
  shoulder_hike: "with your shoulder relaxed", trunk_lean: "with your back tall", trunk_forward: "with your back tall",
  other_hand: "with your other hand resting", head_forward: "with your head still", wrist_bend: "with your wrist straight",
  forearm_turn: "with your palm facing forward", mass_flexion: "with your other fingers relaxed",
};

const levelId = (taskId: CameraTaskId, index: number) => CAMERA_TASKS[taskId].levels[index]?.id ?? "";
/** "About N%": tenths, never 0 or 100 (a hold or a touch has its own words). */
const aboutPercent = (progress: number) => Math.min(90, Math.max(10, roundHalfUp(progress * 10) * 10));

/** A peak measurement from a task's insights (degrees), when the task recorded one. */
function measured(result: AssessmentTaskResult | undefined, key: string): number | null {
  const value = result?.insights?.[key] ?? result?.insights?.[`peak_${key}`];
  return finite(value) && value > 0 ? value : null;
}

const cameraTasks = (area: ResultArea, results: Partial<Record<AssessmentTaskId, AssessmentTaskResult>>) =>
  area.tasks.filter((id): id is CameraTaskId => id !== "L6").map(id => results[id]).filter(ran);

export function byTask(taskResults: AssessmentTaskResult[]): Partial<Record<AssessmentTaskId, AssessmentTaskResult>> {
  const results: Partial<Record<AssessmentTaskId, AssessmentTaskResult>> = {};
  for (const result of taskResults ?? []) if (result && CAMERA_TASKS[result.taskId]) results[result.taskId] = result;
  return results;
}

/**
 * One line on what this area's body did today, from the attempts only: the hardest levels held alone (plus the arm's
 * peak angle when the task it comes from was itself held alone), else held with help, else reached without the hold,
 * else how far it moved. Null when the camera measured nothing in this area.
 */
export function bodyInsight(area: ResultArea, results: Partial<Record<AssessmentTaskId, AssessmentTaskResult>>): string | null {
  const tasks = cameraTasks(area, results);
  if (!tasks.length) return null;
  // The peak angle includes the resting arm and leaves out helped attempts, so it is said only beside a level its own task
  // held alone (the reach's for the shoulder, hand to mouth's for the elbow), never alone or beside help or another task.
  const heldAlone = (result: AssessmentTaskResult | undefined) => ran(result) && bestAlone(result) >= 0;
  const shoulder = measured(results.T1, "shoulder_flexion"), elbow = measured(results.T3, "elbow_flexion");
  const angle = area.key !== "upper_limb" ? "" : shoulder !== null && heldAlone(results.T1) ? `Your arm rose to about ${roundHalfUp(shoulder / 5) * 5}° from your side.`
    : elbow !== null && heldAlone(results.T3) ? `Your elbow bent to about ${roundHalfUp(elbow / 5) * 5}°.` : "";
  const alone = tasks.flatMap(result => { const best = bestAlone(result); return best >= 0 ? [HELD[result.taskId][levelId(result.taskId, best)]] : []; });
  if (alone.length) return angle ? `You ${alone.join(" and ")} on your own. ${angle}` : `You ${alone.join(" and ")} on your own.`;
  const helped = tasks.flatMap(result => {
    const top = result.attempts.reduce((best, attempt) => (attempt.completed && attempt.assist ? Math.max(best, levelIndex(result.taskId, attempt)) : best), -1);
    return top >= 0 ? [HELD[result.taskId][levelId(result.taskId, top)]] : [];
  });
  if (helped.length) return `With help, you ${helped.join(" and ")}.`;
  for (const result of tasks) {
    const touched = result.attempts.filter(attempt => attempt.touched && !attempt.completed).map(attempt => levelIndex(result.taskId, attempt));
    if (touched.length) return `${REACHED[result.taskId]} ${TARGET[result.taskId][levelId(result.taskId, Math.max(...touched))]}; holding it there comes next.`;
  }
  // How far the movement got: the furthest attempt (the try-out is at the easiest level), toward that level's own target.
  let far: { taskId: CameraTaskId; level: number; progress: number } | null = null;
  for (const result of tasks) {
    const tries = [{ level: 0, progress: result.tryOut?.peakProgress }, ...result.attempts.map(attempt => ({ level: levelIndex(result.taskId, attempt), progress: attempt.peakProgress }))];
    for (const { level, progress } of tries) if (finite(progress) && progress >= 0.1 && (!far || progress > far.progress)) far = { taskId: result.taskId, level, progress };
  }
  if (far) return `${MOVED[far.taskId]} about ${aboutPercent(far.progress)}% of the way to ${TARGET[far.taskId][levelId(far.taskId, far.level)]}.`;
  return "Today sets your starting point. Every level from here is a step forward.";
}

/**
 * One line to be curious about, from the attempts only: a helping move the camera confirmed (at the hardest level it
 * was seen), else a near miss above the best level, else the top level held with every check clean. Null otherwise.
 */
export function curiosityLine(area: ResultArea, results: Partial<Record<AssessmentTaskId, AssessmentTaskResult>>): string | null {
  const tasks = cameraTasks(area, results);
  // Attempts on the patient's own only: a helper's hands near the arm would read as helping moves.
  const seen = tasks.flatMap(result => result.attempts.filter(attempt => !attempt.assist).map(attempt => ({ result, attempt, level: levelIndex(result.taskId, attempt) })))
    .sort((a, b) => b.level - a.level);
  for (const { result, attempt, level } of seen) {
    const comp = Object.keys(attempt.compensations ?? {}).find(id => attempt.compensations[id] === "detected" && COMP_CURIOSITY[id]);
    if (comp) return COMP_CURIOSITY[comp](WHEN[result.taskId][levelId(result.taskId, level)]);
  }
  let near: { result: AssessmentTaskResult; level: number; progress: number; touched: boolean } | null = null;
  for (const { result, attempt, level } of seen) {
    const best = bestAlone(result);
    if (best < 0 || level <= best || attempt.completed || !finite(attempt.peakProgress)) continue;
    if ((attempt.touched || attempt.peakProgress >= 0.3) && (!near || attempt.peakProgress > near.progress)) near = { result, level, progress: attempt.peakProgress, touched: attempt.touched };
  }
  if (near) {
    const target = TARGET[near.result.taskId][levelId(near.result.taskId, near.level)];
    return near.touched ? `${REACHED[near.result.taskId]} ${target} too, just not for the full hold yet. Holding is strength you can build.`
      : `You got about ${aboutPercent(near.progress)}% of the way to ${target}. That edge is where practice counts most.`;
  }
  for (const result of tasks) {
    const top = CAMERA_TASKS[result.taskId].levels.length - 1;
    if (bestAlone(result) !== top) continue;
    const checks = result.attempts.filter(attempt => attempt.completed && !attempt.assist && levelIndex(result.taskId, attempt) === top).map(attempt => Object.values(attempt.compensations ?? {}));
    if (checks.some(list => list.length > 0 && list.every(status => status === "not_detected"))) return `You ${HELD[result.taskId][levelId(result.taskId, top)]} with no helping moves seen. Notice next time whether it feels easier.`;
  }
  return null;
}

/** The area's next challenge: the scoring's next step for the task with most room, else the next level up. */
export function nextChallenge(area: ResultArea, rows: Partial<Record<AssessmentTaskId, NativeTaskScore>>, results: Partial<Record<AssessmentTaskId, AssessmentTaskResult>>): string | null {
  const stated = area.tasks.map(id => rows[id]).filter((row): row is NativeTaskScore => !!row && typeof row.next_step === "string" && row.next_step.trim() !== "")
    .sort((a, b) => (finite(a.level) ? a.level : 9) - (finite(b.level) ? b.level : 9))[0];
  if (stated) { const text = stated.next_step!.trim().replace(/^next:\s*/i, ""); return text.charAt(0).toUpperCase() + text.slice(1); }
  const climb = climbs(cameraTasks(area, results))[0];
  return climb ? `${climb.charAt(0).toUpperCase()}${climb.slice(1)}.` : null;
}

/** The next level of each task that ran, the task with most room first. */
function climbs(results: AssessmentTaskResult[]): string[] {
  return results.map(result => ({ result, best: bestAlone(result), count: CAMERA_TASKS[result.taskId].levels.length }))
    .filter(item => item.best + 1 < item.count)
    .sort((a, b) => (a.best + 1) / a.count - (b.best + 1) / b.count)
    .map(item => CHALLENGE[item.result.taskId][levelId(item.result.taskId, item.best + 1)]);
}

/** One or two things to practise before the next check-up: the next levels, else the top level without the helping move seen. */
export function checkUpChallenges(taskResults: AssessmentTaskResult[]): string[] {
  const tasks = (taskResults ?? []).filter(ran);
  const cleaner = tasks.flatMap(result => {
    const top = CAMERA_TASKS[result.taskId].levels.length - 1;
    if (bestAlone(result) !== top) return [];
    const comp = result.attempts.filter(attempt => attempt.completed && !attempt.assist && levelIndex(result.taskId, attempt) === top)
      .flatMap(attempt => Object.keys(attempt.compensations ?? {}).filter(id => attempt.compensations[id] === "detected" && COMP_CLEAN[id]))[0];
    return comp ? [`${CHALLENGE[result.taskId][levelId(result.taskId, top)]} ${COMP_CLEAN[comp]}`] : [];
  });
  return [...climbs(tasks), ...cleaner].filter((line, index, all) => all.indexOf(line) === index).slice(0, 2);
}

// ---------------------------------------------------------------- walking

export type SpeedBand = { id: "household" | "indoor" | "community"; label: string; about: string };
/** A friendly band for the estimated speed, as displayed (one decimal), so the words never contradict the number. */
export function speedBand(mps: number): SpeedBand {
  const shown = roundHalfUp(mps * 10) / 10;
  if (shown < 0.4) return { id: "household", label: "Household pace", about: "a pace for getting about at home" };
  if (shown < 0.8) return { id: "indoor", label: "Indoor stroll", about: "a gentle pace for walking indoors" };
  return { id: "community", label: "Community pace", about: "a pace for getting about outside" };
}
/** The pace scale's right end (m/s); faster speeds sit at the end. */
const PACE_SCALE_MAX = 1.4;

/** Shorter over longer step, as a whole percentage (the stored symmetry, else from the two mean step lengths). */
export function stepEvenness(metrics: Partial<GaitMetrics>): number | null {
  const sym = finite(metrics.stepLengthSymmetry) ? metrics.stepLengthSymmetry
    : finite(metrics.stepLengthA) && finite(metrics.stepLengthB) && Math.max(metrics.stepLengthA, metrics.stepLengthB) > 0 ? Math.min(metrics.stepLengthA, metrics.stepLengthB) / Math.max(metrics.stepLengthA, metrics.stepLengthB) : null;
  return sym === null ? null : roundHalfUp(sym * 100);
}

/** What the walk itself was (passes and steps), when it was measured. */
export function walkingInsight(walking: GaitResult | null | undefined): string | null {
  if (walking?.status !== "scored") return null;
  const { passes, steps } = walking.metrics;
  if (!finite(passes) || !finite(steps) || passes < 1 || steps < 1) return null;
  const across = passes === 1 ? "You walked across" : passes === 2 ? "You walked across and back" : `You walked across ${passes} times`;
  return `${across}, ${steps} steps in all.`;
}

/** One walking line to be curious about: uneven timing or length, a stiff knee, extra lean, else how even the steps were. */
export function walkingCuriosity(walking: GaitResult | null | undefined): string | null {
  if (walking?.status !== "scored") return null;
  const m = walking.metrics;
  const timing = finite(m.stepTimeSymmetry) ? roundHalfUp(m.stepTimeSymmetry * 100) : null;
  const length = stepEvenness(m);
  if (timing !== null && timing < 90) return `One step takes a little longer than the other: your step timing is ${timing}% even. Your body is still finding its rhythm.`;
  if (length !== null && length < 90) return `One step is a little shorter than the other: ${length}% even. Practice can help even them out.`;
  if (finite(m.kneeFlexPeak) && roundHalfUp(m.kneeFlexPeak) < 40) return `Your knee bends to about ${roundHalfUp(m.kneeFlexPeak)}° as your foot swings. More bend helps your foot clear the floor.`;
  // Without a standing baseline (trunkBaseline false: the stand-still was not seen) the lean is the raw angle, not the extra.
  if (finite(m.trunkLeanDeg) && roundHalfUp(m.trunkLeanDeg) > 5) return m.trunkBaseline === false
    ? `Your body leaned about ${roundHalfUp(m.trunkLeanDeg)}° forward as you walked. Notice next time whether you can walk a little taller.`
    : `You leaned about ${roundHalfUp(m.trunkLeanDeg)}° further forward than when standing. Your body may be helping your legs along.`;
  if (length !== null) return `Your steps are ${length}% even in length. A steady rhythm to build on.`;
  return null;
}

// ---------------------------------------------------------------- since last time and the next check-up

/** A chip's change; since: the earlier check an area is compared with, when it is not the last one (which skipped it). */
export type Change = { key: AreaKey | "total"; name: string; now: number | null; before: number | null; delta: number | null; since?: Date };
/** totals: the sparkline's values, oldest first, all over the same areas; totalsName says what they total. */
export type SinceLast = { when: Date; changes: Change[]; totals: number[]; totalsName: string };

/** A stored check's overall score: the mean of its measured areas, rounded once (the Journey keeps only area scores). */
export function journeyTotal(scores: Partial<AreaScores> | null | undefined): number | null {
  const values = RESULT_AREAS.map(area => scores?.[area.key]).filter(finite);
  return values.length ? roundHalfUp(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

/** The areas a check measured, in the dashboard's order. */
const measuredAreas = (scores: Partial<AreaScores> | null | undefined): AreaKey[] => RESULT_AREAS.filter(area => finite(scores?.[area.key])).map(area => area.key);
/** A check's total over these areas only. */
const totalOver = (scores: Partial<AreaScores>, keys: AreaKey[]) => journeyTotal(Object.fromEntries(keys.map(key => [key, scores[key]])) as Partial<AreaScores>);
const sameAreas = (a: AreaKey[], b: AreaKey[]) => a.length === b.length && a.every(key => b.includes(key));
/** A total over these areas: the daily function score when they are every area each check measured, else the areas by name. */
function totalName(keys: AreaKey[], whole: boolean): string {
  if (whole) return "Daily function score";
  const names = RESULT_AREAS.filter(area => keys.includes(area.key)).map((area, index) => (index ? area.name.toLowerCase() : area.name));
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} together`;
}

/**
 * The change from the most recent earlier check (null when there is none, or nothing was measured today), like with like:
 * today is totalled as the Journey keeps it (its rounded area scores), and the total only over the areas both checks
 * measured, named by those areas when either measured more (one shared area alone is its own chip). An area the last check
 * skipped is compared with the most recent check that measured it. The sparkline totals the same areas at every check
 * that measured them, today last.
 */
export function sinceLastTime(report: AssessmentReport, previous: JourneyAssessment[], walking?: GaitResult | null): SinceLast | null {
  const earlier = (previous ?? []).filter(item => item && item.id !== report.id && item.scores && !Number.isNaN(new Date(item.completedAt).getTime()))
    .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
  const last = earlier[earlier.length - 1];
  if (!last || totalScore(report) === null) return null;
  const today: AreaScores = { upper_limb: areaScore(report, "upper_limb", walking), hand: areaScore(report, "hand", walking), lower_limb: areaScore(report, "lower_limb", walking) };
  const nowAreas = measuredAreas(today), lastAreas = measuredAreas(last.scores);
  const shared = nowAreas.filter(key => lastAreas.includes(key));
  const whole = sameAreas(nowAreas, shared) && sameAreas(lastAreas, shared);
  const changes: Change[] = [];
  if (shared.length && (whole || shared.length > 1)) {
    const now = totalOver(today, shared), before = totalOver(last.scores, shared);
    changes.push({ key: "total", name: totalName(shared, whole), now, before, delta: now !== null && before !== null ? now - before : null });
  }
  for (const area of RESULT_AREAS) {
    const now = today[area.key];
    if (now === null) continue;
    const match = [...earlier].reverse().find(item => finite(item.scores[area.key]));
    const before = match ? roundHalfUp(match.scores[area.key] as number) : null;
    changes.push({ key: area.key, name: area.name, now, before, delta: before === null ? null : now - before, ...(match && match !== last ? { since: new Date(match.completedAt) } : {}) });
  }
  const plotted = shared.length ? [...earlier.map(item => item.scores), today].filter(scores => shared.every(key => finite(scores[key]))) : [];
  return {
    when: new Date(last.completedAt), changes,
    totals: plotted.map(scores => totalOver(scores, shared)).filter(finite),
    totalsName: totalName(shared, plotted.every(scores => sameAreas(measuredAreas(scores), shared))),
  };
}

/** "+8", "−3" or "Same", with its arrow, for a change chip (null: nothing to compare). */
export function deltaText(delta: number | null): { text: string; arrow: string; say: string; dir: "up" | "down" | "same" } | null {
  if (delta === null) return null;
  if (delta > 0) return { text: `+${delta}`, arrow: "▲", say: `up ${delta} ${delta === 1 ? "point" : "points"}`, dir: "up" };
  if (delta < 0) return { text: `−${-delta}`, arrow: "▼", say: `down ${-delta} ${delta === -1 ? "point" : "points"}`, dir: "down" };
  return { text: "Same", arrow: "", say: "the same", dir: "same" };
}

/** When this check finished: the time in a native report's id ("native-<ms>" or an ISO time), else the fallback. */
export function completedAtOf(report: AssessmentReport, fallback = new Date()): Date {
  const stamp = /^native-(.+)$/.exec(report.id ?? "")?.[1];
  if (stamp) {
    const date = /^\d{10,}$/.test(stamp) ? new Date(Number(stamp)) : new Date(stamp);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return fallback;
}

/** The next movement check: REASSESSMENT_CYCLE_DAYS after the day this one finished, as the home page counts it. */
export function nextCheckUp(completed: Date): Date {
  const due = new Date(completed.getFullYear(), completed.getMonth(), completed.getDate());
  due.setDate(due.getDate() + REASSESSMENT_CYCLE_DAYS);
  return due;
}

const longDate = (date: Date) => date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const shortDate = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

// ---------------------------------------------------------------- motion

const STILL_QUERY = "(prefers-reduced-motion: reduce)";
const stillNow = () => typeof window !== "undefined" && !!window.matchMedia?.(STILL_QUERY).matches;
function subscribeStill(notify: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(STILL_QUERY);
  media.addEventListener?.("change", notify);
  return () => media.removeEventListener?.("change", notify);
}
/** The device asks for less motion (read on the first render too, so the final state shows at once). */
function useStill(): boolean {
  return useSyncExternalStore(subscribeStill, stillNow, stillNow);
}

/** What a count-up runs on: a clock (ms), animation frames and timers (the browser's by default; tests pass their own). */
export type CountUpClock = { now(): number; frame(tick: () => void): number; cancelFrame(id: number): void; after(ms: number, run: () => void): number; cancelAfter(id: number): void };
const browserClock: CountUpClock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  frame: tick => requestAnimationFrame(() => tick()),
  cancelFrame: id => cancelAnimationFrame(id),
  after: (ms, run) => Number(setTimeout(run, ms)),
  cancelAfter: id => clearTimeout(id),
};
/** How long after its end a count-up's timer shows the real number, if animation frames have not. */
export const COUNT_UP_GRACE_MS = 300;

/**
 * Shows 0, then counts up to the target (ease-out over COUNT_UP_MS, after a delay) on animation frames. A hidden tab never
 * runs them, so a timer shows the real number anyway: COUNT_UP_MS + COUNT_UP_GRACE_MS after the start when no frame has
 * run, else that long after the count's own end (a frame loop that stalled). Returns a function that stops it.
 */
export function countUp(target: number, delayMs: number, show: (value: number) => void, clock: CountUpClock = browserClock): () => void {
  const start = clock.now() + delayMs, end = start + COUNT_UP_MS + COUNT_UP_GRACE_MS;
  let frame = 0, timer = 0, ticked = false, done = false;
  const finish = () => { done = true; clock.cancelFrame(frame); clock.cancelAfter(timer); show(target); };
  const tick = () => {
    if (done) return;
    ticked = true;
    const t = Math.min(1, Math.max(0, (clock.now() - start) / COUNT_UP_MS));
    if (t >= 1) { finish(); return; }
    show(target * easeOut(t));
    frame = clock.frame(tick);
  };
  const fallback = () => {
    if (done) return;
    if (!ticked || clock.now() >= end) finish();
    else timer = clock.after(end - clock.now(), fallback);
  };
  show(0);
  frame = clock.frame(tick);
  timer = clock.after(COUNT_UP_MS + COUNT_UP_GRACE_MS, fallback);
  return () => { done = true; clock.cancelFrame(frame); clock.cancelAfter(timer); };
}

/** A number counting up to its target (ease-out, after a delay); the target at once with reduced motion. */
function useCountUp(target: number | null, still: boolean, delayMs = 0): number | null {
  const [value, setValue] = useState<number | null>(() => (target === null ? null : still ? target : 0));
  useEffect(() => {
    if (target === null || still || typeof requestAnimationFrame === "undefined") { setValue(target); return; }
    return countUp(target, delayMs, setValue);
  }, [target, still, delayMs]);
  return value;
}

const vars = (values: Record<string, string | number>) => values as CSSProperties;

// ---------------------------------------------------------------- pieces

function ScoreRing({ shown, target, label, large = false }: { shown: number | null; target: number | null; label: string; large?: boolean }) {
  const band = scoreBand(target), radius = 52, circumference = 2 * Math.PI * radius;
  const fill = target === null ? 0 : Math.max(0, Math.min(100, shown ?? 0)) / 100;
  return (
    <div className={`ar-ring is-${band}${large ? " is-large" : ""}`} role="img"
      aria-label={target === null ? `${label}: not measured` : `${label}: ${target} out of 100, ${BAND_WORD[band].toLowerCase()}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <circle className="ar-ring-track" cx="60" cy="60" r={radius} />
        {target !== null && <circle className="ar-ring-fill" cx="60" cy="60" r={radius} strokeDasharray={circumference.toFixed(2)} strokeDashoffset={(circumference * (1 - fill)).toFixed(2)} />}
      </svg>
      <span className="ar-ring-num" aria-hidden="true">{target === null ? "–" : Math.round(shown ?? 0)}</span>
    </div>
  );
}

/** The body facing the viewer: the patient's right side is on the picture's left. */
function MovementMap({ scores, side, uid }: { scores: Record<AreaKey, number | null>; side: "left" | "right" | null; uid: string }) {
  const arm = scoreBand(scores.upper_limb), hand = scoreBand(scores.hand), legs = scoreBand(scores.lower_limb);
  const arms = [
    { id: "pr", left: true, path: "86,86 66,134 58,178", hand: [56, 192] as const, label: [40, 136] as const, handLabel: [56, 220] as const },
    { id: "pl", left: false, path: "134,86 154,134 162,178", hand: [164, 192] as const, label: [180, 136] as const, handLabel: [164, 220] as const },
  ];
  // Unknown side: both arms carry the arm and hand colours.
  const affected = (left: boolean) => side === null || (side === "right") === left;
  const legPaths = ["98,178 94,240 92,296", "122,178 126,240 128,296"];
  const summary = RESULT_AREAS.map(area => `${area.name} ${scores[area.key] === null ? "not measured" : `${scores[area.key]}, ${BAND_WORD[scoreBand(scores[area.key])].toLowerCase()}`}`).join("; ");
  return (
    <svg className="ar-map" viewBox="0 0 220 330" role="img" aria-label={`Your movement map. ${summary}.`}>
      <defs>
        <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" /></filter>
      </defs>
      <g className="ar-map-body">
        <circle cx="110" cy="40" r="22" />
        <rect x="102" y="58" width="16" height="16" rx="6" />
        <rect x="82" y="70" width="56" height="114" rx="24" />
        {arms.map(item => <polyline key={item.id} points={item.path} className="ar-limb" />)}
        {arms.map(item => <circle key={`${item.id}-h`} cx={item.hand[0]} cy={item.hand[1]} r="11" />)}
        {legPaths.map(points => <polyline key={points} points={points} className="ar-limb is-leg" />)}
        <ellipse cx="88" cy="304" rx="13" ry="6" /><ellipse cx="132" cy="304" rx="13" ry="6" />
      </g>
      <g className="ar-map-glow" filter={`url(#${uid}-glow)`}>
        {arms.filter(item => affected(item.left)).map(item => <polyline key={item.id} points={item.path} className={`ar-glow ar-limb is-${arm}`} />)}
        {arms.filter(item => affected(item.left)).map(item => <circle key={`${item.id}-h`} cx={item.hand[0]} cy={item.hand[1]} r="16" className={`ar-glow is-hand is-${hand}`} />)}
        {legPaths.map(points => <polyline key={points} points={points} className={`ar-glow ar-limb is-leg is-${legs}`} />)}
      </g>
      <g className="ar-map-lit">
        {arms.filter(item => affected(item.left)).map(item => <polyline key={item.id} points={item.path} className={`ar-lit ar-limb is-${arm}`} />)}
        {arms.filter(item => affected(item.left)).map(item => <circle key={`${item.id}-h`} cx={item.hand[0]} cy={item.hand[1]} r="10" className={`ar-lit is-hand is-${hand}`} />)}
        {legPaths.map(points => <polyline key={points} points={points} className={`ar-lit ar-limb is-leg is-${legs}`} />)}
      </g>
      <g className="ar-map-labels" aria-hidden="true">
        {arms.filter(item => affected(item.left)).map(item => (
          <g key={item.id}>
            <text x={item.label[0]} y={item.label[1]} textAnchor={item.left ? "end" : "start"}>Arm</text>
            <text x={item.handLabel[0]} y={item.handLabel[1]} textAnchor="middle">Hand</text>
          </g>
        ))}
        <text x="110" y="326" textAnchor="middle">Walking</text>
      </g>
    </svg>
  );
}

function TaskLadder({ taskId, result, row, order }: { taskId: CameraTaskId; result?: AssessmentTaskResult; row?: NativeTaskScore; order: number }) {
  const spec = CAMERA_TASKS[taskId];
  const rungs = ladderRungs(taskId, result, row);
  // The scoring's own label ("Can do", "Not yet: comes after hand opening", "Not measured"...), else what the result says.
  // A task the patient skipped in the runner is never the pinch waiting for hand opening (the page skips that one itself).
  const skipped = result?.stoppedBy === "skipped";
  const note = row?.label || (result && !ran(result) ? (skipped ? "Not assessed" : "Not measured this time") : null);
  return (
    <div className="ar-task">
      <h3>{spec.name}</h3>
      {note && <p className="ar-task-level">{note}{row?.assisted ? " · with help" : ""}</p>}
      <ol className="ar-ladder" aria-label={`${spec.name} levels, easiest first`}>
        {rungs.map((rung, index) => (
          <li key={rung.id} className={`ar-rung is-${rung.state}`} style={vars({ "--i": order * rungs.length + index })}>
            <span className="ar-rung-mark" aria-hidden="true">{RUNG_MARK[rung.state]}</span>
            <span className="ar-rung-label">{rung.label}{RUNG_TAG[rung.state] && <small aria-hidden="true">{RUNG_TAG[rung.state]}</small>}</span>
            <span className="ar-sr">: {RUNG_SAY[rung.state]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The pace scale's three stretches (m/s, as speedBand draws them) and their words. */
const PACE_STRETCHES: { id: SpeedBand["id"]; from: number; to: number; word: string }[] = [
  { id: "household", from: 0, to: 0.4, word: "Home" },
  { id: "indoor", from: 0.4, to: 0.8, word: "Indoors" },
  { id: "community", from: 0.8, to: PACE_SCALE_MAX, word: "Out and about" },
];

function PaceScale({ mps }: { mps: number }) {
  // The marker sits at the speed as displayed (one decimal), as speedBand words it, so it never sits in another stretch.
  const at = Math.max(0, Math.min(1, (roundHalfUp(mps * 10) / 10) / PACE_SCALE_MAX)) * 100;
  const width = (stretch: (typeof PACE_STRETCHES)[number]) => vars({ "--w": `${(((stretch.to - stretch.from) / PACE_SCALE_MAX) * 100).toFixed(2)}%` });
  return (
    <div className="ar-pace" aria-hidden="true">
      <div className="ar-pace-track">
        {PACE_STRETCHES.map(stretch => <span key={stretch.id} className={`ar-pace-${stretch.id}`} style={width(stretch)} />)}
        <i style={vars({ "--at": `${at.toFixed(1)}%` })} />
      </div>
      <div className="ar-pace-words">{PACE_STRETCHES.map(stretch => <span key={stretch.id} style={width(stretch)}>{stretch.word}</span>)}</div>
    </div>
  );
}

function Footprints({ a, b, evenness }: { a: number; b: number; evenness: number }) {
  const longest = Math.max(a, b), full = 150;
  const foot = (length: number, y: number, index: number) => {
    const w = Math.max(24, (length / longest) * full);
    return (
      <g className="ar-foot" style={vars({ "--i": index })} key={index}>
        <rect x="8" y={y} width={w} height="18" rx="9" />
        <circle cx={8 + w + 6} cy={y + 3} r="3.2" /><circle cx={8 + w + 7} cy={y + 9} r="3.2" /><circle cx={8 + w + 6} cy={y + 15} r="3.2" />
      </g>
    );
  };
  return (
    <svg className="ar-feet" viewBox="0 0 180 56" role="img" aria-label={`Two footprints drawn to your two step lengths: the shorter step is ${evenness}% of the longer.`}>
      {foot(a, 6, 0)}{foot(b, 32, 1)}
    </svg>
  );
}

/** A half-circle gauge, 0 to 70 degrees. */
function KneeGauge({ degrees }: { degrees: number }) {
  const max = 70, share = Math.max(0, Math.min(1, degrees / max)), angle = Math.PI * share;
  const x = 60 - 48 * Math.cos(angle), y = 58 - 48 * Math.sin(angle);
  return (
    <svg className="ar-knee" viewBox="0 0 120 74" role="img" aria-label={`Knee bend as your foot swings: ${degrees} degrees`}>
      <path className="ar-knee-track" d="M 12 58 A 48 48 0 0 1 108 58" />
      {share > 0 && <path className="ar-knee-fill" pathLength={100} d={`M 12 58 A 48 48 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} />}
      <circle className="ar-knee-dot" cx={x.toFixed(2)} cy={y.toFixed(2)} r="4.5" />
      <text x="12" y="73" textAnchor="middle">0°</text>
      <text x="108" y="73" textAnchor="middle">{max}°</text>
    </svg>
  );
}

function WalkingDetails({ walking, row }: { walking: GaitResult | null; row?: NativeTaskScore }) {
  if (walking?.status !== "scored") {
    // A score in the report without the walk's details: the ring says it all, nothing more is known here.
    if (!walking && row && finite(row.points)) return null;
    // Skipping walking (the page passes no walk, the report's row says walking_skipped) is a choice, not a failed measurement.
    const notPart = walking?.status === "skipped" || (!walking && (!row || (row as NativeTaskScore & { reason?: unknown }).reason === "walking_skipped"));
    if (notPart) return <p className="ar-muted">Walking was not part of today's check.</p>;
    return (
      <>
        <p className="ar-insight"><b>Not measured</b> I couldn't measure your walking this time.{walking?.reason ? ` ${walking.reason}` : ""}</p>
        <p className="ar-next"><span>Next challenge</span> Try walking next time.</p>
      </>
    );
  }
  const m = walking.metrics;
  const mps = finite(m.speedMpsEstimate) && m.speedMpsEstimate > 0 ? m.speedMpsEstimate : null;
  const band = mps !== null ? speedBand(mps) : null;
  const cadence = finite(m.cadence) && m.cadence > 0 ? m.cadence : null;
  const evenness = stepEvenness(m);
  const knee = finite(m.kneeFlexPeak) ? roundHalfUp(m.kneeFlexPeak) : null;
  const insight = walkingInsight(walking), curious = walkingCuriosity(walking);
  return (
    <>
      <div className="ar-walk">
        {mps !== null && band && (
          <div className="ar-stat">
            <span className="ar-stat-name">Speed</span>
            <b>About {(roundHalfUp(mps * 10) / 10).toFixed(1)} m/s</b>
            <span className={`ar-pace-tag is-${band.id}`}>{band.label}</span>
            <PaceScale mps={mps} />
            <span className="ar-sr">{band.label}: {band.about}.</span>
          </div>
        )}
        {cadence !== null && (
          <div className="ar-stat">
            <span className="ar-stat-name">Rhythm</span>
            <b>{roundHalfUp(cadence)} steps a minute</b>
            {/* One pulse per step, at the walk's real cadence. */}
            <span className="ar-metro" style={vars({ "--beat": `${(60 / cadence).toFixed(3)}s` })} aria-hidden="true"><i /></span>
          </div>
        )}
        {evenness !== null && (
          <div className="ar-stat">
            <span className="ar-stat-name">Step evenness</span>
            <b>{evenness}% even in length</b>
            {finite(m.stepLengthA) && finite(m.stepLengthB) && m.stepLengthA > 0 && m.stepLengthB > 0 && (
              <>
                <Footprints a={m.stepLengthA} b={m.stepLengthB} evenness={evenness} />
                <span className="ar-stat-note" aria-hidden="true">Your two steps, drawn to length</span>
              </>
            )}
          </div>
        )}
        {knee !== null && (
          <div className="ar-stat">
            <span className="ar-stat-name">Knee bend{finite(m.kneeFlexA) && finite(m.kneeFlexB) ? " (stiffer side)" : ""}</span>
            <b>{knee}° as your foot swings</b>
            <KneeGauge degrees={knee} />
          </div>
        )}
      </div>
      {walking.assist === "holds" && (
        <p className="ar-help-tag">The walk itself scored {roundHalfUp(walking.score)}; because someone held you, walking counts at most 50.</p>
      )}
      {insight && <p className="ar-insight"><b>Body insight</b> {insight}</p>}
      {curious && <p className="ar-curious"><b>Did you notice?</b> {curious}</p>}
    </>
  );
}

function AreaCard({ area, index, score, rows, results, walking, still }: {
  area: ResultArea; index: number; score: number | null; rows: Partial<Record<AssessmentTaskId, NativeTaskScore>>;
  results: Partial<Record<AssessmentTaskId, AssessmentTaskResult>>; walking: GaitResult | null; still: boolean;
}) {
  const shown = useCountUp(score, still, 400 + index * 220);
  const id = `ar-area-${area.key}`;
  const band = scoreBand(score);
  const walk = area.key === "lower_limb";
  const insight = walk ? null : bodyInsight(area, results), curious = walk ? null : curiosityLine(area, results);
  // Unmeasured walking brings its own "Try walking next time".
  const next = walk && walking?.status !== "scored" ? null : nextChallenge(area, rows, results);
  const cameraIds = area.tasks.filter((task): task is CameraTaskId => task !== "L6");
  const nothing = !walk && score === null && !cameraIds.some(task => ran(results[task]));
  return (
    <article className={`ar-card ar-area is-${band} ar-rise`} style={vars({ "--d": `${160 + index * 120}ms` })} aria-labelledby={id}>
      <div className="ar-area-head">
        <ScoreRing shown={shown} target={score} label={`${area.name} score`} />
        <div>
          <h2 id={id}>{area.name}</h2>
          <p className={`ar-band is-${band}`}>{BAND_WORD[band]}</p>
        </div>
      </div>
      {walk ? <WalkingDetails walking={walking} row={rows.L6} /> : (
        <>
          <div className="ar-ladders">
            {cameraIds.map((task, order) => <TaskLadder key={task} taskId={task} result={results[task]} row={rows[task]} order={order} />)}
          </div>
          {nothing && <p className="ar-muted">Not measured this time. We'll try again at your next check-up.</p>}
          {insight && <p className="ar-insight"><b>Body insight</b> {insight}</p>}
          {curious && <p className="ar-curious"><b>Did you notice?</b> {curious}</p>}
        </>
      )}
      {next && <p className="ar-next"><span>Next challenge</span> {next}</p>}
    </article>
  );
}

/** Every check's total over the same areas (named), oldest first, scaled to its own range (at least 20 points tall) so change is visible. */
function Sparkline({ values, name }: { values: number[]; name: string }) {
  const width = 180, height = 56, left = 20, right = 26, top = 8, bottom = 8;
  const mid = (Math.min(...values) + Math.max(...values)) / 2, span = Math.max(20, Math.max(...values) - Math.min(...values));
  const low = mid - span / 2, step = values.length > 1 ? (width - left - right) / (values.length - 1) : 0;
  const points = values.map((value, index) => [left + index * step, top + (1 - (value - low) / span) * (height - top - bottom)] as const);
  const last = points.length - 1;
  return (
    <figure className="ar-spark">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${name} at each check, oldest first: ${values.join(", ")}`}>
        <polyline pathLength={100} points={points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} />
        {points.map(([x, y], index) => <circle key={index} cx={x.toFixed(1)} cy={y.toFixed(1)} r={index === last ? 4.5 : 3} className={index === last ? "is-now" : undefined} />)}
        <text x={points[0][0] - 7} y={points[0][1] + 4} textAnchor="end" aria-hidden="true">{values[0]}</text>
        <text x={points[last][0] + 8} y={points[last][1] + 4} className="is-now" aria-hidden="true">{values[last]}</text>
      </svg>
      <figcaption>{name} at each check, oldest first</figcaption>
    </figure>
  );
}

const WALK_PARTS: { id: GaitComponentId; name: string; weight: number }[] = [
  { id: "speed", name: "Walking speed", weight: 30 },
  { id: "cadence", name: "Steps a minute", weight: 15 },
  { id: "step_length_symmetry", name: "Even step length", weight: 20 },
  { id: "step_time_symmetry", name: "Even step timing", weight: 15 },
  { id: "knee_bend", name: "Knee bend", weight: 10 },
  { id: "trunk_upright", name: "Upright trunk", weight: 10 },
];
const LEVEL_RULES: { points: number; label: string; rule: string }[] = [
  { points: 100, label: "Can do well", rule: "the top level, on your own, with no helping moves seen" },
  { points: 75, label: "Can do", rule: "the top level on your own, with a helping move seen or a check the camera could not see" },
  { points: 50, label: "Partly", rule: "an easier level on your own" },
  { points: 25, label: "Getting started", rule: "a level held with help, or a movement toward the target" },
  { points: 0, label: "Not yet", rule: "no movement toward the target seen yet" },
];

// ---------------------------------------------------------------- the page

export default function AssessmentResults({ report, previous, walking = null, taskResults, onContinue, onHome, completedAt }: AssessmentResultsProps) {
  const still = useStill();
  const uid = `ar${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const rows = taskRows(report);
  const results = byTask(taskResults);
  const total = totalScore(report);
  const scores = { upper_limb: areaScore(report, "upper_limb", walking), hand: areaScore(report, "hand", walking), lower_limb: areaScore(report, "lower_limb", walking) };
  const side = (taskResults ?? []).find(result => result?.side === "left" || result?.side === "right")?.side ?? null;
  const given = completedAt !== undefined ? new Date(completedAt) : null;
  const finished = given && !Number.isNaN(given.getTime()) ? given : completedAtOf(report);
  const since = sinceLastTime(report, previous, walking);
  const due = nextCheckUp(finished);
  const challenges = checkUpChallenges(taskResults);
  const shownTotal = useCountUp(total, still);
  const scored = walking?.status === "scored" ? walking : null;

  return (
    <section className={`ar-page${still ? " is-still" : ""}`} aria-labelledby={`${uid}-title`}>
      <div className="ar-wrap">
        <header className="ar-head ar-rise">
          <p className="ar-eyebrow">Movement check · {shortDate(finished)}</p>
          <h1 id={`${uid}-title`}>Your movement map</h1>
          <p className="ar-lead">Here is what your body showed today. Every number comes from your own movements.</p>
          {report.testing_random === true && <p className="ar-test">Test run with a simulated patient. These numbers are not yours.</p>}
        </header>

        <div className="ar-card ar-hero ar-rise" style={vars({ "--d": "60ms" })}>
          <MovementMap scores={scores} side={side} uid={uid} />
          <div className="ar-hero-score">
            <ScoreRing shown={shownTotal} target={total} label="Daily function score" large />
            <p className="ar-ring-caption">Daily function score</p>
            <ul className="ar-legend" aria-label="Areas">
              {RESULT_AREAS.map(area => {
                const band = scoreBand(scores[area.key]);
                return (
                  <li key={area.key} className={`is-${band}`}>
                    <i aria-hidden="true" />
                    <b>{area.name}</b>
                    <span>{scores[area.key] === null ? "Not measured" : `${scores[area.key]} · ${BAND_WORD[band]}`}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="ar-areas">
          {RESULT_AREAS.map((area, index) => <AreaCard key={area.key} area={area} index={index} score={scores[area.key]} rows={rows} results={results} walking={walking} still={still} />)}
        </div>

        {since && (
          <section className="ar-card ar-since ar-rise" style={vars({ "--d": "520ms" })} aria-labelledby={`${uid}-since`}>
            <h2 id={`${uid}-since`}>Since last time</h2>
            <p className="ar-muted">Compared with your check on {shortDate(since.when)}.</p>
            <ul className="ar-deltas">
              {since.changes.filter(change => change.now !== null).map(change => {
                const delta = deltaText(change.delta);
                const from = change.since ? `since ${shortDate(change.since)}` : "";
                return (
                  <li key={change.key} className={`ar-delta is-${delta?.dir ?? "new"}`}>
                    <span className="ar-delta-name">{change.name}</span>
                    <b aria-hidden="true">{delta ? `${delta.text}${delta.arrow ? ` ${delta.arrow}` : ""}` : "Not measured last time"}</b>
                    {delta && from && <small aria-hidden="true">{from}</small>}
                    <span className="ar-sr">: {delta ? `${delta.say}${from ? ` ${from}` : ""}` : "not measured last time"}</span>
                  </li>
                );
              })}
            </ul>
            {total !== null && since.totals.length >= 2 && <Sparkline values={since.totals} name={since.totalsName} />}
          </section>
        )}

        <section className="ar-card ar-checkup ar-rise" style={vars({ "--d": "600ms" })} aria-labelledby={`${uid}-next`}>
          <h2 id={`${uid}-next`}><CalendarDays size={22} aria-hidden="true" /> Your next check-up</h2>
          <p className="ar-date"><time dateTime={isoDay(due)}>{longDate(due)}</time></p>
          <p className="ar-muted">{REASSESSMENT_CYCLE_DAYS} days after this check.</p>
          {challenges.length > 0 && (
            <>
              <p className="ar-until">Until then, try to:</p>
              <ul className="ar-challenges">{challenges.map(line => <li key={line}>{line}</li>)}</ul>
            </>
          )}
          <p className="ar-comeback">Come back to see your map change.</p>
        </section>

        <details className="ar-card ar-how">
          <summary>How we scored this</summary>
          <h3>Arm and hand</h3>
          <p>Each task climbs levels, easiest first. Its points come from the hardest level you held for the full hold:</p>
          <ul className="ar-rules">
            {LEVEL_RULES.map(rule => <li key={rule.points}><b>{rule.points}</b> <span><strong>{rule.label}:</strong> {rule.rule}.</span></li>)}
          </ul>
          <p>An area's score is the average of its tasks. Your daily function score is the average of the areas measured.</p>
          <h3>Walking</h3>
          <p>From the side-on video, your walking score combines:</p>
          <ul className="ar-rules">
            {WALK_PARTS.map(part => {
              const value = scored?.components?.[part.id];
              return <li key={part.id}><b>{part.weight}%</b> <span><strong>{part.name}</strong>{scored ? (finite(value) ? `: yours ${roundHalfUp(value)} of 100` : ": not measured") : ""}</span></li>;
            })}
          </ul>
          <p>If someone held you while you walked, walking counts at most 50. Speed in metres per second is an estimate from your leg length.</p>
          <p className="ar-disclaimer">These are engineering estimates, not a medical diagnosis.</p>
        </details>

        <div className="ar-actions">
          <button type="button" className="ar-primary" onClick={onContinue}>Continue to Alira <ArrowRight size={18} aria-hidden="true" /></button>
          <button type="button" className="ar-secondary" onClick={onHome}>Go to my home</button>
        </div>
      </div>
    </section>
  );
}
