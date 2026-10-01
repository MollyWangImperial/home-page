import { describe, expect, it } from "vitest";
import {
  ADAPTATION_PARAMS, adaptStartRungs, applyChange, autoValuesFromStartRungs, cleanValue, DEFAULT_EXERCISE_TUNING, emptyAdaptation,
  exerciseTuning, filterSnapshot, MAX_CHANGES_PER_DAY, NO_CONSENT, PARAM_IDS, previousDay, readAdaptationState, readConsent,
  resetAdaptations, revertChange, safetyFrom, tunedReps, validateChange, validKeyFrames,
  type AdaptationState, type ChangeRequest, type SafetyState,
} from "@shared/alira-adaptation";

const today = "2026-10-01";
const calm: SafetyState = { easierOnly: false, checkWithPhysio: false, reasons: [] };
const ctx = { today, safety: calm, auto: { "assessment.reach_start_rung": 2 } as const };
const ask = (param: string, value: number | null, extra: Partial<ChangeRequest> = {}): ChangeRequest => ({ param, value, why: "Today's warm-up was shorter than usual.", evidence: ["warm-up best reach 41 degrees"], ...extra });
const apply = (state: AdaptationState, request: ChangeRequest, id: string, context = ctx) => {
  const result = applyChange(state, request, context, { id, at: `${today}T10:00:00Z`, by: "alira", trigger: "warm_rep" });
  if (!result.ok) throw new Error(result.reason);
  return result.state;
};

describe("the settings Alira may adjust", () => {
  it("keeps every default inside its bounds and on its step grid", () => {
    for (const id of PARAM_IDS) {
      const spec = ADAPTATION_PARAMS[id];
      expect(spec.min, id).toBeLessThan(spec.max);
      if (spec.default !== null) {
        expect(spec.default, id).toBeGreaterThanOrEqual(spec.min);
        expect(spec.default, id).toBeLessThanOrEqual(spec.max);
        expect(cleanValue(id, spec.default), id).toBe(spec.default);
      } else expect(spec.domain, id).toBe("assessment");
    }
  });

  it("drops stored values that are out of bounds, not numbers, or unknown settings", () => {
    const state = readAdaptationState({ values: { "exercise.hold_seconds": 99, "exercise.target_size_scale": 1.12, "exercise.reps_scale": "lots", "made.up": 3 }, log: [{ junk: true }] });
    expect(state.values).toEqual({ "exercise.target_size_scale": 1.1 });
    expect(state.log).toEqual([]);
  });

  it("uses exactly today's numbers when nothing has been adapted", () => {
    expect(DEFAULT_EXERCISE_TUNING).toMatchObject({ holdSeconds: 1.5, holdFactor: 1, reachHeightScale: 1, targetSizeScale: 1, repsScale: 1, targetZone: 0.7, goodRepShare: 0.9, oneCompensationPoints: 30, adapted: false, changed: {} });
    expect(exerciseTuning({ "exercise.hold_seconds": 7 })).toMatchObject({ holdSeconds: 1.5, adapted: false });
    expect(exerciseTuning({ "exercise.hold_seconds": 1.2 })).toMatchObject({ holdSeconds: 1.2, holdFactor: 0.8, adapted: true, changed: { "exercise.hold_seconds": 1.2 } });
    expect(tunedReps(6, exerciseTuning({ "exercise.reps_scale": 0.5 }))).toBe(3);
    expect(tunedReps(4, exerciseTuning({ "exercise.reps_scale": 0.5 }))).toBe(3);
    expect(tunedReps(8, exerciseTuning({ "exercise.reps_scale": 1.25 }))).toBe(10);
  });

  it("maps start points to the runner's rung names and back", () => {
    expect(autoValuesFromStartRungs({ T1: "r120", T3: "mouth" })).toEqual({ "assessment.reach_start_rung": 1, "assessment.mouth_start_rung": 1, "assessment.hand_open_start_rung": 1, "assessment.pinch_start_rung": 1 });
    expect(adaptStartRungs({ T1: "r160", T3: "mouth" }, {})).toEqual({ T1: "r160", T3: "mouth" });
    expect(adaptStartRungs({ T1: "r160", T3: "mouth" }, { "assessment.reach_start_rung": 0, "assessment.hand_open_start_rung": 0 })).toEqual({ T1: "r80", T3: "mouth", H4: "partial" });
    expect(adaptStartRungs({ T1: "r160" }, { "assessment.reach_start_rung": 9 })).toEqual({ T1: "r160" });
  });
});

describe("validating Alira's changes", () => {
  it("needs a reason and evidence, and stays inside the bounds", () => {
    const state = emptyAdaptation();
    expect(validateChange(state, ask("exercise.hold_seconds", 1.2, { why: "" }), ctx).ok).toBe(false);
    expect(validateChange(state, ask("exercise.hold_seconds", 1.2, { evidence: [] }), ctx).ok).toBe(false);
    expect(validateChange(state, ask("exercise.hold_seconds", 0.2), ctx).ok).toBe(false);
    expect(validateChange(state, ask("nope", 1), ctx).ok).toBe(false);
    expect(validateChange(state, ask("exercise.hold_seconds", null), ctx).ok).toBe(false);
    expect(validateChange(state, ask("exercise.hold_seconds", 1.5), ctx).ok).toBe(false);
    expect(validateChange(state, ask("exercise.hold_seconds", 1.23), ctx)).toEqual({ ok: true, param: "exercise.hold_seconds", from: 1.5, to: 1.2 });
  });

  it("allows any easier move but limits harder moves per day", () => {
    let state = emptyAdaptation();
    expect(validateChange(state, ask("exercise.hold_seconds", 0.8), ctx).ok).toBe(true);
    expect(validateChange(state, ask("exercise.hold_seconds", 1.8), ctx).ok).toBe(true);
    expect(validateChange(state, ask("exercise.hold_seconds", 1.9), ctx).ok).toBe(false);
    state = apply(state, ask("exercise.hold_seconds", 1.7), "a");
    // 1.5 -> 1.7 used two of today's three harder steps; 1.9 would be four.
    expect(validateChange(state, ask("exercise.hold_seconds", 1.8), ctx).ok).toBe(true);
    expect(validateChange(state, ask("exercise.hold_seconds", 1.9), ctx).ok).toBe(false);
    // Tomorrow the day starts again from 1.7.
    expect(validateChange(state, ask("exercise.hold_seconds", 2.0), { ...ctx, today: "2026-10-02" }).ok).toBe(true);
  });

  it("treats a bigger target as easier, because that setting runs the other way", () => {
    const state = emptyAdaptation();
    expect(validateChange(state, ask("exercise.target_size_scale", 1.3), ctx).ok).toBe(true);
    expect(validateChange(state, ask("exercise.target_size_scale", 0.85), ctx).ok).toBe(false);
  });

  it("only lets things get easier after pain or 'harder'", () => {
    const safety = safetyFrom([{ day: today, at: "", source: "exercise", pain: "a_little" }], today);
    const strict = { ...ctx, safety };
    const state = emptyAdaptation();
    expect(validateChange(state, ask("exercise.hold_seconds", 1.6), strict).ok).toBe(false);
    expect(validateChange(state, ask("exercise.hold_seconds", 1.2), strict).ok).toBe(true);
    expect(validateChange(state, ask("exercise.one_compensation_points", 40), strict).ok).toBe(true);
  });

  it("compares start points against the survey default", () => {
    const state = emptyAdaptation();
    // The survey default is the high target (2); the middle target is easier.
    expect(validateChange(state, ask("assessment.reach_start_rung", 1), ctx).ok).toBe(true);
    const lowered = apply(state, ask("assessment.reach_start_rung", 0), "low");
    // Going back to where the day started is not "harder than today allows".
    expect(validateChange(lowered, ask("assessment.reach_start_rung", 2), ctx).ok).toBe(true);
    // On a later day, two steps back up at once is too much.
    expect(validateChange(lowered, ask("assessment.reach_start_rung", null), { ...ctx, today: "2026-10-03" }).ok).toBe(false);
    expect(validateChange(lowered, ask("assessment.reach_start_rung", 1), { ...ctx, today: "2026-10-03" }).ok).toBe(true);
  });

  it(`stops after ${MAX_CHANGES_PER_DAY} changes in a day`, () => {
    let state = emptyAdaptation();
    const ids = ["exercise.hold_seconds", "exercise.target_size_scale", "exercise.reps_scale", "exercise.good_rep_share"] as const;
    const values = [1.2, 1.2, 0.75, 0.85];
    ids.forEach((id, i) => { state = apply(state, ask(id, values[i]), `c${i}`); });
    expect(validateChange(state, ask("exercise.target_zone", 0.6), ctx).ok).toBe(false);
    expect(validateChange(state, ask("exercise.target_zone", 0.6), ctx, "admin").ok).toBe(true);
  });

  it("undoes a change and every later change to the same setting", () => {
    let state = emptyAdaptation();
    state = apply(state, ask("exercise.hold_seconds", 1.3), "one");
    state = apply(state, ask("exercise.target_size_scale", 1.1), "other");
    state = apply(state, ask("exercise.hold_seconds", 1.1), "two");
    const undone = revertChange(state, "one", "later");
    expect(undone.values).toEqual({ "exercise.target_size_scale": 1.1 });
    expect(undone.log.filter(entry => entry.revertedAt).map(entry => entry.id)).toEqual(["one", "two"]);
    expect(revertChange(undone, "one", "again")).toBe(undone);
    expect(resetAdaptations(state, "now").values).toEqual({});
  });
});

describe("safety reports", () => {
  it("looks at today and yesterday only", () => {
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(safetyFrom([{ day: "2026-09-29", at: "", source: "exercise", felt: "much_harder" }], today).easierOnly).toBe(false);
    expect(safetyFrom([{ day: "2026-09-30", at: "", source: "exercise", felt: "harder" }], today).easierOnly).toBe(true);
    expect(safetyFrom([{ day: today, at: "", source: "exercise", felt: "about_right", pain: "none" }], today).easierOnly).toBe(false);
  });

  it("flags a physiotherapist check for a lot of pain or stopping", () => {
    expect(safetyFrom([{ day: today, at: "", source: "warm_rep", pain: "a_lot" }], today)).toMatchObject({ easierOnly: true, checkWithPhysio: true });
    expect(safetyFrom([{ day: today, at: "", source: "exercise", stopped: true }], today)).toMatchObject({ easierOnly: true, checkWithPhysio: true });
    expect(safetyFrom([], today, { rehabBlocked: true }).easierOnly).toBe(true);
  });
});

describe("consent and the snapshot", () => {
  const raw = {
    today, extra: "dropped",
    survey: { arm_hand_movement: "tires (Yes, but it tires quickly)" },
    personal: { name: "Zak", goalInOwnWords: "Gardening again", email: "x@y.z" },
    journal: [{ day: today, mood: "good", words: "Lovely walk" }],
    movement: { warmReps: [], assessment: null, assessmentHistory: [], exerciseSessions: [], dailyScores: [], reports: [{ day: today, at: "", source: "exercise", pain: "none" }], secret: 1 },
  };

  it("only an explicit true counts as consent", () => {
    expect(readConsent({ survey: "yes", movement: 1, camera: true })).toEqual({ ...NO_CONSENT, camera: true });
    expect(readConsent(null)).toEqual(NO_CONSENT);
  });

  it("drops every category the patient did not agree to share", () => {
    expect(filterSnapshot(raw, NO_CONSENT)).toEqual({ today });
    const some = filterSnapshot(raw, { ...NO_CONSENT, survey: true, movement: true });
    expect(Object.keys(some).sort()).toEqual(["movement", "survey", "today"]);
    expect(some.movement?.reports).toHaveLength(1);
    expect(JSON.stringify(some)).not.toContain("secret");
    const personal = filterSnapshot(raw, { ...NO_CONSENT, personal: true, journal: true });
    expect(personal.personal).toEqual({ name: "Zak", goalInOwnWords: "Gardening again" });
    expect(personal.journal).toEqual([{ day: today, mood: "good", words: "Lovely walk" }]);
  });

  it("accepts at most four small still images", () => {
    const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    expect(validKeyFrames([{ label: "Reach 1", dataUrl: jpeg }, { dataUrl: "data:text/html;base64,PGI+" }, { dataUrl: `data:image/png;base64,${"A".repeat(400_001)}` }])).toEqual([{ label: "Reach 1", mediaType: "image/jpeg", data: "/9j/4AAQSkZJRg==" }]);
    expect(validKeyFrames(Array.from({ length: 6 }, () => ({ dataUrl: jpeg })))).toHaveLength(4);
    expect(validKeyFrames("nope")).toEqual([]);
  });
});
