import { describe, expect, it } from "vitest";
import {
  buildFunctionScore, LEVEL_LABELS, LEVEL_POINTS, notRunTaskScore, PREREQUISITE_LABEL, roundHalfUp, taskScore, walkingScore,
} from "./function-score";
import { CAMERA_TASKS } from "./tasks";
import type { AssessmentTaskResult, AttemptRecord, CameraTaskId, CompStatus, GaitResult, NativeTaskScore } from "./types";

const ids = (taskId: CameraTaskId) => CAMERA_TASKS[taskId].levels.map(level => level.id);
const checks = (taskId: CameraTaskId, status: CompStatus = "not_detected", over: Record<string, CompStatus> = {}) =>
  ({ ...Object.fromEntries(CAMERA_TASKS[taskId].compensations.map(rule => [rule.id, status])), ...over });
const attempt = (taskId: CameraTaskId, levelId: string, completed: boolean, over: Partial<AttemptRecord> = {}): AttemptRecord => ({
  level: ids(taskId).indexOf(levelId), levelId, assist: null, completed, touched: completed, peakProgress: completed ? 1 : 0.5,
  compensations: checks(taskId), durationMs: 4000, ...over,
});
const result = (taskId: CameraTaskId, attempts: AttemptRecord[], over: Partial<AssessmentTaskResult> = {}): AssessmentTaskResult => ({
  taskId, exerciseId: CAMERA_TASKS[taskId].exerciseId, levelIds: ids(taskId), startLevel: ids(taskId).length - 1,
  tryOut: { completed: true, peakProgress: 1 }, attempts, movementSeen: attempts.some(item => item.peakProgress >= 0.3),
  stoppedBy: "top_reached", measured: true, side: "right", insights: {}, ...over,
});
const scored = (score: number, areaScore = score, assist: "holds" | "nearby" | "none" = "none"): GaitResult => ({
  status: "scored", score, areaScore, assist, components: {},
  metrics: { speedLegPerS: 1, speedMpsEstimate: 0.85, cadence: 95, steps: 12, passes: 2, seenShare: 0.9, sideOnRatio: 0.3 },
});

describe("rounding", () => {
  it("rounds once, half up, from the unrounded value", () => {
    expect(roundHalfUp(62.5)).toBe(63);
    expect(roundHalfUp(56.25)).toBe(56);
    expect(roundHalfUp(74.5)).toBe(75);
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(62.4999)).toBe(62);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(0)).toBe(0);
  });

  it("treats float noise as the decimal value, as the backend's Decimal(str(x)) does", () => {
    expect(roundHalfUp(62.49999999999999)).toBe(63);
    expect(roundHalfUp((0.1 + 0.2) * 100 + 0.2)).toBe(30);
  });

  it("is null without a number", () => {
    expect(roundHalfUp(null)).toBeNull();
    expect(roundHalfUp(undefined)).toBeNull();
    expect(roundHalfUp(Number.NaN)).toBeNull();
    expect(roundHalfUp(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("a camera task's level", () => {
  it("the full level held alone with every check clear is 4, Can do well", () => {
    const row = taskScore(result("T1", [attempt("T1", "r160", true)]));
    expect(row).toMatchObject({
      task_id: "T1", task_label: "Reach", domain: "upper_limb", level: 4, points: 100, label: "Can do well", reason: "full_rung_alone_clean",
      measured: true, best_alone: "r160", best_assisted: null, best_level: "Overhead", assisted: false, clinical_measure: false,
      next_step: "Next: use this movement in everyday tasks.",
    });
    expect(row.compensations).toEqual({ trunk_lean: "not_detected", shoulder_hike: "not_detected", other_hand: "not_detected" });
  });

  it("the full level held alone with a check detected is 3, with what to practise without", () => {
    const row = taskScore(result("T1", [attempt("T1", "r160", true, { compensations: checks("T1", "not_detected", { shoulder_hike: "detected" }) })]));
    expect(row).toMatchObject({ level: 3, points: 75, label: "Can do", reason: "full_rung_alone_compensated" });
    expect(row.next_step).toBe("Next: the overhead circle without lifting your shoulder.");
    expect(row.compensations?.shoulder_hike).toBe("detected");
    const two = taskScore(result("T1", [attempt("T1", "r160", true, { compensations: checks("T1", "not_detected", { trunk_lean: "detected", other_hand: "detected" }) })]));
    expect(two.next_step).toBe("Next: the overhead circle without leaning forward or your other hand helping.");
  });

  it("lists several checks with commas and a final or", () => {
    const row = taskScore(result("H4", [attempt("H4", "full", true, { compensations: checks("H4", "detected") })]));
    expect(row.next_step).toBe("Next: opening your fingers wide without bending your wrist, turning your palm, leaning forward, lifting your shoulder or your other hand helping.");
  });

  it("a check not seen (or missing) on the full level is 3: full marks need posture in view", () => {
    const unseen = taskScore(result("T1", [attempt("T1", "r160", true, { compensations: { trunk_lean: "not_detected", shoulder_hike: "not_detected" } })]));
    expect(unseen).toMatchObject({ level: 3, reason: "full_rung_alone_posture_unobserved", next_step: "Next: the overhead circle again, with your posture clearly in view." });
    expect(unseen.compensations?.other_hand).toBe("not_measured");
    const unknown = taskScore(result("T1", [attempt("T1", "r160", true, { compensations: { ...checks("T1"), shoulder_hike: "maybe" as CompStatus } })]));
    expect(unknown.compensations?.shoulder_hike).toBe("not_measured");
    expect(unknown.level).toBe(3);
  });

  it("a later clean completion of the full level shows the higher ability", () => {
    const row = taskScore(result("T3", [
      attempt("T3", "mouth", true, { compensations: checks("T3", "not_detected", { head_forward: "detected" }) }),
      attempt("T3", "mouth", true),
    ]));
    expect(row.level).toBe(4);
    expect(row.compensations?.head_forward).toBe("not_detected");
  });

  it("an easier level held alone is 2, Partly, and the next step is one level up", () => {
    // The spec's example: T1 held at r120, then the overhead circle was not held.
    const row = taskScore(result("T1", [attempt("T1", "r120", true), attempt("T1", "r160", false)], { startLevel: 1, stoppedBy: "reversal" }));
    expect(row).toMatchObject({ level: 2, points: 50, label: "Partly", reason: "easier_rung_alone", best_alone: "r120", best_level: "Above your shoulder" });
    expect(row.next_step).toBe("Next: the overhead circle.");
    const low = taskScore(result("T1", [attempt("T1", "r160", false), attempt("T1", "r120", false), attempt("T1", "r80", true)], { stoppedBy: "reversal" }));
    expect(low).toMatchObject({ level: 2, best_alone: "r80", best_level: "Chest height", next_step: "Next: the circle above your shoulder." });
    expect(taskScore(result("H3", [attempt("H3", "full", false), attempt("H3", "partial", true)])).next_step).toBe("Next: your thumb and first finger tip to tip.");
    expect(taskScore(result("T3", [attempt("T3", "chest", true)])).next_step).toBe("Next: your hand to your mouth.");
  });

  it("an easier level alone outranks a harder level held with help", () => {
    const row = taskScore(result("H4", [attempt("H4", "partial", true), attempt("H4", "full", true, { assist: "helper" })]));
    expect(row).toMatchObject({ level: 2, best_alone: "partial", best_assisted: "full", assisted: false });
  });

  it("a level held with help is 1, Getting started", () => {
    const row = taskScore(result("T1", [attempt("T1", "r80", false), attempt("T1", "r80", true, { assist: "helper" })], { stoppedBy: "lowest_failed" }));
    expect(row).toMatchObject({ level: 1, points: 25, label: "Getting started", reason: "assisted_movement", assisted: true, best_alone: null, best_assisted: "r80" });
    expect(row.best_level).toBeUndefined();
    expect(row.next_step).toBe("Next: the circle at chest height on your own.");
  });

  it("movement seen without a level held is 1; no movement is 0, Not yet", () => {
    const moved = taskScore(result("H4", [attempt("H4", "partial", false, { touched: true, peakProgress: 0.6 })], { movementSeen: true, stoppedBy: "help_declined" }));
    expect(moved).toMatchObject({ level: 1, reason: "movement_seen", assisted: false, next_step: "Next: small, supported movements, a little further each time." });
    expect(moved.compensations).toBeUndefined();
    const still = taskScore(result("H4", [attempt("H4", "partial", false, { peakProgress: 0.05 })], { movementSeen: false, stoppedBy: "help_declined" }));
    expect(still).toMatchObject({ level: 0, points: 0, label: "Not yet", reason: "no_movement_seen", next_step: "Next: gentle, supported movement." });
    // Reached but not held is not a completion.
    expect(taskScore(result("T3", [attempt("T3", "chest", false, { touched: true, peakProgress: 1 })], { movementSeen: true })).level).toBe(1);
  });

  it("not measured is null, Not measured, and never scored", () => {
    for (const row of [
      taskScore(result("T1", [], { measured: false, stoppedBy: "not_measured", movementSeen: true })),
      taskScore(result("T3", [attempt("T3", "mouth", true)], { stoppedBy: "not_measured" })),
      taskScore(result("H4", [attempt("H4", "full", true)], { measured: false })),
    ]) {
      expect(row).toMatchObject({ level: null, points: null, label: "Not measured", measured: false, reason: "tracking_unavailable" });
      expect(row.next_step).toMatch(/^Next: /);
    }
  });

  it("a level the task does not have is unreadable evidence, not a guess", () => {
    const row = taskScore(result("T1", [attempt("T1", "r100", true)]));
    expect(row).toMatchObject({ level: null, points: null, reason: "invalid_attempt_evidence" });
  });

  it("pinch waiting for hand opening (the page's own skip) is level 0 without an attempt", () => {
    expect(notRunTaskScore("H3", "prerequisite")).toMatchObject({
      task_id: "H3", level: 0, points: 0, label: PREREQUISITE_LABEL, reason: "prerequisite_not_met", measured: true, next_step: "Next: hand opening first, then pinch.",
    });
    expect(PREREQUISITE_LABEL).toBe("Not yet: comes after hand opening");
  });

  it("a task skipped inside the runner before any attempt is Not assessed, pinch included: never level 0", () => {
    for (const taskId of ["T1", "T3", "H4", "H3"] as CameraTaskId[]) {
      const row = taskScore(result(taskId, [], { stoppedBy: "skipped", measured: false, movementSeen: false }));
      expect(row).toMatchObject({ task_id: taskId, level: null, points: null, label: "Not assessed", reason: "task_skipped", measured: false });
    }
    // Movement in the try-out is not an attempt; a skip with attempts the camera could not measure is not assessed either.
    expect(taskScore(result("H3", [], { stoppedBy: "skipped", measured: false, movementSeen: true })).label).toBe("Not assessed");
    expect(taskScore(result("H4", [attempt("H4", "partial", true)], { stoppedBy: "skipped", measured: false })).label).toBe("Not assessed");
  });

  it("attempts made before a skip inside the runner still count", () => {
    // Pinch: the partial level held, then the palm was not ready for the full level and the patient chose Skip.
    const pinch = taskScore(result("H3", [attempt("H3", "partial", true)], { stoppedBy: "skipped" }));
    expect(pinch).toMatchObject({ level: 2, points: 50, label: "Partly", reason: "easier_rung_alone", best_alone: "partial", measured: true, next_step: "Next: your thumb and first finger tip to tip." });
    // Hand opening keeps the level it held, instead of becoming Not assessed.
    expect(taskScore(result("H4", [attempt("H4", "partial", true), attempt("H4", "full", false)], { stoppedBy: "skipped" }))).toMatchObject({ level: 2, label: "Partly", best_alone: "partial" });
    expect(taskScore(result("H4", [attempt("H4", "full", true)], { stoppedBy: "skipped" }))).toMatchObject({ level: 4, reason: "full_rung_alone_clean" });
    expect(taskScore(result("T1", [attempt("T1", "r80", false, { touched: true, peakProgress: 0.6 })], { stoppedBy: "skipped", movementSeen: true }))).toMatchObject({ level: 1, reason: "movement_seen" });
  });

  it("another task skipped is Not assessed; a missing one is Not measured", () => {
    expect(taskScore(result("T3", [], { stoppedBy: "skipped" }))).toMatchObject({ level: null, points: null, label: "Not assessed", reason: "task_skipped" });
    expect(notRunTaskScore("T1", "skipped")).toMatchObject({ task_id: "T1", level: null, points: null, label: "Not assessed", next_step: "Next: try this task at your next check-up." });
    expect(notRunTaskScore("H4", "missing")).toMatchObject({ level: null, points: null, label: "Not measured", reason: "task_missing" });
  });

  it("uses each level's points and label", () => {
    expect(LEVEL_POINTS).toEqual([0, 25, 50, 75, 100]);
    expect(LEVEL_LABELS).toEqual(["Not yet", "Getting started", "Partly", "Can do", "Can do well"]);
  });

  it("never puts a number in a patient sentence", () => {
    const rows = [
      taskScore(result("T1", [attempt("T1", "r160", true)])),
      taskScore(result("T1", [attempt("T1", "r120", true), attempt("T1", "r160", false)])),
      taskScore(result("H3", [], { stoppedBy: "skipped" })), notRunTaskScore("H3", "prerequisite"),
      walkingScore(scored(61.2)), walkingScore(null),
    ];
    for (const row of rows) {
      expect(row.label).not.toMatch(/\d/);
      expect(row.next_step ?? "").not.toMatch(/\d/);
    }
  });
});

describe("walking", () => {
  it("keeps the walking area's score unrounded, without a level", () => {
    expect(walkingScore(scored(67.456))).toMatchObject({ task_id: "L6", task_label: "Walking", domain: "lower_limb", points: 67.456, level: null, label: "Walking score", measured: true, assisted: false });
  });

  it("with someone holding the patient, the capped area score and a with-help label", () => {
    expect(walkingScore(scored(80, 50, "holds"))).toMatchObject({ points: 50, label: "Walking score (with help)", assisted: true });
    expect(walkingScore(scored(80, 80, "nearby")).label).toBe("Walking score");
  });

  it("skipped or never walked is Not assessed; tried but not measurable is Not measured", () => {
    expect(walkingScore({ status: "skipped", reason: "Skipped" })).toMatchObject({ points: null, level: null, label: "Not assessed", measured: false });
    expect(walkingScore(null)).toMatchObject({ points: null, level: null, label: "Not assessed" });
    expect(walkingScore({ status: "not_measured", reason: "I saw too few steps." })).toMatchObject({ points: null, level: null, label: "Not measured" });
    expect(walkingScore(scored(Number.NaN))).toMatchObject({ points: null, label: "Not measured" });
    expect(walkingScore(scored(130))).toMatchObject({ points: null, label: "Not measured" });
  });
});

describe("the function score", () => {
  const row = (task_id: NativeTaskScore["task_id"], points: number | null): NativeTaskScore =>
    ({ task_id, task_label: task_id, points, level: points === null ? null : points / 25, label: "" });

  it("averages areas from their measured tasks and the total from the unrounded areas", () => {
    const score = buildFunctionScore([row("T1", 75), row("T3", 50), row("H4", 100), row("H3", 0), { ...walkingScore(scored(67.456)) }]);
    expect(score.areas.upper_limb).toMatchObject({ score: 62.5, display_score: 63, partial: false, task_ids: ["T1", "T3"] });
    expect(score.areas.hand).toMatchObject({ score: 50, display_score: 50 });
    expect(score.areas.lower_limb).toMatchObject({ score: 67.456, display_score: 67, task_ids: ["L6"] });
    expect(score.total).toBeCloseTo((62.5 + 50 + 67.456) / 3, 10);
    expect(score.display_total).toBe(60);
    expect(score.tasks.map(task => task.task_id)).toEqual(["T1", "T3", "H4", "H3", "L6"]);
    expect(score).toMatchObject({ version: "rehyn-function-level-1", clinical_measure: false });
  });

  it("rounds the total once: 56.25 shows 56, not the 57 the rounded areas would give", () => {
    const score = buildFunctionScore([row("T1", 75), row("T3", 50), row("H4", 50), row("H3", 50)]);
    expect([score.areas.upper_limb.display_score, score.areas.hand.display_score]).toEqual([63, 50]);
    expect(score.total).toBe(56.25);
    expect(score.display_total).toBe(56);
  });

  it("an unmeasured task leaves its area partial; an area with none measured has no score and is left out of the total", () => {
    const score = buildFunctionScore([row("T1", 100), row("T3", null), row("H4", null), row("H3", null), walkingScore(null)]);
    expect(score.areas.upper_limb).toMatchObject({ score: 100, display_score: 100, partial: true });
    expect(score.areas.hand).toMatchObject({ score: null, display_score: null, partial: true });
    expect(score.areas.lower_limb).toMatchObject({ score: null, display_score: null });
    expect(score.total).toBe(100);
    expect(score.display_total).toBe(100);
  });

  it("has no area for tasks not in the check, and no total without a score", () => {
    const seated = buildFunctionScore([row("T1", 50), row("T3", 25)]);
    expect(Object.keys(seated.areas)).toEqual(["upper_limb"]);
    expect(seated.display_total).toBe(38);
    const none = buildFunctionScore([]);
    expect(none).toMatchObject({ total: null, display_total: null, areas: {}, tasks: [] });
  });
});
