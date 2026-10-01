import { describe, expect, it } from "vitest";
import { EXERCISES, LAUNCH_EXERCISE_IDS, REPS_BY_RUNG, type Rung } from "./config";
import { isGoodRep, isMiss, repScore, SCORING, type HoldOutcome } from "./scoring";
import { ExerciseSession, simFrame, type Voice } from "./session";
import { TARGET_HOLD_MS } from "./target-timing";
import { ADAPTATION_VERSION, DEFAULT_EXERCISE_TUNING, exerciseTuning, type ExerciseTuning, type ParamValues } from "../../../../shared/alira-adaptation";

// Alira's learning may only change a fixed, bounded set of settings. These tests check that the
// engine applies each one, and that with the default tuning nothing differs from the engine before.

const FRAME_MS = 33;
const tuned = (values: ParamValues) => exerciseTuning(values);
const quiet = (said: string[] = []): Voice => ({ say: text => said.push(text), busy: () => false, stop: () => {} });

type Profile = (repNumber: number) => { level: number; compensations: string[] };
type RunOptions = { reps?: number; tuning?: ExerciseTuning; maxSeconds?: number };

/** The simulated patient from session.test.ts: holds each movement until the gauge is full, then rests. */
function run(exerciseId: string, rung: Rung, profile: Profile, opts: RunOptions = {}) {
  const said: string[] = [];
  const session = new ExerciseSession({ exerciseId, rung, side: "right", repsOverride: opts.reps, tuning: opts.tuning }, quiet(said));
  const trace: unknown[] = [];
  let t = 0;
  session.start(t);
  const limit = (opts.maxSeconds ?? 600) * 1000;
  while (t < limit && session.snapshot().phase !== "done") {
    t += FRAME_MS;
    const snap = session.snapshot();
    const step = session.currentStep;
    const moving = (snap.phase === "warm" || snap.phase === "reps") && step && (step.kind === "reach" || step.kind === "open" || step.kind === "pinch");
    const p = snap.phase === "reps" ? profile(snap.repIndex) : { level: 1, compensations: [] as string[] };
    session.push(simFrame(t, session.cfg, session.targets(), { level: moving && snap.holdProgress < 1 ? p.level : 0, compensations: moving ? p.compensations : [] }));
    const after = session.snapshot();
    trace.push([after.phase, after.repIndex, after.stepIndex, after.holdProgress, after.inZone, after.liveAttainment, after.rung]);
  }
  expect(session.snapshot().phase, exerciseId).toBe("done");
  return { session, said, trace, record: session.snapshot().record! };
}

/** Camera-style contact frames on forward reach, as in session.test.ts: 100 ms per frame from the practice rep. */
function contactSession(tuning?: ExerciseTuning) {
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right", tuning }, quiet());
  session.start(0); session.skipAhead(1); session.skipAhead(2);
  let t = 2;
  const push = (contact = true) => {
    t += 100;
    session.push({ ...simFrame(t, session.cfg, session.targets(), { level: session.currentStep?.kind === "reach" ? 1 : 0, compensations: [] }), targetContact: contact });
  };
  const armed = () => {
    for (let n = 0; n < 200 && !session.snapshot().targetArmed; n++) push(false);
    expect(session.snapshot().targetArmed).toBe(true);
  };
  return { session, push, armed };
}

/** An angle-scored exercise brought to its first scored movement, armed, with the hand still at rest. */
function angleSession(exerciseId: string, rung: Rung, tuning?: ExerciseTuning) {
  const session = new ExerciseSession({ exerciseId, rung, side: "right", repsOverride: 3, tuning }, quiet());
  let t = 0;
  session.start(t);
  const push = (level: number, ms = FRAME_MS) => {
    t += ms;
    session.push(simFrame(t, session.cfg, session.targets(), { level, compensations: [] }));
    return session.snapshot();
  };
  for (let n = 0; n < 5000 && session.snapshot().phase !== "reps"; n++) {
    const snap = session.snapshot();
    const kind = session.currentStep?.kind;
    push(snap.phase === "warm" && kind !== "return" && kind !== "close" && snap.holdProgress < 1 ? 1 : 0);
  }
  for (let n = 0; n < 500 && !session.snapshot().targetArmed; n++) push(0);
  expect(session.snapshot().phase).toBe("reps");
  expect(session.snapshot().targetArmed).toBe(true);
  expect(session.currentStep?.kind).toBe("reach");
  expect(session.snapshot().holdProgress).toBe(0);
  return { session, push };
}

describe("default tuning changes nothing", () => {
  it("matches the engine's own constants and the scoring functions' defaults", () => {
    expect(DEFAULT_EXERCISE_TUNING.adapted).toBe(false);
    expect(DEFAULT_EXERCISE_TUNING.changed).toEqual({});
    expect(DEFAULT_EXERCISE_TUNING.holdFactor).toBe(1);
    expect(DEFAULT_EXERCISE_TUNING.holdSeconds * 1000).toBe(TARGET_HOLD_MS);
    expect(DEFAULT_EXERCISE_TUNING.repsScale).toBe(1);
    expect(DEFAULT_EXERCISE_TUNING.targetZone).toBe(SCORING.targetZone);
    expect(DEFAULT_EXERCISE_TUNING.goodRepShare).toBe(SCORING.goodRepAttainment);
    expect(DEFAULT_EXERCISE_TUNING.oneCompensationPoints).toBe(SCORING.oneCompensationScore);
    for (const att of [0, 0.5, 0.65, 0.69, 0.7, 0.85, 0.89, 0.9, 1]) {
      expect(isMiss(att, DEFAULT_EXERCISE_TUNING.targetZone)).toBe(isMiss(att));
      for (const hold of ["full", "touched", "none"] as HoldOutcome[]) {
        for (const comps of [0, 1, 2, 3]) {
          expect(repScore(att, hold, comps, DEFAULT_EXERCISE_TUNING.oneCompensationPoints)).toBe(repScore(att, hold, comps));
          expect(isGoodRep(att, hold, comps, DEFAULT_EXERCISE_TUNING.goodRepShare)).toBe(isGoodRep(att, hold, comps));
        }
      }
    }
  });

  it.each([1, 2, 3] as Rung[])("runs every launch exercise frame for frame as without tuning (rung %i)", rung => {
    const profile: Profile = rep => ({ level: rep % 3 === 2 ? 0.82 : 1, compensations: [] });
    for (const id of LAUNCH_EXERCISE_IDS) {
      // The third rep adds the exercise's first compensation, so compensation scoring is compared too.
      const leaning: Profile = rep => ({ ...profile(rep), compensations: rep === 3 ? EXERCISES[id].compensations.slice(0, 1).map(comp => comp.id) : [] });
      const plain = run(id, rung, leaning);
      for (const tuning of [DEFAULT_EXERCISE_TUNING, exerciseTuning({}), exerciseTuning(undefined)]) {
        const other = run(id, rung, leaning, { tuning });
        expect(other.trace, id).toEqual(plain.trace);
        expect(other.said, id).toEqual(plain.said);
        expect({ ...other.record, finished_at: "" }, id).toEqual({ ...plain.record, finished_at: "" });
      }
      expect(plain.record.reps_planned, id).toBe(REPS_BY_RUNG[rung]);
    }
  });

  it("keeps the 1.5 s contact hold and the familiar scores", () => {
    const { session, push, armed } = contactSession(DEFAULT_EXERCISE_TUNING);
    armed();
    for (let n = 0; n < 5; n++) push();
    expect(session.snapshot().holdProgress).toBeCloseTo(1 / 3);
    for (let n = 0; n < 9; n++) push();
    expect(session.currentStep?.kind).toBe("reach");
    push();
    expect(session.currentStep?.kind).toBe("return");
    const { record } = run("ex_reach", 2, rep => ({ level: 1, compensations: rep === 1 ? [] : rep === 2 ? ["trunk_lean"] : ["trunk_lean", "shoulder_hike"] }), { reps: 3, tuning: DEFAULT_EXERCISE_TUNING });
    expect(record.repetition_scores).toEqual([100, 30, 15]);
    expect(record.score).toBe(48);
    expect(record.quality_reps).toBe(1);
  });
});

describe("hold time", () => {
  it("a hold factor of 0.8 makes the contact hold 1200 ms for the practice circle, the lap circle and a scored reach", () => {
    const tuning = tuned({ "exercise.hold_seconds": 1.2 });
    expect(tuning.holdFactor).toBe(0.8);
    const { session, push, armed } = contactSession(tuning);
    // Practice (warm) reach.
    armed();
    for (let n = 0; n < 5; n++) push();
    expect(session.snapshot().holdProgress).toBeCloseTo(500 / 1200);
    for (let n = 0; n < 6; n++) push();
    expect(session.currentStep?.kind).toBe("reach");
    expect(session.snapshot().holdProgress).toBeCloseTo(1100 / 1200);
    push();
    expect(session.currentStep?.kind).toBe("return");
    // The lap circle fills at the same rate and needs the same 1200 ms.
    armed();
    for (let n = 0; n < 5; n++) push();
    expect(session.snapshot().holdProgress).toBeCloseTo(500 / 1200);
    for (let n = 0; n < 6; n++) push();
    expect(session.snapshot().phase).toBe("warm");
    push();
    expect(session.snapshot().phase).toBe("reps");
    // A scored reach uses the same hold.
    armed();
    for (let n = 0; n < 11; n++) push();
    expect(session.currentStep?.kind).toBe("reach");
    expect(session.snapshot().holdProgress).toBeCloseTo(1100 / 1200);
    push();
    expect(session.currentStep?.kind).toBe("return");
  });

  it("scales an angle-scored step's hold by the same factor", () => {
    // Seated toe lift at level 2: a 1000 ms hold at the medium dose (hold scale 1).
    const standard = angleSession("ex_ankle_dorsiflexion", 2);
    const shorter = angleSession("ex_ankle_dorsiflexion", 2, tuned({ "exercise.hold_seconds": 1.2 }));
    for (let n = 0; n < 4; n++) { standard.push(1, 100); shorter.push(1, 100); }
    expect(standard.session.snapshot().holdProgress).toBeCloseTo(0.4);
    expect(shorter.session.snapshot().holdProgress).toBeCloseTo(0.5);
    for (let n = 0; n < 3; n++) shorter.push(1, 100);
    expect(shorter.session.currentStep?.kind).toBe("reach");
    shorter.push(1, 100);
    expect(shorter.session.currentStep?.kind).toBe("return");
    expect(standard.session.currentStep?.kind).toBe("reach");
  });
});

describe("planned repetitions", () => {
  it("scales the planned repetitions, never below three, and a quick test's override wins", () => {
    const plan = (rung: Rung, tuning?: ExerciseTuning, repsOverride?: number) =>
      new ExerciseSession({ exerciseId: "ex_reach", rung, side: "right", tuning, repsOverride }, quiet()).snapshot().repsPlanned;
    const half = tuned({ "exercise.reps_scale": 0.5 });
    expect([plan(1), plan(2), plan(3)]).toEqual([6, 8, 10]);
    expect([plan(1, half), plan(2, half), plan(3, half)]).toEqual([3, 4, 5]);
    expect(plan(3, tuned({ "exercise.reps_scale": 1.25 }))).toBe(13);
    expect(plan(1, half, 2)).toBe(2);
    expect(plan(3, tuned({ "exercise.reps_scale": 1.25 }), 3)).toBe(3);
  });

  it("runs, announces and records the tuned number of repetitions", () => {
    const { record, said, session } = run("ex_wallslide", 1, () => ({ level: 1, compensations: [] }), { tuning: tuned({ "exercise.reps_scale": 0.5 }) });
    expect(session.snapshot().repsPlanned).toBe(3);
    expect(record.reps_planned).toBe(3);
    expect(record.repetition_scores).toEqual([100, 100, 100]);
    expect(record.score).toBe(100);
    expect(said).toContain("Good. Now three repetitions.");
  });

  it("keeps the tuned number of repetitions after a rescue lowers the level", () => {
    const { record, said } = run("ex_reach", 3, rep => ({ level: rep <= 2 ? 0.55 : 1, compensations: [] }), { tuning: tuned({ "exercise.reps_scale": 0.5 }) });
    expect(said).toContain("Let's bring the target a little closer.");
    expect(record.rung_end).toBe(2);
    expect(record.reps_planned).toBe(5);
    expect(record.repetition_scores).toHaveLength(5);
  });
});

describe("target zone", () => {
  it("counts a 0.65 reach as in the zone on an angle-scored exercise when the zone is 0.6", () => {
    const standard = angleSession("ex_ankle_dorsiflexion", 2);
    const wider = angleSession("ex_ankle_dorsiflexion", 2, tuned({ "exercise.target_zone": 0.6 }));
    for (let n = 0; n < 3; n++) { standard.push(0.65, 100); wider.push(0.65, 100); }
    expect(standard.session.snapshot().liveAttainment).toBeCloseTo(0.65);
    expect(standard.session.snapshot().inZone).toBe(false);
    expect(standard.session.snapshot().holdProgress).toBe(0);
    expect(wider.session.snapshot().liveAttainment).toBeCloseTo(0.65);
    expect(wider.session.snapshot().inZone).toBe(true);
    expect(wider.session.snapshot().holdProgress).toBeCloseTo(0.3);
  });

  it("changes the miss rule: two 0.65 reps no longer bring the target closer", () => {
    const profile: Profile = rep => ({ level: rep <= 2 ? 0.65 : 1, compensations: [] });
    expect(isMiss(0.65)).toBe(true);
    expect(isMiss(0.65, 0.6)).toBe(false);
    const standard = run("ex_ankle_dorsiflexion", 3, profile, { reps: 4 });
    expect(standard.said).toContain("Let's bring the target a little closer.");
    expect(standard.record.rung_end).toBe(2);
    const wider = run("ex_ankle_dorsiflexion", 3, profile, { reps: 4, tuning: tuned({ "exercise.target_zone": 0.6 }) });
    expect(wider.said).not.toContain("Let's bring the target a little closer.");
    expect(wider.record.rung_end).toBe(3);
    expect(wider.record.repetition_scores.slice(0, 2)).toEqual([65, 65]);
  });
});

describe("grading", () => {
  it("a good-repetition share of 0.8 makes a 0.85 repetition good", () => {
    const profile: Profile = () => ({ level: 0.85, compensations: [] });
    expect(isGoodRep(0.85, "full", 0)).toBe(false);
    expect(isGoodRep(0.85, "full", 0, 0.8)).toBe(true);
    const standard = run("ex_ankle_dorsiflexion", 2, profile, { reps: 3 });
    const kinder = run("ex_ankle_dorsiflexion", 2, profile, { reps: 3, tuning: tuned({ "exercise.good_rep_share": 0.8 }) });
    expect(standard.session.snapshot().reps.map(rep => rep.attainment)).toEqual(kinder.session.snapshot().reps.map(rep => rep.attainment));
    expect(kinder.session.snapshot().reps[0].attainment).toBeCloseTo(0.85);
    expect(standard.session.snapshot().reps.map(rep => rep.good)).toEqual([false, false, false]);
    expect(kinder.session.snapshot().reps.map(rep => rep.good)).toEqual([true, true, true]);
    expect(standard.record.quality_reps).toBe(0);
    expect(kinder.record.quality_reps).toBe(3);
    // Grading only: the scores themselves do not change.
    expect(kinder.record.repetition_scores).toEqual(standard.record.repetition_scores);
    expect(kinder.record.repetition_scores).toEqual([85, 85, 85]);
  });

  it("one compensation scores the tuned points; two or more still score 15", () => {
    expect(repScore(1, "full", 1, 45)).toBe(45);
    expect(repScore(1, "full", 2, 45)).toBe(15);
    const { record } = run("ex_reach", 2, rep => ({ level: 1, compensations: rep === 1 ? [] : rep === 2 ? ["trunk_lean"] : ["trunk_lean", "shoulder_hike"] }),
      { reps: 3, tuning: tuned({ "exercise.one_compensation_points": 45 }) });
    expect(record.repetition_scores).toEqual([100, 45, 15]);
    expect(record.score).toBe(53);
    expect(record.quality_reps).toBe(1);
  });
});

describe("tuning is fixed for the session and recorded", () => {
  it("is a frozen copy taken at construction, unaffected by later changes to the object passed in", () => {
    const given = tuned({ "exercise.hold_seconds": 1.2 });
    const { session, push, armed } = contactSession(given);
    given.holdFactor = 2;
    given.holdSeconds = 3;
    given.repsScale = 0.5;
    given.targetZone = 0.55;
    given.adapted = false;
    given.changed["exercise.hold_seconds"] = 2.5;
    given.changed["exercise.reps_scale"] = 0.5;
    expect(session.tuning.holdFactor).toBe(0.8);
    expect(session.tuning.adapted).toBe(true);
    expect(session.tuning.changed).toEqual({ "exercise.hold_seconds": 1.2 });
    expect(session.snapshot().repsPlanned).toBe(6);
    expect(Object.isFrozen(session.tuning)).toBe(true);
    expect(Object.isFrozen(session.tuning.changed)).toBe(true);
    expect(() => { (session.tuning as { holdFactor: number }).holdFactor = 3; }).toThrow(TypeError);
    armed();
    for (let n = 0; n < 5; n++) push();
    expect(session.snapshot().holdProgress).toBeCloseTo(500 / 1200);
  });

  it("uses the defaults when no tuning is given", () => {
    const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right" }, quiet());
    expect(session.tuning).toEqual(DEFAULT_EXERCISE_TUNING);
    expect(session.tuning).not.toBe(DEFAULT_EXERCISE_TUNING);
  });

  it("the session record carries the adaptation it ran with", () => {
    const standard = run("ex_wallslide", 2, () => ({ level: 1, compensations: [] }), { reps: 3 });
    expect(standard.record.adaptation).toEqual({ version: ADAPTATION_VERSION, adapted: false, changed: {} });
    const tuning = tuned({ "exercise.hold_seconds": 1.2, "exercise.reps_scale": 0.5 });
    const adapted = run("ex_wallslide", 2, () => ({ level: 1, compensations: [] }), { tuning });
    expect(adapted.record.adaptation).toEqual({ version: ADAPTATION_VERSION, adapted: true, changed: { "exercise.hold_seconds": 1.2, "exercise.reps_scale": 0.5 } });
    expect(adapted.record.adaptation!.changed).not.toBe(tuning.changed);
    // A skipped session records its tuning too.
    const skipped = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right", tuning }, quiet());
    skipped.start(0);
    skipped.skip(1);
    expect(skipped.snapshot().record?.not_attempted).toBe(true);
    expect(skipped.snapshot().record?.adaptation?.adapted).toBe(true);
  });
});
