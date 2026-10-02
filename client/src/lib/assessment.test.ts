import { describe, expect, it } from "vitest";
import { buildRunnerUrl, assessmentPlanFrom, companionTaskPlan, type StartRungs } from "./assessment";

describe("companion movement-check URL", () => {
  it("opens the stateless guest route for the Render review while retaining task order, side and rungs", () => {
    const url = new URL(buildRunnerUrl("https://rehyn.onrender.com", { affectedSide: "left", guestReview: true,
      answers: { arm_hand_movement: "tires", get_around: "wheelchair" } }));
    expect(url.pathname).toBe("/api/pose/review-runner");
    expect(url.searchParams.get("task_ids")).toBe("T1,T3,H4,H3");
    expect(url.searchParams.get("affected_side")).toBe("left");
    expect(JSON.parse(url.searchParams.get("start_rung")!)).toEqual({T1:"r120",T3:"mouth"});
    expect(url.searchParams.get("ladder")).toBe("1");
    expect(url.searchParams.has("local_preview")).toBe(false);
    expect(url.searchParams.has("uid")).toBe(false);
  });

  it("requests four camera tasks, with opening before pinch, then walking", () => {
    const url = new URL(buildRunnerUrl("http://localhost:8001", { affectedSide: "right" }));
    expect(url.pathname).toBe("/api/pose/runner");
    expect(url.searchParams.get("package")).toBe("initial");
    expect(url.searchParams.get("task_ids")?.split(",")).toEqual(["T1", "T3", "H4", "H3", "L6"]);
    expect(url.searchParams.get("ladder")).toBe("1");
  });

  it.each(["http://localhost:8001", "http://127.0.0.1:8001", "http://[::1]:8001"])(
    "opts into the unsaved sandbox only on loopback: %s", base => {
      const url = new URL(buildRunnerUrl(base, { affectedSide: "right" }));
      expect(url.searchParams.get("local_preview")).toBe("1");
      expect(url.searchParams.has("uid")).toBe(false);
    }
  );

  it("does not request an anonymous preview on the hosted backend", () => {
    const url = new URL(buildRunnerUrl("https://rehyn.onrender.com", { affectedSide: "right" }));
    expect(url.searchParams.has("local_preview")).toBe(false);
    expect(url.searchParams.get("task_ids")).toBe("T1,T3,H4,H3,L6");
  });

  it("keeps the affected side and voice preference", () => {
    const defaults = new URL(buildRunnerUrl("http://localhost:8001", { affectedSide: "right" }));
    expect(defaults.searchParams.get("affected_side")).toBe("right");
    expect(defaults.searchParams.get("voice_guidance")).toBe("1");
    const left = new URL(buildRunnerUrl("http://localhost:8001", { affectedSide: "left", voiceGuidance: false }));
    expect(left.searchParams.get("affected_side")).toBe("left");
    expect(left.searchParams.get("voice_guidance")).toBe("0");
  });
});

describe("survey task choice", () => {
  it.each([["fairly_well", "r160", "mouth"], ["tires", "r120", "mouth"], ["little_help", "r80", "chest"]])(
    "%s selects the expected starting targets", (movement, reach, mouth) => {
      const plan = assessmentPlanFrom({ arm_hand_movement: movement });
      expect(plan.taskIds).toEqual(["T1", "T3", "H4", "H3", "L6"]);
      expect(plan.startRung).toEqual({ T1: reach, T3: mouth });
    });
  it("no reported arm movement uses the carer route without arm or hand scores", () => {
    expect(assessmentPlanFrom({ arm_hand_movement: "none" }).taskIds).toEqual(["L6"]);
    expect(assessmentPlanFrom({ arm_hand_movement: "none", get_around: "wheelchair" }).taskIds).toEqual([]);
  });
  it.each(["own", "frame_stick", "person"])("%s includes walking", mode => {
    const plan = assessmentPlanFrom({ get_around: mode });
    expect(plan.taskIds).toContain("L6");expect(plan.walkingHelper).toBe(mode === "person");
  });
  it("wheelchair excludes walking and own help defaults to self-assist", () => {
    const plan = assessmentPlanFrom({ get_around: "wheelchair", help_at_home: "own" });
    expect(plan.taskIds).not.toContain("L6");expect(plan.helper).toBe("0");
  });
  it.each(["family", "carer", "both"])("%s asks whether someone is present now", help => {
    expect(assessmentPlanFrom({ help_at_home: help }).helper).toBe("ask");
  });
  it("help-only movement asks about current support even for someone usually alone", () => {
    expect(assessmentPlanFrom({ arm_hand_movement: "little_help", help_at_home: "own" }).helper).toBe("ask");
  });
  it("passes start rungs, current-helper question, walking support and goal to the shared runner", () => {
    const url = new URL(buildRunnerUrl("http://localhost:8001", { affectedSide: "left", answers: { arm_hand_movement: "tires", get_around: "person", main_goal: "dressing" } }));
    expect(JSON.parse(url.searchParams.get("start_rung")!)).toEqual({ T1: "r120", T3: "mouth" });
    expect(url.searchParams.get("helper")).toBe("ask");expect(url.searchParams.get("walking_helper")).toBe("1");expect(url.searchParams.get("main_goal")).toBe("dressing");
  });
});

describe("start points learned by Alira", () => {
  const startRung = (url: string) => JSON.parse(new URL(url).searchParams.get("start_rung")!);

  it("sends hand opening and pinch start points when they are set", () => {
    const answers = { arm_hand_movement: "tires" };
    expect(startRung(buildRunnerUrl("http://localhost:8001", { affectedSide: "right", answers, startRungs: { T1: "r80", T3: "mouth", H4: "partial", H3: "full" } })))
      .toEqual({ T1: "r80", T3: "mouth", H4: "partial", H3: "full" });
    const plan = { ...companionTaskPlan(answers), startRungs: { T1: "r120", T3: "mouth", H3: "partial" } satisfies StartRungs };
    expect(startRung(buildRunnerUrl("http://localhost:8001", { affectedSide: "right", plan }))).toEqual({ T1: "r120", T3: "mouth", H3: "partial" });
  });

  it("leaves them out otherwise, so the runner starts both at their full level", () => {
    for (const startRungs of [undefined, {}, { T1: "r120" } satisfies StartRungs]) {
      const rungs = startRung(buildRunnerUrl("http://localhost:8001", { affectedSide: "right", startRungs }));
      expect(rungs).not.toHaveProperty("H4");
      expect(rungs).not.toHaveProperty("H3");
    }
    expect(new URL(buildRunnerUrl("http://localhost:8001", { affectedSide: "right" })).searchParams.get("start_rung")).toBe('{"T1":"r160","T3":"mouth"}');
  });

  it("keeps the survey's start point for every task a learned setting does not name", () => {
    expect(startRung(buildRunnerUrl("http://localhost:8001", { affectedSide: "right", answers: { arm_hand_movement: "little_help" }, startRungs: { H4: "partial" } })))
      .toEqual({ T1: "r80", T3: "chest", H4: "partial" });
  });

  it("never sends a task or start point the runner does not know", () => {
    const startRungs = { T1: "r200", H4: "wide", L6: "fast" } as unknown as StartRungs;
    expect(startRung(buildRunnerUrl("http://localhost:8001", { affectedSide: "right", startRungs }))).toEqual({ T1: "r160", T3: "mouth" });
  });
});
