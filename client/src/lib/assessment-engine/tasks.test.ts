import { describe, expect, it } from "vitest";
import { assessmentPlanFrom } from "../assessment";
import { EXERCISES } from "../exercise-engine/config";
import { HAND_OPEN_TYPICAL } from "../exercise-engine/hand-target";
import { TOUCH_CLOSURE } from "../exercise-engine/pinch-target";
import {
  CAMERA_TASKS, CHEST_DROP, HAND_FULL_MAX, HAND_FULL_MIN_RISE, HAND_LEVEL_SHARE, HAND_STAY_SLACK, OTHER_HAND_ARM, OTHER_HAND_IN_VIEW, PINCH_PARTIAL_SHARE,
  REACH_BAND_SHARE, REACH_LEVEL_HEIGHT, REACH_LEVEL_STEP, REACH_RADIUS_SHARE, chestPoint, handLevelContact, handLevelGoal, pinchLevelGoal, reachLevelGap,
  reachLevelRadius, reachLevelY, startLevel, towardTarget,
} from "./tasks";

const MOVEMENTS = ["none", "little_help", "tires", "fairly_well", undefined, 42];

describe("the camera tasks", () => {
  it("run the approved exercises with their levels, easiest first", () => {
    expect(Object.fromEntries(Object.values(CAMERA_TASKS).map(spec => [spec.taskId, spec.exerciseId]))).toEqual({ T1: "ex_reach", T3: "ex_h2m", H4: "ex_handopen", H3: "ex_pinch" });
    expect(CAMERA_TASKS.T1.levels.map(level => level.id)).toEqual(["r80", "r120", "r160"]);
    expect(CAMERA_TASKS.T3.levels.map(level => level.id)).toEqual(["chest", "mouth"]);
    expect(CAMERA_TASKS.H4.levels.map(level => level.id)).toEqual(["partial", "full"]);
    expect(CAMERA_TASKS.H3.levels.map(level => level.id)).toEqual(["partial", "full"]);
    for (const spec of Object.values(CAMERA_TASKS)) {
      expect(EXERCISES[spec.exerciseId]).toBeDefined();
      for (const level of spec.levels) expect(level.label && level.say).toBeTruthy();
    }
  });

  it("keep only the approved posture checks, each once", () => {
    const ids = (taskId: keyof typeof CAMERA_TASKS) => CAMERA_TASKS[taskId].compensations.map(rule => rule.id);
    expect(ids("T1")).toEqual(["trunk_lean", "shoulder_hike", "other_hand"]);
    expect(ids("T3")).toEqual(["head_forward", "trunk_forward", "shoulder_hike", "other_hand"]);
    expect(ids("H4")).toEqual(["wrist_bend", "forearm_turn", "trunk_forward", "shoulder_hike", "other_hand"]);
    expect(ids("H3")).toEqual(["trunk_forward", "shoulder_hike", "forearm_turn", "other_hand", "wrist_bend", "mass_flexion"]);
    for (const spec of Object.values(CAMERA_TASKS)) expect(new Set(spec.compensations.map(rule => rule.id)).size).toBe(spec.compensations.length);
  });

  it("reuse the exercises' own rules, with the new other-hand rule on the seated arm tasks", () => {
    expect(CAMERA_TASKS.T1.compensations[0]).toBe(EXERCISES.ex_reach.compensations.find(rule => rule.id === "trunk_lean"));
    expect(CAMERA_TASKS.T1.compensations[2]).toBe(OTHER_HAND_ARM);
    expect(CAMERA_TASKS.T3.compensations[3]).toBe(OTHER_HAND_ARM);
    expect(OTHER_HAND_ARM).toMatchObject({ metric: "other_hand_arm", thresholdDeg: 1, minFrames: 4, minConsecutiveMs: 600 });
    // Hand opening borrows the pinch's camera rule for the other hand, on every step.
    const other = CAMERA_TASKS.H4.compensations.find(rule => rule.id === "other_hand")!;
    expect(other).toMatchObject({ metric: "other_hand_near", thresholdDeg: 1, minConsecutiveMs: 500, steps: undefined });
    // Pinch judges its checks on the first finger's pinch only.
    for (const rule of CAMERA_TASKS.H3.compensations) expect(rule.steps).toEqual([0]);
    // The exercises' own lists are untouched.
    expect(EXERCISES.ex_pinch.compensations.find(rule => rule.id === "other_hand")!.steps).toEqual([0, 2]);
  });

  it("pinch runs the first finger only: pinch, then let go", () => {
    const cycle = CAMERA_TASKS.H3.cycle!;
    expect(cycle).toHaveLength(2);
    expect(cycle[0]).toMatchObject({ kind: "reach", finger: 0, gate: ["pinch_index"], readyGate: true });
    expect(cycle[1].kind).toBe("return");
    expect(CAMERA_TASKS.T1.cycle).toBeUndefined();
  });

  it("every task card says how to sit and what it asks", () => {
    for (const spec of Object.values(CAMERA_TASKS)) {
      expect(spec.name).toBeTruthy();
      expect(spec.ask).toMatch(/\.$/);
      expect(spec.setup).toMatch(/\.$/);
    }
    // The seated arm tasks' other-hand check needs the other hand and thigh in view, so their set-up asks for both.
    for (const id of ["T1", "T3"] as const) expect(CAMERA_TASKS[id].setup).toMatch(/both hands.*both thighs/);
    expect(OTHER_HAND_IN_VIEW).toMatch(/other hand.*camera can see it\.$/);
  });

  it("the movement bar names the way back to rest for each task, never the level's target", () => {
    expect(Object.fromEntries(Object.values(CAMERA_TASKS).map(spec => [spec.taskId, spec.back]))).toEqual({ T1: "Back to your lap", T3: "Back to your lap", H4: "Relax your hand", H3: "Let go" });
  });
});

describe("start levels from the survey", () => {
  it("reach: a little help starts at chest height, tiring above the shoulder, otherwise overhead", () => {
    expect(startLevel("T1", "little_help")).toBe(0);
    expect(startLevel("T1", "tires")).toBe(1);
    expect(startLevel("T1", "fairly_well")).toBe(2);
    expect(startLevel("T1", undefined)).toBe(2);
  });

  it("the two-level tasks start easy with a little help, otherwise at the full level", () => {
    for (const taskId of ["T3", "H4", "H3"] as const) {
      expect(startLevel(taskId, "little_help")).toBe(0);
      expect(startLevel(taskId, "tires")).toBe(1);
      expect(startLevel(taskId, "fairly_well")).toBe(1);
      expect(startLevel(taskId, null)).toBe(1);
    }
  });

  it("matches the start points the survey already gives the reach and hand to mouth", () => {
    for (const movement of MOVEMENTS) {
      const plan = assessmentPlanFrom({ arm_hand_movement: movement as never });
      expect(CAMERA_TASKS.T1.levels[startLevel("T1", movement)].id).toBe(plan.startRung.T1);
      expect(CAMERA_TASKS.T3.levels[startLevel("T3", movement)].id).toBe(plan.startRung.T3);
    }
  });
});

describe("level goals", () => {
  it("reach circles sit 0.8, 1.2 and 1.6 of the lap-to-shoulder height above the lap", () => {
    expect(REACH_LEVEL_HEIGHT).toEqual({ r80: 0.8, r120: 1.2, r160: 1.6 });
    expect(reachLevelY("r80", 0.8, 0.4)).toBeCloseTo(0.48, 10);
    expect(reachLevelY("r120", 0.8, 0.4)).toBeCloseTo(0.32, 10);
    expect(reachLevelY("r160", 0.8, 0.4)).toBeCloseTo(0.16, 10);
    // An unknown level sits at shoulder height.
    expect(reachLevelY("r999", 0.8, 0.4)).toBeCloseTo(0.4, 10);
  });

  it("the chest point drops from the shoulders' midpoint toward the hips' midpoint", () => {
    const point = chestPoint({ x: 0.4, y: 0.3 }, { x: 0.6, y: 0.34 }, { x: 0.42, y: 0.8 }, { x: 0.58, y: 0.84 });
    expect(point.x).toBeCloseTo(0.5, 10);
    expect(point.y).toBeCloseTo(0.32 + CHEST_DROP * (0.82 - 0.32), 10);
  });

  it("hand opening levels are shares of the room from the relaxed hand to a typical open hand", () => {
    const rest = 0.4, room = HAND_OPEN_TYPICAL - rest;
    expect(HAND_LEVEL_SHARE).toEqual({ partial: 0.45, full: 0.75 });
    expect(handLevelGoal("partial", rest)).toBeCloseTo(rest + HAND_LEVEL_SHARE.partial * room, 10);
    expect(handLevelGoal("full", rest)).toBeCloseTo(rest + HAND_LEVEL_SHARE.full * room, 10);
    expect(handLevelGoal("full", rest)).toBeGreaterThan(handLevelGoal("partial", rest));
    // An unknown level is the full one.
    expect(handLevelGoal("other", rest)).toBe(handLevelGoal("full", rest));
  });

  it("hand opening's wide ring sits inside an ordinary open hand (about 1.0 palm lengths), the inner ring clearly below it", () => {
    for (let rest = 0.2; rest <= 0.8 + 1e-9; rest += 0.05) {
      const full = handLevelGoal("full", rest), partial = handLevelGoal("partial", rest);
      expect(full, `rest ${rest}`).toBeLessThanOrEqual(HAND_FULL_MAX);
      expect(full, `rest ${rest}`).toBeLessThan(1 - HAND_STAY_SLACK);
      expect(full - rest, `rest ${rest}`).toBeGreaterThanOrEqual(HAND_FULL_MIN_RISE);
      // The inner ring keeps its share of the way to the wide one: more than the hold's stay-slack below it.
      expect(partial - rest, `rest ${rest}`).toBeCloseTo((HAND_LEVEL_SHARE.partial / HAND_LEVEL_SHARE.full) * (full - rest), 10);
      expect(full - partial, `rest ${rest}`).toBeGreaterThan(HAND_STAY_SLACK);
    }
    // A loosely resting hand: the wide ring is capped, not at the typical open hand's 1.0 or beyond.
    expect(handLevelGoal("full", 0.7)).toBe(HAND_FULL_MAX);
    expect(handLevelGoal("full", 0.45)).toBeCloseTo(0.9, 10);
    // A hand that rests already open still has its wide ring a little beyond it.
    expect(handLevelGoal("full", 1.2)).toBeCloseTo(1.2 + HAND_FULL_MIN_RISE, 10);
  });

  it("hand opening's ring holds once reached until the fingertips close a little inside it", () => {
    const ring = 0.9;
    expect(handLevelContact(ring, ring, false)).toBe(true);
    expect(handLevelContact(ring - 0.01, ring, false)).toBe(false);
    // On: jitter just inside the ring keeps it on; closing past the stay-slack lets go.
    expect(handLevelContact(ring - 0.04, ring, true)).toBe(true);
    expect(handLevelContact(ring - HAND_STAY_SLACK - 0.01, ring, true)).toBe(false);
    expect(HAND_STAY_SLACK).toBe(0.05);
  });

  it("reach circles never overlap: the radius stays under half the gap between levels", () => {
    const heights = Object.values(REACH_LEVEL_HEIGHT).sort((a, b) => a - b);
    expect(Math.min(...heights.slice(1).map((h, i) => h - heights[i]))).toBeCloseTo(REACH_LEVEL_STEP, 10);
    expect(REACH_RADIUS_SHARE).toBeLessThan(0.5);
    // Typical laptop framing: lap 0.37 frame heights below the shoulder, the reach's own circle 0.12.
    const lapY = 0.82, shoulderY = 0.45, radius = reachLevelRadius(0.12, lapY, shoulderY);
    expect(radius).toBeCloseTo(REACH_RADIUS_SHARE * REACH_LEVEL_STEP * 0.37, 10);
    const gap = reachLevelY("r80", lapY, shoulderY) - reachLevelY("r120", lapY, shoulderY);
    expect(2 * radius).toBeLessThan(gap);
    // A circle already small enough keeps its size.
    expect(reachLevelRadius(0.05, lapY, shoulderY)).toBe(0.05);
  });

  it("a reach level counts only with the wrist inside its circle and up at its height", () => {
    const lapY = 0.82, shoulderY = 0.45, x = 0.4, aspect = 4 / 3;
    const radius = reachLevelRadius(0.12, lapY, shoulderY);
    const above = { x, y: reachLevelY("r120", lapY, shoulderY) }, overhead = { x, y: reachLevelY("r160", lapY, shoulderY) };
    // At the centre: on it.
    expect(reachLevelGap(above, above, radius, aspect)).toBe(0);
    // Within the height band below the centre: still on it; lower in the circle: not yet.
    expect(reachLevelGap({ x, y: above.y + (REACH_BAND_SHARE - 0.05) * radius }, above, radius, aspect)).toBe(0);
    expect(reachLevelGap({ x, y: above.y + (REACH_BAND_SHARE + 0.1) * radius }, above, radius, aspect)).toBeGreaterThan(0);
    // The finding's cases: a wrist at shoulder height (or just below) is not "Above your shoulder", and a wrist a little
    // above the shoulder is not "Overhead".
    for (const y of [shoulderY, shoulderY + 0.05]) expect(reachLevelGap({ x, y }, above, radius, aspect)).toBeGreaterThan(0);
    for (const y of [shoulderY - 0.1, shoulderY - 0.17]) expect(reachLevelGap({ x, y }, overhead, radius, aspect)).toBeGreaterThan(0);
    // Outside the circle across: the distance outside it.
    expect(reachLevelGap({ x: x + 0.3 / aspect, y: above.y }, above, radius, aspect)).toBeCloseTo(0.3 - radius, 10);
  });

  it("the bars measure toward a target from where the movement started", () => {
    expect(towardTarget(0, 0.4)).toBe(1);
    expect(towardTarget(-0.1, 0.4)).toBe(1);
    expect(towardTarget(0.1, 0.4)).toBeCloseTo(0.75, 10);
    expect(towardTarget(0.5, 0.4)).toBe(0);
    // Just short of it is never shown as on it.
    expect(towardTarget(1e-6, 0.4)).toBe(0.98);
    // A start already near the target is measured against a small fixed distance.
    expect(towardTarget(0.025, 0.01)).toBeCloseTo(0.5, 10);
  });

  it("pinch: partial is part of the way to touching, full is tip to tip", () => {
    expect(pinchLevelGoal("full", 20)).toBe(TOUCH_CLOSURE);
    expect(pinchLevelGoal("partial", 20)).toBeCloseTo(20 + PINCH_PARTIAL_SHARE * (TOUCH_CLOSURE - 20), 10);
    expect(pinchLevelGoal("partial", 20)).toBeLessThan(TOUCH_CLOSURE);
    // A resting thumb already at touching leaves only the full goal.
    expect(pinchLevelGoal("partial", TOUCH_CLOSURE + 5)).toBe(TOUCH_CLOSURE);
  });
});
