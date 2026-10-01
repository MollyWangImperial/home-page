import { describe, expect, it } from "vitest";
import { EXERCISE_RUNGS, EXERCISES, LAUNCH_EXERCISE_IDS } from "./config";
import { attainment, isGoodRep, isMiss, repScore, sessionScore, type RomTarget } from "./scoring";

// Graded Forward Reach at rung 2: shoulder 60 degrees (weight 0.65), elbow 140 degrees (0.35).
const reach: RomTarget[] = [
  { id: "shoulder", weight: 0.65, target: 60 },
  { id: "elbow", weight: 0.35, target: 140 },
];
const rep = (shoulder: number, elbow: number, hold: "full" | "touched" | "none", compensations: number) =>
  repScore(attainment(reach, { shoulder, elbow }), hold, compensations);

describe("repetition scoring examples", () => {
  it("clean rep scores 100", () => expect(rep(60, 142, "full", 0)).toBe(100));
  // The plan prints 93, but 100 x 0.935 is exactly 93.5 and its 45.5 example prints 46: round half up is used throughout.
  it("slightly short scores 94", () => expect(rep(54, 140, "full", 0)).toBe(94));
  it("reached with one compensation scores 30", () => expect(rep(60, 140, "full", 1)).toBe(30));
  it("touched, not held scores 80", () => expect(rep(60, 140, "touched", 0)).toBe(80));
  it("two compensations score 15 even with a short reach and partial hold", () => expect(rep(45, 130, "touched", 2)).toBe(15));
});

describe("scoring rules", () => {
  it("scores movement from the learned starting angles without giving resting posture credit", () => {
    const calibrated = [{ id: "shoulder", weight: 0.65, start: 20, target: 57 }, { id: "elbow", weight: 0.35, start: 120, target: 150 }];
    expect(attainment(calibrated, { shoulder: 20, elbow: 120 })).toBe(0);
    expect(attainment(calibrated, { shoulder: 38.5, elbow: 135 })).toBe(0.5);
    expect(attainment(calibrated, { shoulder: 57, elbow: 150 })).toBe(1);
    expect(attainment([{ id: "elbow", weight: 1, start: 180, target: 180 }], { elbow: 180 })).toBe(0);
    expect(attainment([{ id: "elbow", weight: 1, start: NaN, target: 150 }], { elbow: 150 })).toBe(0);
  });
  it("caps each ROM part at 1", () => expect(attainment(reach, { shoulder: 90, elbow: 170 })).toBe(1));
  it.each(["full", "touched", "none"] as const)("uses fixed compensation points with a %s hold", hold => {
    expect(repScore(0.5, hold, 1)).toBe(30);
    expect(repScore(0.5, hold, 2)).toBe(15);
    expect(repScore(0.5, hold, 3)).toBe(15);
  });
  it("never reached scores 0", () => expect(rep(0, 0, "none", 0)).toBe(0));
  it("good rep needs 0.9, full hold and no compensation", () => {
    expect(isGoodRep(0.93, "full", 0)).toBe(true);
    expect(isGoodRep(0.89, "full", 0)).toBe(false);
    expect(isGoodRep(0.95, "touched", 0)).toBe(false);
    expect(isGoodRep(0.95, "full", 1)).toBe(false);
  });
  it("a miss is attainment below 0.7", () => {
    expect(isMiss(0.69)).toBe(true);
    expect(isMiss(0.7)).toBe(false);
  });
  it("session score counts unattempted reps as zero and halves assisted sessions", () => {
    expect(sessionScore([100, 100], 4)).toBe(50);
    expect(sessionScore([80, 80, 80, 80], 4, true)).toBe(40);
    expect(sessionScore([], 6)).toBeNull();
  });
});

describe("launch set and rungs (section 1)", () => {
  it("has 8 exercises: 3 upper limb, 3 hand, 2 lower limb", () => {
    const domains = LAUNCH_EXERCISE_IDS.map(id => EXERCISES[id].domain);
    expect(domains.filter(d => d === "upper_limb")).toHaveLength(3);
    expect(domains.filter(d => d === "hand")).toHaveLength(3);
    expect(domains.filter(d => d === "lower_limb")).toHaveLength(2);
  });
  it("has 3 rungs each, with 6 / 8 / 10 reps, and rung 1 easier than rung 3 on every field", () => {
    for (const id of LAUNCH_EXERCISE_IDS) {
      const rungs = EXERCISE_RUNGS[id];
      expect([rungs[1].reps, rungs[2].reps, rungs[3].reps]).toEqual([6, 8, 10]);
      for (const step of EXERCISES[id].romSteps) expect(rungs[1].targets[step.id]).toBeLessThan(rungs[3].targets[step.id]);
      expect(rungs[1].preset.holdScale).toBeLessThan(rungs[3].preset.holdScale);
      expect(rungs[1].preset.radiusScale).toBeGreaterThan(rungs[3].preset.radiusScale);
      expect(rungs[1].preset.targetDistanceScale).toBeLessThan(rungs[3].preset.targetDistanceScale);
    }
  });
  it("rung 2 is the existing medium target", () => {
    expect(EXERCISE_RUNGS.ex_reach[2].targets).toEqual({ shoulder_flexion: 60, elbow_extension: 140 });
  });
  it("pinch uses 1 / 3 / 5 oppositions", () => {
    expect([1, 2, 3].map(rung => EXERCISE_RUNGS.ex_pinch[rung as 1 | 2 | 3].cycle.filter(step => step.kind === "pinch").length)).toEqual([1, 3, 5]);
  });
});
