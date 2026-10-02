import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_CONSENT, type WarmRepRecord } from "@shared/alira-adaptation";
import {
  ADAPTATION_KEY, applyLearnedChanges, buildSnapshot, CONSENT_KEY, holdKeyFrames, keyFramesHeld, learningToday, loadAdaptation,
  loadConsentRecord, loadExerciseTuning, recordWarmRepSkip, saveConsent, saveReport, saveWarmRep, takeKeyFrames, undoChange,
  warmRepNeeded, adaptedStartRungs,
} from "./alira-learning-store";

let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

const today = () => learningToday();
const warmRep = (over: Partial<WarmRepRecord> = {}): WarmRepRecord => ({
  id: "w1", day: today(), at: "2026-10-01T09:00:00Z", source: "survey_end", side: "right", simulated: false,
  rest: { shoulderFlexion: 12, elbowExtension: 105 },
  reaches: [null, { shoulderFlexion: 58, elbowExtension: 140, wristHeight: 0.9, trunkLeanDeg: 3, shoulderElevationPct: 4, faceApproachPct: 2, heldMs: 1500 }],
  best: { shoulderFlexion: 58, elbowExtension: 140, wristHeight: 0.9, trunkLeanDeg: 3, shoulderElevationPct: 4, faceApproachPct: 2, heldMs: 1500 },
  bestExcursionDeg: 46, suggestedReachRung: 0, ...over,
});

describe("consent", () => {
  it("defaults to sharing nothing and records every choice with a time", () => {
    expect(loadConsentRecord()).toMatchObject({ categories: NO_CONSENT, asked: false });
    saveConsent({ movement: true, survey: true }, "2026-10-01T10:00:00Z");
    saveConsent({ survey: false }, "2026-10-01T11:00:00Z");
    const record = loadConsentRecord();
    expect(record.categories).toEqual({ ...NO_CONSENT, movement: true });
    expect(record.history.map(item => item.at)).toEqual(["2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z"]);
    expect(JSON.parse(values.get(CONSENT_KEY)!).asked).toBe(true);
  });

  it("does not bring data back after storage was cleared (account reset)", () => {
    saveConsent({ movement: true });
    values.clear();
    expect(loadConsentRecord().categories.movement).toBe(false);
  });

  it("keeps working for this tab when storage is blocked", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    saveConsent({ movement: true });
    expect(loadConsentRecord().categories.movement).toBe(true);
  });
});

describe("the warm-up gates", () => {
  it("offers the warm-up once a day, per gate, and not on the carer-led route", () => {
    expect(warmRepNeeded("pre_assessment", { arm_hand_movement: "tires" })).toBe(true);
    expect(warmRepNeeded("pre_assessment", { arm_hand_movement: "none" })).toBe(false);
    recordWarmRepSkip("survey_end");
    expect(warmRepNeeded("survey_end", {})).toBe(false);
    // Skipping at the end of the survey still offers it before the check and before exercise.
    expect(warmRepNeeded("pre_assessment", {})).toBe(true);
    expect(warmRepNeeded("pre_exercise", {})).toBe(true);
    saveWarmRep(warmRep());
    expect(warmRepNeeded("pre_assessment", {})).toBe(false);
    expect(warmRepNeeded("pre_exercise", {})).toBe(false);
  });

  it("asks again on a new day", () => {
    saveWarmRep(warmRep({ day: "2020-01-01" }));
    expect(warmRepNeeded("pre_exercise", {})).toBe(true);
  });
});

describe("Alira's changes in this browser", () => {
  const change = { param: "exercise.hold_seconds", value: 1.2, why: "Holds were short today.", evidence: ["warm-up held 1.1 s"], id: "c1" };

  it("validates again before storing, and keeps the defaults otherwise", () => {
    saveConsent({ movement: true });
    expect(loadExerciseTuning().holdSeconds).toBe(1.5);
    const { accepted, rejected } = applyLearnedChanges([change, { ...change, id: "c2", param: "exercise.hold_seconds", value: 9 }], { at: "now", by: "alira", trigger: "warm_rep" });
    expect(accepted.map(entry => entry.id)).toEqual(["c1"]);
    expect(rejected).toHaveLength(1);
    expect(loadExerciseTuning().holdSeconds).toBe(1.2);
    expect(loadExerciseTuning("ex_handopen").holdSeconds).toBe(1.2);
    // The everyday exercise always keeps the standard settings.
    expect(loadExerciseTuning("ex_reach").holdSeconds).toBe(1.5);
    // Withdrawing consent puts the standard settings back in force.
    saveConsent({ movement: false });
    expect(loadExerciseTuning().holdSeconds).toBe(1.5);
    saveConsent({ movement: true });
    undoChange("c1");
    expect(loadExerciseTuning().holdSeconds).toBe(1.5);
    expect(loadAdaptation().log[0].revertedAt).toBeTruthy();
  });

  it("refuses a harder change after a pain report today", () => {
    saveReport({ source: "exercise", pain: "a_little" });
    const { accepted, rejected } = applyLearnedChanges([{ ...change, value: 1.7 }], { at: "now", by: "alira", trigger: "exercise_session" });
    expect(accepted).toEqual([]);
    expect(rejected[0].reason).toMatch(/Only easier changes/);
  });

  it("ignores a tampered store", () => {
    saveConsent({ movement: true });
    values.set(ADAPTATION_KEY, JSON.stringify({ values: { "exercise.hold_seconds": 0.01, "assessment.reach_start_rung": 0 } }));
    expect(loadExerciseTuning().holdSeconds).toBe(1.5);
    expect(adaptedStartRungs({ T1: "r160", T3: "mouth" })).toEqual({ T1: "r80", T3: "mouth" });
  });
});

describe("the snapshot Alira learns from", () => {
  it("contains only what the patient agreed to share", () => {
    values.set("rehyn.onboarding.answers", JSON.stringify({ arm_hand_movement: "tires", main_goal: "other", main_goal_other: "Gardening" }));
    saveWarmRep(warmRep());
    expect(buildSnapshot(NO_CONSENT)).toEqual({ today: today() });
    const shared = buildSnapshot({ ...NO_CONSENT, survey: true, movement: true });
    expect(shared.survey?.arm_hand_movement).toBe("tires (Yes, but it tires quickly)");
    expect(JSON.stringify(shared)).not.toContain("Gardening");
    expect(shared.movement?.warmReps).toHaveLength(1);
    expect(buildSnapshot({ ...NO_CONSENT, personal: true }).personal).toEqual({ name: "Zak", goalInOwnWords: "Gardening" });
  });

  it("hands still images over once, then forgets them", () => {
    holdKeyFrames([{ label: "Reach 1", dataUrl: "data:image/jpeg;base64,AA==" }], 0);
    expect(keyFramesHeld()).toBe(1);
    expect(takeKeyFrames(10)).toHaveLength(1);
    expect(takeKeyFrames(20)).toEqual([]);
    holdKeyFrames([{ label: "Old", dataUrl: "data:image/jpeg;base64,AA==" }], 0);
    expect(takeKeyFrames(60 * 60 * 1000)).toEqual([]);
  });
});
