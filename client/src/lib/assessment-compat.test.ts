import { describe, expect, it } from "vitest";
import { assessmentPlanFrom, buildRunnerUrl, companionTaskPlan } from "./assessment";

describe("Claude onboarding uses the copied assessment contract", () => {
  it.each(["fairly_well", "tires", "little_help"])("keeps the existing plan caller compatible: %s", arm_hand_movement => {
    const answers = { arm_hand_movement, get_around: "person", main_goal: "dressing" };
    const legacy = new URL(buildRunnerUrl("http://localhost:8002", { affectedSide: "left", plan: companionTaskPlan(answers) }));
    const current = new URL(buildRunnerUrl("http://localhost:8002", { affectedSide: "left", answers }));
    expect(legacy.toString()).toBe(current.toString());
    expect(JSON.parse(current.searchParams.get("start_rung")!).T1).toBe(assessmentPlanFrom(answers).startRung.T1);
  });
  it("retains wheelchair and carer-led routing", () => {
    expect(companionTaskPlan({ arm_hand_movement: "none", get_around: "wheelchair" }).taskIds).toEqual([]);
    expect(companionTaskPlan({ arm_hand_movement: "none", get_around: "own" }).taskIds).toEqual(["L6"]);
  });
});
