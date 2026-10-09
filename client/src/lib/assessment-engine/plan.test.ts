import { describe, expect, it } from "vitest";
import { withEverydayExercise } from "../assessment";
import { EVERYDAY_EXERCISE_ID, EXERCISES, REPS_BY_RUNG } from "../exercise-engine/config";
import { CODE_EXERCISE, PLAN_LIMIT, WALKING_EXERCISES, buildRehabPlan, planSelection } from "./plan";
import type { CameraTaskId, CompStatus, GaitResult } from "./types";

type Row = { task_id: string; level: number | null; compensations?: Record<string, CompStatus> };
const row = (task_id: CameraTaskId | "L6", level: number | null, compensations?: Record<string, CompStatus>): Row => ({ task_id, level, ...(compensations ? { compensations } : {}) });
const score = (...tasks: Row[]) => ({ tasks });
const walk = (areaScore: number, assist: "holds" | "none" = "none"): GaitResult => ({
  status: "scored", score: assist === "holds" ? 80 : areaScore, areaScore, assist, components: {},
  metrics: { speedLegPerS: 0.8, speedMpsEstimate: 0.68, cadence: 88, steps: 10, passes: 2, seenShare: 0.9, sideOnRatio: 0.3 },
});
const idsOf = (plan: { id: string }[]) => plan.map(exercise => exercise.id);

describe("the exercise plan from the task levels", () => {
  it("fills the two lowest, goal and success slots, combining a repeated exercise", () => {
    const plan = buildRehabPlan(score(row("T1", 2), row("T3", 3, { trunk_forward: "detected" }), row("H4", 2), row("H3", 4), row("L6", null)), { main_goal: "eating" }, null);
    // Lowest: T1 (reach) and H4 (hand opening). Goal (eating): T3, leaning → the reach again. Success: H3 → pinch.
    expect(idsOf(plan)).toEqual(["ex_reach", "ex_handopen", "ex_pinch"]);
    expect(plan[0]).toMatchObject({
      name: EXERCISES.ex_reach.name, sets: 1, reps: REPS_BY_RUNG[1], frequency: "Daily", difficulty: "easy", linked_goal: "eating",
      selection_reason: "It builds up your reach, one of the harder movements in your check. It works toward your everyday goal. It practises reaching while you sit tall.",
    });
    expect(plan[1]).toMatchObject({ difficulty: "easy", selection_reason: "It builds up your hand opening, one of the harder movements in your check." });
    expect(plan[2]).toMatchObject({ difficulty: "medium", selection_reason: "It builds on your pinch, your strongest movement in your check." });
  });

  it("sends a level of 1 or less to a carer-supported domain instead of an exercise", () => {
    const selection = planSelection(score(row("T1", 1), row("T3", 2), row("H4", 0), row("H3", 0)), { main_goal: "walking_house" });
    expect(idsOf(selection.exercises)).toEqual(["ex_h2m"]);
    expect(selection.caregiver_domains).toEqual(["hand"]);
    expect(planSelection(score(row("T1", 0), row("T3", 1)), {}).caregiver_domains).toEqual(["upper_limb"]);
  });

  it("maps a compensated full level to its posture exercise, and a level 4 to a harder use of the movement", () => {
    const only = (task: CameraTaskId, level: number, compensations?: Record<string, CompStatus>) => idsOf(buildRehabPlan(score(row(task, level, compensations)), {}, null));
    expect(only("T1", 3, { trunk_lean: "detected", shoulder_hike: "detected" })).toEqual(["ex_reach"]);
    expect(only("T3", 3, { shoulder_hike: "detected", head_forward: "not_detected" })).toEqual(["ex_wallslide"]);
    expect(only("H4", 3, { trunk_forward: "detected" })).toEqual(["ex_reach"]);
    // Full level with posture unseen (or another check): the task's own exercise.
    expect(only("T3", 3, { head_forward: "detected" })).toEqual(["ex_h2m"]);
    expect(only("H4", 3)).toEqual(["ex_handopen"]);
    expect(only("T1", 4)).toEqual(["ex_grasp"]);
    expect(only("H4", 4)).toEqual(["ex_grasp"]);
    expect(only("H3", 4)).toEqual(["ex_pinch"]);
    expect(only("H3", 2)).toEqual(["ex_pinch"]);
    expect(buildRehabPlan(score(row("T3", 3, { shoulder_hike: "detected" })), {}, null)[0].selection_reason).toContain("shoulder relaxed");
  });

  it("one task fills the building and success slots once, said once", () => {
    const plan = buildRehabPlan(score(row("T1", 2)), {}, null);
    expect(idsOf(plan)).toEqual(["ex_reach"]);
    expect(plan[0].selection_reason).toBe("It builds up your reach, one of the harder movements in your check.");
    expect(plan[0].linked_goal).toBeUndefined();
  });

  it("matches the goal in the patient's own words for Something else", () => {
    const tasks = score(row("T1", 3), row("T3", 3), row("H4", 3), row("H3", 4));
    // Lowest T1, T3; goal (dressing) → H3 first; success H3 again.
    const dressing = planSelection(tasks, { main_goal: "other", main_goal_other: "Getting DRESSED... dressing myself" });
    expect(dressing.exercises.find(exercise => exercise.id === "ex_pinch")?.selection_reason).toContain("everyday goal");
    expect(dressing.exercises.every(exercise => exercise.linked_goal === "other")).toBe(true);
    const unmatched = planSelection(tasks, { main_goal: "going_out" });
    expect(unmatched.exercises.some(exercise => exercise.selection_reason?.includes("everyday goal"))).toBe(false);
  });

  it("ignores unmeasured tasks and walking's row", () => {
    expect(idsOf(buildRehabPlan(score(row("T1", null), row("T3", null), row("L6", 4)), {}, null))).toEqual([]);
  });

  it("a pinch the patient skipped (Not assessed) takes no slot and sends no domain to a carer", () => {
    const selection = planSelection(score(row("T1", 4), row("T3", 4), row("H4", 4), row("H3", null)), {});
    expect(selection.caregiver_domains).toEqual([]);
    expect(idsOf(selection.exercises)).toEqual(["ex_grasp"]);
    // Only a pinch at level 0 (the page's own skip after hand opening) goes to a carer-supported hand domain.
    expect(planSelection(score(row("T1", 4), row("T3", 4), row("H4", 1), row("H3", 0)), {}).caregiver_domains).toEqual(["hand"]);
  });

  it("accepts a stored function score whose rows have no compensations", () => {
    const stored = { display_total: 50, areas: {}, tasks: [{ task_id: "T3", task_label: "Hand to mouth", points: 75, level: 3 }] };
    expect(idsOf(buildRehabPlan(stored, {}, null))).toEqual(["ex_h2m"]);
  });
});

describe("walking in the plan", () => {
  it("adds the two seated leg exercises when walking measured below 75", () => {
    const plan = buildRehabPlan(score(row("T1", 2)), { main_goal: "eating" }, walk(60));
    expect(idsOf(plan)).toEqual(["ex_reach", ...WALKING_EXERCISES]);
    for (const exercise of plan.slice(1)) {
      expect(exercise).toMatchObject({ difficulty: "easy", sets: 1, reps: REPS_BY_RUNG[1], frequency: "Daily" });
      expect(exercise.selection_reason).toBe("It strengthens the leg movements you use for walking.");
      // A leg exercise names only a walking goal.
      expect(exercise.linked_goal).toBeUndefined();
    }
    expect(buildRehabPlan(score(), { main_goal: "going_out" }, walk(40)).map(exercise => exercise.linked_goal)).toEqual(["going_out", "going_out"]);
  });

  it("uses the walking area's unrounded score, the capped one when someone held the patient", () => {
    expect(idsOf(buildRehabPlan(score(), {}, walk(74.9)))).toEqual(WALKING_EXERCISES);
    expect(idsOf(buildRehabPlan(score(), {}, walk(75)))).toEqual([]);
    expect(idsOf(buildRehabPlan(score(), {}, walk(50, "holds")))).toEqual(WALKING_EXERCISES);
  });

  it("adds nothing for walking that was skipped or not measured", () => {
    expect(buildRehabPlan(score(), {}, { status: "skipped", reason: "Skipped" })).toEqual([]);
    expect(buildRehabPlan(score(), {}, { status: "not_measured", reason: "I saw too few steps." })).toEqual([]);
    expect(buildRehabPlan(score(), {}, null)).toEqual([]);
  });
});

describe("plan limits", () => {
  it("never more than six a day with the everyday reach: a success-only exercise goes first", () => {
    // Lowest T3, H4; goal (dressing) H3; success T1 at 4 → grasp; walking adds two: seven with the everyday reach.
    const plan = buildRehabPlan(score(row("T1", 4), row("T3", 2), row("H4", 2), row("H3", 2)), { main_goal: "dressing" }, walk(50));
    expect(idsOf(plan)).toEqual(["ex_h2m", "ex_handopen", "ex_pinch", ...WALKING_EXERCISES]);
    expect(withEverydayExercise(plan)).toHaveLength(PLAN_LIMIT);
  });

  it("every combination of levels, goals and walking gives a valid plan", () => {
    const levels = [null, 0, 1, 2, 3, 4];
    const goals = [{}, { main_goal: "eating" }, { main_goal: "dressing" }, { main_goal: "walking_house" }, { main_goal: "other", main_goal_other: "grooming" }];
    const walks = [null, walk(40), walk(90)];
    const comps: (Record<string, CompStatus> | undefined)[] = [undefined, { trunk_lean: "detected" }, { shoulder_hike: "detected" }];
    let plans = 0;
    // Every level combination once, cycling through the goals, walking results and checks so each pair of them is met.
    for (const t1 of levels) for (const t3 of levels) for (const h4 of levels) for (const h3 of levels) {
      const n = plans++;
      const comp = comps[n % comps.length], answers = goals[n % goals.length], walking = walks[Math.floor(n / goals.length) % walks.length];
      const plan = buildRehabPlan(score(row("T1", t1, comp), row("T3", t3, comp), row("H4", h4), row("H3", h3)), answers, walking);
      const ids = idsOf(plan);
      expect(new Set(ids).size).toBe(ids.length);
      expect(withEverydayExercise(plan).length).toBeLessThanOrEqual(PLAN_LIMIT);
      for (const exercise of plan) {
        expect(Object.values(CODE_EXERCISE).concat(WALKING_EXERCISES)).toContain(exercise.id);
        expect(exercise.name).toBe(EXERCISES[exercise.id].name);
        expect(exercise.description).toMatch(/\.$/);
        expect(exercise.selection_reason).toMatch(/\.$/);
        expect(exercise.selection_reason).not.toMatch(/\d/);
        expect([exercise.sets, exercise.reps, exercise.frequency]).toEqual([1, REPS_BY_RUNG[1], "Daily"]);
        expect(["easy", "medium"]).toContain(exercise.difficulty);
      }
    }
    expect(plans).toBe(levels.length ** 4);
  });

  it("the storage code's everyday reach keeps a planned reach's place and dose", () => {
    const plan = buildRehabPlan(score(row("T1", 2), row("H4", 2)), {}, null);
    const stored = withEverydayExercise(plan);
    expect(stored[0].id).toBe(EVERYDAY_EXERCISE_ID);
    expect(idsOf(stored)).toEqual(["ex_reach", "ex_handopen"]);
  });
});
