// The movement check's camera tasks on the exercise engine: which exercise runs each, its levels (easiest first), where
// each starts, and the posture checks the patient approved for it (the exercises' own rules, plus the other hand for the
// seated arm tasks). Engineering defaults, to be reviewed by a clinician.

import { EXERCISES, type Compensation, type CycleStep } from "../exercise-engine/config";
import { HAND_OPEN_TYPICAL } from "../exercise-engine/hand-target";
import { TOUCH_CLOSURE } from "../exercise-engine/pinch-target";
import type { CameraTaskId, LevelSpec } from "./types";

export type CameraTaskSpec = {
  taskId: CameraTaskId;
  exerciseId: string;
  /** The patient's name for the task, and what it asks, in a sentence. */
  name: string;
  ask: string;
  levels: LevelSpec[];
  /** The posture checks for this task (replace the exercise's own list in assessment mode). */
  compensations: Compensation[];
  /** The repetition's steps in assessment mode (omitted: the exercise's own). */
  cycle?: CycleStep[];
  /** How to sit and where the camera goes, for the task card. */
  setup: string;
  /** The movement bar's label while the hand goes back to rest after each try (the lap, the relaxed hand, letting go). */
  back: string;
};

/** The reach's circles: this share of the way from the lap up to the shoulder, measured from the lap (1 = shoulder height). */
export const REACH_LEVEL_HEIGHT: Record<string, number> = { r80: 0.8, r120: 1.2, r160: 1.6 };
/** The gap between neighbouring reach circles, as a share of the lap-to-shoulder height (REACH_LEVEL_HEIGHT's steps). */
export const REACH_LEVEL_STEP = 0.4;
/** A reach circle's radius is at most this share of that gap, so neighbouring levels' circles never overlap. */
export const REACH_RADIUS_SHARE = 0.45;
/** The wrist counts at a reach level only up at its height: at most this share of the radius below the circle's centre. */
export const REACH_BAND_SHARE = 0.35;
/** The chest target sits this share of the way down from the shoulders' midpoint to the hips' midpoint. */
export const CHEST_DROP = 0.28;
/** Hand opening's levels: this share of the room from the relaxed hand to a typical open hand (at least 0.25 palm lengths). */
export const HAND_LEVEL_SHARE: Record<string, number> = { partial: 0.45, full: 0.75 };
/** The wide ring is never beyond this openness (palm lengths): an ordinary open hand reads about 1.0, so it sits inside it. */
export const HAND_FULL_MAX = 0.93;
/** ...and always at least this far beyond the relaxed hand. */
export const HAND_FULL_MIN_RISE = 0.1;
/** Once on the opening ring, the fingertips stay on it until they close this far inside it (palm lengths), as the pinch's stay-slack. */
export const HAND_STAY_SLACK = 0.05;
/** Pinch's partial level: this share of the way from the resting thumb to touching; full is touching, tip to tip. */
export const PINCH_PARTIAL_SHARE = 0.6;

/** Other hand helping, for the seated arm tasks: the other hand lifted to the affected forearm (other-hand.ts). */
export const OTHER_HAND_ARM: Compensation = {
  id: "other_hand", label: "other hand helping", metric: "other_hand_arm", thresholdDeg: 1, minFrames: 4, minRatio: 0, minConsecutiveMs: 600,
  correction: "Keep your other hand resting on your lap.",
};
/** The seated arm tasks' set-up row and review note when the other hand (or the top of the other thigh) was out of view. */
export const OTHER_HAND_IN_VIEW = "Keep your other hand resting on your lap where the camera can see it.";
export const OTHER_THIGH_IN_VIEW = "Move the camera back a little so I can see the top of both thighs.";

const comps = (exerciseId: string, ids: string[]) => ids.map(id => EXERCISES[exerciseId].compensations.find(rule => rule.id === id)!).filter(Boolean);

/** The pinch's assessment cycle: the first finger only (pinch, then let go). */
const pinchCycle = (): CycleStep[] => EXERCISES.ex_pinch.cycle.slice(0, 2);

export const CAMERA_TASKS: Record<CameraTaskId, CameraTaskSpec> = {
  T1: {
    taskId: "T1", exerciseId: "ex_reach", name: "Reach", ask: "Reach your hand up to a circle and hold it there.",
    levels: [
      { id: "r80", label: "Chest height", say: "the circle at chest height" },
      { id: "r120", label: "Above your shoulder", say: "the circle above your shoulder" },
      { id: "r160", label: "Overhead", say: "the circle overhead" },
    ],
    compensations: [...comps("ex_reach", ["trunk_lean", "shoulder_hike"]), OTHER_HAND_ARM],
    // The other-hand check needs the other hand and the top of the other thigh in view too (other-hand.ts).
    setup: "Sit upright with both hands resting on your thighs. Place the camera in front of you so your face, both shoulders, both hands and the tops of both thighs are in view, with room above your head.",
    back: "Back to your lap",
  },
  T3: {
    taskId: "T3", exerciseId: "ex_h2m", name: "Hand to mouth", ask: "Bring your hand to your chest or your mouth and hold it there.",
    levels: [
      { id: "chest", label: "Hand to your chest", say: "your chest" },
      { id: "mouth", label: "Hand to your mouth", say: "your mouth" },
    ],
    compensations: [...comps("ex_h2m", ["head_forward", "trunk_forward", "shoulder_hike"]), OTHER_HAND_ARM],
    setup: "Sit upright with both hands resting on your thighs. Keep your face, both shoulders, both hands and the tops of both thighs in view.",
    back: "Back to your lap",
  },
  H4: {
    taskId: "H4", exerciseId: "ex_handopen", name: "Hand opening", ask: "Open your fingers out to a ring and hold.",
    levels: [
      { id: "partial", label: "Fingers part open", say: "the inner ring" },
      { id: "full", label: "Fingers wide open", say: "the wide ring" },
    ],
    compensations: [
      ...comps("ex_handopen", ["wrist_bend", "forearm_turn", "trunk_forward", "shoulder_hike"]),
      { ...EXERCISES.ex_pinch.compensations.find(rule => rule.id === "other_hand")!, steps: undefined, correction: "Keep your other hand resting on your lap." },
    ],
    setup: "Rest your affected elbow on an armrest or a table and hold your hand up beside your body at chest height, palm to the camera.",
    back: "Relax your hand",
  },
  H3: {
    taskId: "H3", exerciseId: "ex_pinch", name: "Pinch", ask: "Bring your thumb to your first finger and hold.",
    levels: [
      { id: "partial", label: "Thumb close to finger", say: "close to your first finger" },
      { id: "full", label: "Tip to tip", say: "tip to tip with your first finger" },
    ],
    compensations: comps("ex_pinch", ["trunk_forward", "shoulder_hike", "forearm_turn", "other_hand", "wrist_bend", "mass_flexion"]).map(rule => ({ ...rule, steps: [0] })),
    cycle: pinchCycle(),
    setup: "Rest your affected elbow on an armrest or a table and hold your hand up beside your body at chest height, palm to the camera, thumb a little away from your first finger.",
    back: "Let go",
  },
};

/** Where each task starts, from the survey: easier for a patient who moves with a little help. */
export function startLevel(taskId: CameraTaskId, movement: unknown): number {
  const spec = CAMERA_TASKS[taskId];
  const top = spec.levels.length - 1;
  if (taskId === "T1") return movement === "little_help" ? 0 : movement === "tires" ? 1 : top;
  return movement === "little_help" ? 0 : top;
}

/**
 * Hand opening's goal openness (palm lengths) at a level, from the relaxed hand learned at set-up. The wide ring sits
 * inside an ordinary open hand (at most HAND_FULL_MAX), so jitter at a full opening cannot keep dropping it; the inner
 * ring keeps its share of the way to the wide one, so it stays clearly below it however open the hand rests.
 */
export function handLevelGoal(levelId: string, rest: number): number {
  const room = Math.max(0.25, HAND_OPEN_TYPICAL - rest);
  const full = Math.max(rest + HAND_FULL_MIN_RISE, Math.min(HAND_FULL_MAX, rest + HAND_LEVEL_SHARE.full * room));
  return levelId === "partial" ? rest + (HAND_LEVEL_SHARE.partial / HAND_LEVEL_SHARE.full) * (full - rest) : full;
}

/** Whether the fingertips are on hand opening's ring: out at it to start, and once on, until they close HAND_STAY_SLACK inside it. */
export const handLevelContact = (openness: number, ring: number, on: boolean) => openness >= ring - (on ? HAND_STAY_SLACK : 0);

/** Pinch's goal closure (0-100, 75 touching) at a level, from the resting thumb learned at set-up. */
export function pinchLevelGoal(levelId: string, rest: number): number {
  if (levelId !== "partial" || rest >= TOUCH_CLOSURE) return TOUCH_CLOSURE;
  return rest + PINCH_PARTIAL_SHARE * (TOUCH_CLOSURE - rest);
}

/** The reach circle's centre height (frame heights) at a level, from the lap and the shoulder. */
export function reachLevelY(levelId: string, lapY: number, shoulderY: number): number {
  return lapY - (REACH_LEVEL_HEIGHT[levelId] ?? 1) * (lapY - shoulderY);
}

/** The reach circle's radius (frame heights): the reach's own, but never so large that neighbouring levels' circles overlap. */
export function reachLevelRadius(radius: number, lapY: number, shoulderY: number): number {
  return Math.min(radius, REACH_RADIUS_SHARE * REACH_LEVEL_STEP * Math.abs(lapY - shoulderY));
}

/**
 * How far the wrist still is from counting at a reach level (frame heights, x scaled by the aspect): 0 on it (inside the
 * circle and up at the level's height band), else the larger of the distance outside the circle and the rise still needed.
 */
export function reachLevelGap(wrist: { x: number; y: number }, centre: { x: number; y: number }, radius: number, aspect: number): number {
  const distance = Math.hypot((wrist.x - centre.x) * aspect, wrist.y - centre.y);
  return Math.max(0, distance - radius, wrist.y - (centre.y + REACH_BAND_SHARE * radius));
}

/** How far toward a target from where the movement started (1 on it, at most 0.98 short of it): the bars' shared measure. */
export function towardTarget(gap: number, startGap: number): number {
  return gap <= 0 ? 1 : Math.max(0, Math.min(0.98, 1 - gap / Math.max(0.05, startGap)));
}

/** The chest target from the shoulders and hips (raw image coordinates). */
export function chestPoint(shoulder: { x: number; y: number }, shoulderOther: { x: number; y: number }, hip: { x: number; y: number }, hipOther: { x: number; y: number }) {
  const sx = (shoulder.x + shoulderOther.x) / 2, sy = (shoulder.y + shoulderOther.y) / 2, hy = (hip.y + hipOther.y) / 2;
  return { x: sx, y: sy + CHEST_DROP * (hy - sy) };
}
