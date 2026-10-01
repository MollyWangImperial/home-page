import { describe, expect, it } from "vitest";
import { readWarmRep } from "@shared/alira-adaptation";
import {
  safeNextPath, simulatedWarmRep, suggestedRungFor, WARM_REP_PROMPTS, WARM_REP_TIMING, WarmRepTracker, warmUpRoute, wristHeightFrom,
  type WarmRepFrame, type WarmRepOptions, type WarmRepPhase, type WarmRepState,
} from "./warm-rep";

const STEP = 50;
const OPTIONS = { side: "right" as const, source: "pre_exercise" as const, day: "2026-10-01", now: () => "2026-10-01T09:00:00.000Z", id: () => "warm-test" };

/** Seated with the hand on the lap. */
const resting = (t: number, over: Partial<WarmRepFrame> = {}): WarmRepFrame => ({
  t, visible: true, lapReady: true, shoulderFlexion: 12, elbowExtension: 150, wristY: 0.7, shoulderY: 0.4, ...over,
});
const atRest = (t: number) => resting(t);
/** Reaching forward with the shoulder at the given angle. */
const reaching = (shoulder: number, over: Partial<WarmRepFrame> = {}) => (t: number): WarmRepFrame => ({
  t, visible: true, lapReady: false, shoulderFlexion: shoulder, elbowExtension: 160, wristY: 0.4, shoulderY: 0.4,
  trunkLeanDeg: 4, shoulderElevationPct: 6, faceApproachPct: 3, ...over,
});
const hidden = (t: number): WarmRepFrame => ({ t, visible: false, missing: "Bring your hand into view.", lapReady: false });

class Driver {
  t = 0;
  states: WarmRepState[] = [];
  readonly tracker: WarmRepTracker;
  constructor(options: Partial<WarmRepOptions> = {}) {
    this.tracker = new WarmRepTracker({ ...OPTIONS, ...options });
  }
  step(make: (t: number, index: number) => WarmRepFrame, index = 0): WarmRepState {
    this.t += STEP;
    const state = this.tracker.push(make(this.t, index));
    this.states.push(state);
    return state;
  }
  /** Frames every 50 ms for the given time. */
  run(ms: number, make: (t: number, index: number) => WarmRepFrame): WarmRepState {
    const end = this.t + ms;
    for (let index = 0; this.t < end; index++) this.step(make, index);
    return this.tracker.state();
  }
  /** Frames until the phase is reached; returns the time it took. */
  until(phase: WarmRepPhase, make: (t: number, index: number) => WarmRepFrame, limitMs = 120_000): number {
    const start = this.t;
    for (let index = 0; this.tracker.state().phase !== phase && this.t - start < limitMs; index++) this.step(make, index);
    expect(this.tracker.state().phase).toBe(phase);
    return this.t - start;
  }
  /** Through finding the patient and learning the resting posture. */
  settle(make: (t: number) => WarmRepFrame = atRest) {
    this.until("rest", make);
    this.until("reach1", make);
  }
  phases(): WarmRepPhase[] {
    return this.states.map(state => state.phase).filter((phase, index, all) => index === 0 || all[index - 1] !== phase);
  }
}

const cycle = <T,>(values: T[]) => (index: number) => values[index % values.length];

describe("the warm-up state machine", () => {
  it("walks through every phase and builds today's record", () => {
    const d = new Driver();
    expect(d.tracker.state()).toMatchObject({ phase: "position", reachIndex: 0, holdProgress: 0, restProgress: 0, captureKeyFrame: false, record: null });
    // Finding the patient does not need the hand on the lap yet.
    expect(d.until("rest", t => resting(t, { lapReady: false }))).toBeGreaterThanOrEqual(WARM_REP_TIMING.positionMs);
    expect(d.until("reach1", atRest)).toBeGreaterThanOrEqual(WARM_REP_TIMING.restMs);
    expect(d.tracker.state()).toMatchObject({ reachIndex: 1, restProgress: 1, rest: { shoulderFlexion: 12, elbowExtension: 150, wristY: 0.7, shoulderY: 0.4 } });
    expect(d.until("relax1", reaching(70))).toBeGreaterThanOrEqual(WARM_REP_TIMING.holdMs);
    expect(d.tracker.state().prompt).toBe(WARM_REP_PROMPTS.relaxHeld);
    d.until("reach2", atRest);
    expect(d.tracker.state()).toMatchObject({ reachIndex: 2, prompt: WARM_REP_PROMPTS.reachAgain });
    d.until("relax2", reaching(80, { wristY: 0.2 }));
    d.until("done", atRest);
    expect(d.phases()).toEqual(["position", "rest", "reach1", "relax1", "reach2", "relax2", "done"]);

    const record = d.tracker.state().record!;
    expect(record).toMatchObject({
      id: "warm-test", day: "2026-10-01", at: "2026-10-01T09:00:00.000Z", source: "pre_exercise", side: "right", simulated: false,
      rest: { shoulderFlexion: 12, elbowExtension: 150 },
      reaches: [
        { shoulderFlexion: 70, elbowExtension: 160, wristHeight: 1, trunkLeanDeg: 4, shoulderElevationPct: 6, faceApproachPct: 3, heldMs: 1500 },
        { shoulderFlexion: 80, elbowExtension: 160, wristHeight: 1.67, trunkLeanDeg: 4, shoulderElevationPct: 6, faceApproachPct: 3, heldMs: 1500 },
      ],
      bestExcursionDeg: 68, suggestedReachRung: 2,
    });
    expect(record.best).toEqual(record.reaches[1]);
    expect(d.tracker.state().prompt).toBe(WARM_REP_PROMPTS.done);
    // The record survives the shared reader unchanged.
    expect(readWarmRep(record)).toEqual(record);
  });

  it("ignores frames once it is done", () => {
    const d = new Driver();
    d.settle();
    d.until("relax1", reaching(60));
    d.until("reach2", atRest);
    d.until("relax2", reaching(60));
    d.until("done", atRest);
    const record = d.tracker.state().record;
    const after = d.step(reaching(90));
    expect(after).toMatchObject({ phase: "done", captureKeyFrame: false });
    expect(after.record).toBe(record);
  });

  it("asks for a still exactly once per completed hold", () => {
    const d = new Driver();
    d.settle();
    d.until("relax1", reaching(70));
    d.until("reach2", atRest);
    d.until("relax2", reaching(75));
    d.until("done", atRest);
    const flagged = d.states.filter(state => state.captureKeyFrame);
    expect(flagged).toHaveLength(2);
    expect(flagged.map(state => state.phase)).toEqual(["relax1", "relax2"]);
    // Only the push that completed the hold carries the flag.
    const first = d.states.indexOf(flagged[0]);
    expect(d.states[first + 1].captureKeyFrame).toBe(false);
  });
});

describe("what it measures", () => {
  it("takes the resting posture and each hold as medians, not single frames", () => {
    const d = new Driver();
    d.until("rest", atRest);
    const shoulder = cycle([10, 12, 14]);
    const elbow = cycle([148, 150, 152]);
    const wrist = cycle([0.69, 0.7, 0.71]);
    const top = cycle([0.39, 0.4, 0.41]);
    d.until("reach1", (t, i) => resting(t, { shoulderFlexion: shoulder(i), elbowExtension: elbow(i), wristY: wrist(i), shoulderY: top(i) }));
    expect(d.tracker.state().rest).toMatchObject({ shoulderFlexion: 12, elbowExtension: 150, wristY: 0.7, shoulderY: 0.4 });

    const reachAngle = cycle([66, 70, 74]);
    const reachElbow = cycle([150, 160, 170]);
    const lean = cycle([2, 4, 9]);
    const lift = cycle([3, 6, undefined]);
    const height = cycle([0.37, 0.4, 0.43]);
    d.until("relax1", (t, i) => reaching(reachAngle(i), { elbowExtension: reachElbow(i), trunkLeanDeg: lean(i), shoulderElevationPct: lift(i), faceApproachPct: undefined, wristY: height(i) })(t));
    expect(d.tracker.state().reaches[0]).toMatchObject({
      shoulderFlexion: 70, elbowExtension: 160, trunkLeanDeg: 4, wristHeight: 1, faceApproachPct: null,
    });
    // Elevation: the median of the frames that measured it.
    expect([3, 4.5, 6]).toContain(d.tracker.state().reaches[0]!.shoulderElevationPct);
  });

  it("chooses the reach with the larger movement as the best", () => {
    const d = new Driver();
    d.settle();
    d.until("relax1", reaching(85, { wristY: 0.25 }));
    d.until("reach2", atRest);
    d.until("relax2", reaching(60, { wristY: 0.45 }));
    d.until("done", atRest);
    const record = d.tracker.state().record!;
    expect(record.best).toEqual(record.reaches[0]);
    expect(record.bestExcursionDeg).toBe(73);
    // (0.7 - 0.25) / (0.7 - 0.4) = 1.5: at or above the middle target, below the high one.
    expect(record.best?.wristHeight).toBe(1.5);
    expect(record.suggestedReachRung).toBe(1);
  });

  it("maps wrist height to the movement check's reach targets", () => {
    expect(suggestedRungFor(null)).toBeNull();
    expect(suggestedRungFor(undefined)).toBeNull();
    expect(suggestedRungFor(Number.NaN)).toBeNull();
    expect(suggestedRungFor(0.4)).toBe(0);
    expect(suggestedRungFor(1.19)).toBe(0);
    expect(suggestedRungFor(1.2)).toBe(1);
    expect(suggestedRungFor(1.59)).toBe(1);
    expect(suggestedRungFor(1.6)).toBe(2);
    expect(suggestedRungFor(2.2)).toBe(2);
    expect(wristHeightFrom({ wristY: 0.7, shoulderY: 0.4 }, 0.22)).toBe(1.6);
    expect(wristHeightFrom({ wristY: 0.7, shoulderY: 0.4 }, 0.7)).toBe(0);
    expect(wristHeightFrom({ wristY: 0.42, shoulderY: 0.4 }, 0.3)).toBeNull();
    expect(wristHeightFrom({ wristY: null, shoulderY: 0.4 }, 0.3)).toBeNull();
    expect(wristHeightFrom({ wristY: 0.7, shoulderY: 0.4 }, null)).toBeNull();
  });

  it("leaves wrist height and the suggested start empty when the resting posture cannot tell", () => {
    const d = new Driver();
    d.settle(t => resting(t, { wristY: 0.43, shoulderY: 0.4 }));
    d.until("relax1", reaching(70, { wristY: 0.3 }));
    d.until("reach2", atRest);
    d.until("relax2", reaching(72, { wristY: 0.3 }));
    d.until("done", atRest);
    const record = d.tracker.state().record!;
    expect(record.reaches.map(reach => reach?.wristHeight)).toEqual([null, null]);
    expect(record.best).not.toBeNull();
    expect(record.suggestedReachRung).toBeNull();
  });
});

describe("never a failure", () => {
  it("records a reach that is not held as null and moves on without throwing", () => {
    const d = new Driver();
    d.settle();
    // Not moving: after a while the prompt gently says any amount is fine.
    d.run(WARM_REP_TIMING.encourageMs + 200, atRest);
    expect(d.tracker.state()).toMatchObject({ phase: "reach1", prompt: WARM_REP_PROMPTS.anyReach });
    const waited = d.until("relax1", atRest);
    expect(waited + WARM_REP_TIMING.encourageMs + 200).toBeGreaterThanOrEqual(WARM_REP_TIMING.reachTimeoutMs);
    expect(waited + WARM_REP_TIMING.encourageMs + 200).toBeLessThanOrEqual(WARM_REP_TIMING.reachTimeoutMs + 2 * STEP);
    expect(d.tracker.state()).toMatchObject({ reaches: [null], prompt: WARM_REP_PROMPTS.relaxFree, captureKeyFrame: false });
    d.until("reach2", atRest);
    d.until("relax2", reaching(64));
    d.until("done", atRest);
    const record = d.tracker.state().record!;
    expect(record.reaches[0]).toBeNull();
    expect(record.best).toEqual(record.reaches[1]);
    expect(record.bestExcursionDeg).toBe(52);
    expect(d.states.filter(state => state.captureKeyFrame)).toHaveLength(1);
    expect(readWarmRep(record)).toEqual(record);
  });

  it("finishes with no best reach when neither reach is held", () => {
    const d = new Driver();
    d.settle();
    d.until("relax1", atRest);
    d.until("reach2", atRest);
    d.until("relax2", atRest);
    d.until("done", atRest);
    expect(d.tracker.state().record).toMatchObject({ reaches: [null, null], best: null, bestExcursionDeg: null, suggestedReachRung: null });
  });

  it("relaxes once the arm comes most of the way down", () => {
    const d = new Driver();
    d.settle();
    d.until("relax1", reaching(70));
    // Movement 58 degrees, so below 23.2 degrees counts as relaxed: 30 degrees is 18 from rest.
    d.run(WARM_REP_TIMING.relaxMs - STEP, () => resting(d.t, { shoulderFlexion: 30 }));
    expect(d.tracker.state().phase).toBe("relax1");
    d.run(2 * STEP, () => resting(d.t, { shoulderFlexion: 30 }));
    expect(d.tracker.state().phase).toBe("reach2");
  });

  it("moves on after a pause even if the arm stays up", () => {
    const d = new Driver();
    d.settle();
    d.until("relax1", reaching(70));
    d.run(WARM_REP_TIMING.relaxTimeoutMs - 2 * STEP, reaching(60));
    expect(d.tracker.state().phase).toBe("relax1");
    d.run(3 * STEP, reaching(60));
    expect(d.tracker.state().phase).toBe("reach2");
  });
});

describe("lost tracking", () => {
  it("pauses the reach timer while the patient is out of view", () => {
    const d = new Driver();
    d.settle();
    d.run(20_000, atRest);
    d.run(30_000, hidden);
    expect(d.tracker.state()).toMatchObject({ phase: "reach1", prompt: "Bring your hand into view.", holdProgress: 0 });
    d.run(4500, atRest);
    expect(d.tracker.state().phase).toBe("reach1");
    d.run(1000, atRest);
    expect(d.tracker.state()).toMatchObject({ phase: "relax1", reaches: [null] });
  });

  it("starts the hold again after tracking is lost", () => {
    const d = new Driver();
    d.settle();
    d.run(1000, reaching(70));
    const before = d.tracker.state().holdProgress;
    expect(before).toBeGreaterThan(0.5);
    expect(before).toBeLessThan(1);
    expect(d.step(hidden)).toMatchObject({ holdProgress: 0, phase: "reach1", prompt: "Bring your hand into view." });
    // Two seconds of reaching in all, but the hold counted again from the lost frame.
    d.run(1000, reaching(70));
    expect(d.tracker.state().phase).toBe("reach1");
    expect(d.tracker.state().holdProgress).toBeCloseTo(before, 6);
    d.run(600, reaching(70));
    expect(d.tracker.state().phase).toBe("relax1");
    expect(d.tracker.state().reaches[0]?.heldMs).toBe(1500);
  });

  it("needs a steady hold, so wobbling keeps it going", () => {
    const d = new Driver();
    d.settle();
    // Swinging between 40 and 70 degrees is reaching, but not a hold.
    d.run(3000, (t, i) => reaching(i % 10 < 5 ? 40 : 70)(t));
    expect(d.tracker.state().phase).toBe("reach1");
    d.until("relax1", reaching(70));
    expect(d.tracker.state().reaches[0]?.shoulderFlexion).toBe(70);
  });

  it("explains what is missing while finding the patient and settling", () => {
    const d = new Driver();
    expect(d.step(t => ({ t, visible: false, missing: "Lower the phone a little so I can see your face.", lapReady: false }))).toMatchObject({ phase: "position", prompt: "Lower the phone a little so I can see your face." });
    expect(d.step(t => ({ t, visible: false, lapReady: false }))).toMatchObject({ prompt: WARM_REP_PROMPTS.findYou });
    d.until("rest", atRest);
    d.run(500, atRest);
    expect(d.tracker.state().restProgress).toBeGreaterThan(0);
    const lap = d.step(t => resting(t, { lapReady: false, lapMissing: "Rest your right hand on your right thigh, closer to your body." }));
    expect(lap).toMatchObject({ phase: "rest", restProgress: 0, prompt: "Rest your right hand on your right thigh, closer to your body." });
    // Fidgeting at rest delays settling until the last moments are steady.
    d.run(1000, (t, i) => resting(t, { shoulderFlexion: i % 2 ? 10 : 30 }));
    expect(d.tracker.state()).toMatchObject({ phase: "rest", prompt: WARM_REP_PROMPTS.settle });
    d.until("reach1", atRest);
    expect(d.tracker.state().rest?.shoulderFlexion).toBe(12);
  });

  it("treats a long pause between frames as a break", () => {
    const d = new Driver();
    d.run(600, atRest);
    d.t += 1500;
    d.run(600, atRest);
    // 1.2 s of frames in all, but not 1 s in a row.
    expect(d.tracker.state().phase).toBe("position");
    d.until("rest", atRest);
  });
});

describe("the warm-up page's address", () => {
  it("accepts only the three gates and same-site paths to go to next", () => {
    expect(warmUpRoute("")).toEqual({ gate: "survey_end", next: "/alira", back: "/alira" });
    expect(warmUpRoute("gate=pre_exercise&next=%2Fexercise%2Fex_reach%3Ffrom%3Djourney")).toEqual({ gate: "pre_exercise", next: "/exercise/ex_reach?from=journey", back: "/alira" });
    // Earlier links return to Alira's invitation rather than starting the assessment automatically.
    expect(warmUpRoute("?gate=survey_end&next=%2Fassessment%3Fonboarding%3D1")).toEqual({ gate: "survey_end", next: "/alira?onboarding=1&from=warm-up", back: "/alira?onboarding=1" });
    expect(warmUpRoute("gate=pre_assessment&next=%2Fassessment")).toEqual({ gate: "pre_assessment", next: "/alira?from=warm-up", back: "/alira" });
    expect(warmUpRoute("gate=survey_end&next=%2Falira%3Fonboarding%3D1%26from%3Dwarm-up")).toEqual({ gate: "survey_end", next: "/alira?onboarding=1&from=warm-up", back: "/alira?onboarding=1" });
    expect(warmUpRoute("gate=admin&next=/journey").gate).toBe("survey_end");
    for (const next of ["https://example.com", "//example.com", "/\\example.com", "javascript:alert(1)", "assessment", "/a\nb"]) {
      expect(safeNextPath(next)).toBe("/alira");
    }
    expect(safeNextPath(null)).toBe("/alira");
    expect(safeNextPath("/journey?tab=progress")).toBe("/journey?tab=progress");
  });
});

describe("the testing warm-up", () => {
  it("is plausible, marked simulated and passes the shared reader", () => {
    const record = simulatedWarmRep({ side: "left", source: "survey_end", day: "2026-10-01", now: () => "2026-10-01T10:00:00.000Z", id: () => "sim-1" });
    expect(record).toMatchObject({ id: "sim-1", day: "2026-10-01", side: "left", source: "survey_end", simulated: true });
    expect(record.reaches).toHaveLength(2);
    expect(record.best).toEqual(record.reaches[1]);
    expect(record.bestExcursionDeg).toBe(60);
    expect(record.suggestedReachRung).toBe(1);
    expect(readWarmRep(record)).toEqual(record);
  });

  it("marks a tracker record as simulated when frames come from a simulator", () => {
    const d = new Driver({ simulated: true, source: "pre_assessment", side: "left" });
    expect(d.tracker.state().record).toBeNull();
    d.settle();
    d.until("relax1", reaching(70));
    d.until("reach2", atRest);
    d.until("relax2", reaching(70));
    d.until("done", atRest);
    expect(d.tracker.state().record).toMatchObject({ simulated: true, source: "pre_assessment", side: "left" });
  });
});
