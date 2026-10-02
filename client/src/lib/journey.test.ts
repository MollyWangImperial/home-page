import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberAssessment, rememberAssessmentPlan, type AssessmentReport } from "./assessment";
import { EXERCISES_DONE_KEY } from "./home-stage";
import {
  buildJourney, chartWindow, clearJourneyRecords, ensureJourneyRecords, journeyLockReason, journeyUnlocked,
  loadSessionStore, recordExerciseResult, type SessionStore,
} from "./journey";

const report: AssessmentReport = {
  id: "a1", preview_only: true,
  metrics: { function_score: { display_total: 60, tasks: [], areas: { upper_limb: { display_score: 62 }, hand: { display_score: 48 }, lower_limb: { display_score: 71 } } } },
  rehab_plan: [
    { id: "ex_reach", name: "Graded Forward Reach", description: "Reach forward.", sets: 3, reps: 8, frequency: "Daily", difficulty: "easy" },
    { id: "ex_grasp", name: "Grasp and Release", description: "Squeeze and open.", sets: 2, reps: 10, frequency: "Daily", difficulty: "easy" },
    { id: "ex_trunk", name: "Trunk Control", description: "Not run by the companion.", sets: 2, reps: 6, frequency: "Daily" },
  ],
};

let values: Map<string, string>;
beforeEach(() => {
  values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the lock", () => {
  it("stays locked with no assessment, and until Alira has designed the plan", () => {
    expect(journeyUnlocked(null)).toBe(false);
    expect(journeyLockReason(null)).toBe("assessment");
    const stored = rememberAssessment(report)!;
    expect(journeyUnlocked(stored)).toBe(false);
    expect(journeyLockReason(stored)).toBe("plan");
    const ready = rememberAssessmentPlan(stored, report, true);
    expect(journeyUnlocked(ready)).toBe(true);
    expect(journeyLockReason(ready)).toBeNull();
  });

  it("needs at least one measured score", () => {
    const unscored = { ...report, metrics: { function_score: { display_total: null, tasks: [], areas: { hand: { display_score: null } } } } };
    const stored = rememberAssessmentPlan(rememberAssessment(unscored)!, unscored, true);
    expect(journeyUnlocked(stored)).toBe(false);
    expect(journeyLockReason(stored)).toBe("assessment");
  });

  it("stays open while a re-assessment's plan is still being prepared", () => {
    const ready = rememberAssessmentPlan(rememberAssessment(report)!, report, true);
    ensureJourneyRecords(ready);
    const reassessed = rememberAssessment({ ...report, id: "a2" })!;
    expect(journeyUnlocked(reassessed)).toBe(true);
    clearJourneyRecords();
    expect(journeyUnlocked(reassessed)).toBe(false);
  });
});

describe("exercise results", () => {
  it("keeps the best score and completes the day when the ready exercise is scored", () => {
    rememberAssessmentPlan(rememberAssessment(report)!, report, true);
    const now = new Date(2026, 9, 1, 10, 0);
    recordExerciseResult("ex_reach", 70.4, now);
    recordExerciseResult("ex_reach", 64, now);
    expect(values.get(EXERCISES_DONE_KEY)).toBe("2026-10-01");
    recordExerciseResult("ex_grasp", 55, now);
    const store = loadSessionStore();
    expect(store["2026-10-01"].ex_reach.score).toBe(70);
    expect(store["2026-10-01"].ex_grasp.score).toBe(55);
    expect(values.get(EXERCISES_DONE_KEY)).toBe("2026-10-01");
  });
});

describe("the model", () => {
  const start = new Date(2026, 8, 29, 9, 30);
  const base = () => {
    const ready = rememberAssessmentPlan(rememberAssessment(report)!, report, true);
    const { assessments } = ensureJourneyRecords(ready);
    return { assessment: ready, start, assessments };
  };

  it("opens on day one with the starting point and the plan, before any session", () => {
    const model = buildJourney({ ...base(), store: {}, now: new Date(2026, 8, 29, 15, 0), range: "all", name: "Zak" });
    expect(model.day).toBe(0);
    expect(model.headline).toBe("Day one. Your starting point is set.");
    expect(model.sessions).toHaveLength(0);
    expect(model.timeline[0]).toMatchObject({ n: 1, state: "today", weekLabel: "Week 1" });
    expect(model.timeline.find(day => day.reassessment)?.n).toBe(15);
    expect(model.planTitle).toBe("Your plan for week 1");
    expect(model.planRows.map(row => row.exercise.launchable)).toEqual([true, false, false]);
    expect(model.nextExercise?.id).toBe("ex_reach");
    expect(model.startingScores).toEqual({ upper_limb: 62, hand: 48, lower_limb: 71 });
    expect(model.assessments.map(column => column.label)).toEqual(["Starting point", "Next check"]);
    expect(model.nextMedal.id).toBe("first-step");
    expect(model.unlocks).toMatchObject({ progress: true, wins: true, letter: true });
    expect(model.alira.text).toContain("Zak, your starting point is set");
  });

  it("keeps every session since day one and notices a dip", () => {
    const store: SessionStore = {
      "2026-09-29": { ex_reach: { score: 70, at: "" }, ex_grasp: { score: 60, at: "" } },
      "2026-09-30": { ex_reach: { score: 66, at: "" }, ex_grasp: { score: 50, at: "" } },
    };
    const model = buildJourney({ ...base(), store, now: new Date(2026, 8, 30, 18, 0), range: "all", name: "Zak" });
    expect(model.day).toBe(1);
    expect(model.sessions.map(session => session.score)).toEqual([65, 58]);
    expect(model.doneToday).toBe(true);
    expect(model.streak).toBe(2);
    expect(model.chart.points).toHaveLength(2);
    expect(model.chart.points[1].cont).toBe(true);
    expect(model.byExercise[0].delta).toBe(-4);
    expect(model.alira.kind).toBe("care");
    expect(model.alira.text).toContain("7 points lower");
    expect(model.nextMedal).toMatchObject({ id: "sunrise", pct: 29 });
    expect(model.earnedMedalIds).toEqual(["first-step"]);
    expect(model.winsUnlocked).toBe(true);
    expect(model.timeline[1].state).toBe("today-done");
  });

  it("writes the Sunday letter on day seven and windows the chart without dropping data", () => {
    const store: SessionStore = {};
    for (let d = 0; d < 7; d++) store[`2026-${d + 29 > 30 ? "10" : "09"}-${String(((d + 29 - 1) % 30) + 1).padStart(2, "0")}`] = { ex_reach: { score: 60 + d, at: "" } };
    const model = buildJourney({ ...base(), store, now: new Date(2026, 9, 5, 12, 0), range: "7d", name: "Zak" });
    expect(model.day).toBe(6);
    expect(model.alira.kind).toBe("letter");
    expect(model.alira.text).toContain("this week you showed up 7 times");
    expect(chartWindow("7d", 20)).toEqual({ cs: 14, N: 7 });
    expect(chartWindow("all", 20)).toEqual({ cs: 0, N: 21 });
    expect(model.chart.points).toHaveLength(7);
    expect(model.earnedMedalIds).toEqual(["first-step", "sunrise"]);
  });
});
