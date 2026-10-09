import { describe, expect, it } from "vitest";
import {
  analyzeGait, GAIT_RAMPS, GAIT_REASONS, GAIT_WEIGHTS, gaitComponents, gaitScore, gaitSetupCheck, HELD_WALKING_CAP, LiveGait,
  METRES_PER_LEG, syntheticWalk, trunkAngleDeg, TURN_PHONE_HINT, type GaitFrame, type SyntheticWalkParams,
} from "./gait";
import type { GaitMetrics, GaitResult, WalkAssist } from "./types";

// A little landmark jitter on every walker, as the pose model gives.
const walk = (params: SyntheticWalkParams = {}) => syntheticWalk({ noise: 0.002, ...params });
/** The standing baseline as the set-up records it: the trunk angle in a frame before the walk starts. */
const standing = (frames: GaitFrame[]) => trunkAngleDeg(frames[5].landmarks, frames[5].aspect) ?? undefined;
const analyse = (params: SyntheticWalkParams = {}, assist: WalkAssist = "none") => {
  const frames = walk(params);
  return analyzeGait(frames, { assist, standingTrunkDeg: standing(frames) });
};
function scored(result: GaitResult): Extract<GaitResult, { status: "scored" }> {
  if (result.status !== "scored") throw new Error(`not scored: ${result.status} ${"reason" in result ? result.reason : ""}`);
  return result;
}
const metricsOf = (params: SyntheticWalkParams = {}) => scored(analyse(params)).metrics;
/** The walker's real speed in leg lengths a second: mean step length × steps a second. */
const trueSpeed = (stepLength: number, cadence: number) => stepLength * cadence / 60;

describe("analyzeGait: recovering a side-on walk", () => {
  it("recovers speed, cadence, even steps, knee bend and trunk lean of an even walker", () => {
    const m = metricsOf({ cadence: 100, stepLength: 0.75, kneeFlex: 60, trunkLean: 3 });
    expect(m.passes).toBe(2);
    expect(m.speedLegPerS).toBeGreaterThan(trueSpeed(0.75, 100) * 0.9);
    expect(m.speedLegPerS).toBeLessThan(trueSpeed(0.75, 100) * 1.05);
    expect(m.speedMpsEstimate).toBeCloseTo(m.speedLegPerS * METRES_PER_LEG, 10);
    expect(m.cadence).toBeGreaterThan(96);
    expect(m.cadence).toBeLessThan(104);
    expect(m.stepLengthSymmetry).toBeGreaterThan(0.95);
    expect(m.stepTimeSymmetry).toBeGreaterThan(0.95);
    expect(m.stepLengthA).toBeCloseTo(0.75, 1);
    expect(m.stepLengthB).toBeCloseTo(0.75, 1);
    expect(Math.abs(m.kneeFlexPeak! - 60)).toBeLessThan(4);
    expect(Math.abs(m.trunkLeanDeg! - 3)).toBeLessThan(1);
    expect(m.steps).toBeGreaterThanOrEqual(8);
    expect(m.seenShare).toBe(1);
    expect(m.sideOnRatio).toBeLessThan(0.3);
  });

  it("recovers uneven step length and timing, and each side's knee bend", () => {
    // Side B: shorter, slower steps and a stiffer knee.
    const m = metricsOf({ stepLengthRatio: 0.75, stepTimeRatio: 1.25, kneeFlex: [55, 35] });
    expect(Math.abs(m.stepLengthSymmetry! - 0.75)).toBeLessThan(0.05);
    expect(Math.abs(m.stepTimeSymmetry! - 0.8)).toBeLessThan(0.05);
    expect(m.stepLengthA!).toBeGreaterThan(m.stepLengthB!);
    expect(Math.abs(m.kneeFlexA! - 55)).toBeLessThan(4);
    expect(Math.abs(m.kneeFlexB! - 35)).toBeLessThan(4);
    expect(m.kneeFlexPeak).toBe(m.kneeFlexB);
  });

  it("keeps the sides apart whichever way the walk starts", () => {
    for (const startDir of [1, -1] as const) {
      const m = metricsOf({ startDir, stepLengthRatio: 0.75, kneeFlex: [58, 32] });
      expect(Math.abs(m.stepLengthSymmetry! - 0.75)).toBeLessThan(0.05);
      expect(m.kneeFlexA!).toBeGreaterThan(m.kneeFlexB! + 15);
    }
  });

  it("measures trunk lean beyond the standing posture", () => {
    const frames = walk({ trunkLean: 12, standingLean: 4 });
    expect(standing(frames)).toBeCloseTo(4, 0);
    const m = scored(analyzeGait(frames, { assist: "none", standingTrunkDeg: standing(frames) })).metrics;
    expect(Math.abs(m.trunkLeanDeg! - 8)).toBeLessThan(1);
    expect(m.trunkBaseline).toBe(true);
    // Without a standing baseline, the whole lean counts, and the metrics say so (the dashboard words it as the raw lean).
    for (const standingTrunkDeg of [undefined, NaN]) {
      const raw = scored(analyzeGait(frames, { assist: "none", standingTrunkDeg })).metrics;
      expect(Math.abs(raw.trunkLeanDeg! - 12)).toBeLessThan(1);
      expect(raw.trunkBaseline).toBe(false);
    }
  });

  it("copes with heavier jitter and slower or faster cameras", () => {
    for (const params of [{ noise: 0.006, seed: 3 }, { fps: 15 }, { fps: 60 }] as SyntheticWalkParams[]) {
      const m = metricsOf(params);
      expect(m.cadence).toBeGreaterThan(95);
      expect(m.cadence).toBeLessThan(105);
      expect(m.stepLengthSymmetry).toBeGreaterThan(0.9);
      expect(Math.abs(m.kneeFlexPeak! - 60)).toBeLessThan(5);
    }
  });
});

describe("analyzeGait: scores", () => {
  const even = scored(analyse()).score;

  it("scores a slower, a more uneven and a stiffer walker lower", () => {
    expect(scored(analyse({ cadence: 72, stepLength: 0.5 })).score).toBeLessThan(even - 10);
    expect(scored(analyse({ stepLengthRatio: 0.7, stepTimeRatio: 1.3 })).score).toBeLessThan(even - 10);
    expect(scored(analyse({ kneeFlex: 25 })).score).toBeLessThan(even - 5);
    // Each worse in turn: slower still, more uneven still.
    expect(scored(analyse({ cadence: 60, stepLength: 0.4 })).score).toBeLessThan(scored(analyse({ cadence: 72, stepLength: 0.5 })).score);
    expect(scored(analyse({ stepLengthRatio: 0.6 })).score).toBeLessThan(scored(analyse({ stepLengthRatio: 0.8 })).score);
    expect(scored(analyse({ kneeFlex: 22 })).score).toBeLessThan(scored(analyse({ kneeFlex: 35 })).score);
    expect(scored(analyse({ trunkLean: 18 })).score).toBeLessThan(even);
  });

  it("is the unrounded weighted mean of its components, with the dashboard's weights", () => {
    expect(GAIT_WEIGHTS).toEqual({ speed: 30, cadence: 15, step_length_symmetry: 20, step_time_symmetry: 15, knee_bend: 10, trunk_upright: 10 });
    const result = scored(analyse({ cadence: 84, stepLength: 0.6, stepLengthRatio: 0.85, kneeFlex: [50, 38], trunkLean: 9 }));
    const ids = Object.keys(GAIT_WEIGHTS) as (keyof typeof GAIT_WEIGHTS)[];
    expect(ids.every(id => typeof result.components[id] === "number")).toBe(true);
    const expected = ids.reduce((sum, id) => sum + GAIT_WEIGHTS[id] * result.components[id]!, 0) / 100;
    expect(result.score).toBe(expected);
    expect(Number.isInteger(result.score)).toBe(false);
    expect(result.components).toEqual(gaitComponents(result.metrics));
  });

  it("ramps each component linearly between its ends, clamped", () => {
    const at = (metrics: Partial<GaitMetrics>) => gaitComponents(metrics);
    expect(at({ speedLegPerS: 0.35 }).speed).toBe(0);
    expect(at({ speedLegPerS: 1.4 }).speed).toBe(100);
    expect(at({ speedLegPerS: 0.875 }).speed).toBeCloseTo(50, 10);
    expect(at({ speedLegPerS: 2 }).speed).toBe(100);
    expect(at({ cadence: 77.5 }).cadence).toBeCloseTo(50, 10);
    expect(at({ stepLengthSymmetry: 0.76 }).step_length_symmetry).toBeCloseTo(50, 10);
    expect(at({ stepTimeSymmetry: 0.5 }).step_time_symmetry).toBe(0);
    expect(at({ kneeFlexPeak: 35 }).knee_bend).toBeCloseTo(50, 10);
    expect(at({ trunkLeanDeg: 5 }).trunk_upright).toBe(100);
    expect(at({ trunkLeanDeg: -4 }).trunk_upright).toBe(100);
    expect(at({ trunkLeanDeg: 12.5 }).trunk_upright).toBeCloseTo(50, 10);
    expect(at({ trunkLeanDeg: 20 }).trunk_upright).toBe(0);
    expect(GAIT_RAMPS.speed).toEqual({ zero: 0.35, full: 1.4 });
  });

  it("needs speed, cadence and one symmetry; scores over what was measured", () => {
    expect(gaitScore({ speed: 80, cadence: 60 })).toBeNull();
    expect(gaitScore({ speed: 80, step_time_symmetry: 90 })).toBeNull();
    expect(gaitScore({ speed: 80, cadence: 60, step_time_symmetry: 90 })).toBeCloseTo((30 * 80 + 15 * 60 + 15 * 90) / 60, 10);
  });

  it("caps the walking area at 50 when someone held the patient, keeping the walk's own score", () => {
    const alone = scored(analyse({}, "none")), held = scored(analyse({}, "holds")), nearby = scored(analyse({}, "nearby"));
    expect(alone.areaScore).toBe(alone.score);
    expect(nearby.areaScore).toBe(nearby.score);
    expect(held.score).toBe(alone.score);
    expect(held.areaScore).toBe(HELD_WALKING_CAP);
    expect(held.assist).toBe("holds");
    const slow = scored(analyse({ cadence: 58, stepLength: 0.35, stepLengthRatio: 0.65, kneeFlex: 24 }, "holds"));
    expect(slow.score).toBeLessThan(50);
    expect(slow.areaScore).toBe(slow.score);
  });
});

describe("analyzeGait: the camera's distance and picture shape do not matter", () => {
  it("measures the same walk from further away and closer", () => {
    const far = metricsOf({ scale: 0.7, across: 0.9 }), near = metricsOf({ scale: 1.15, across: 0.9 });
    expect(Math.abs(far.speedLegPerS / near.speedLegPerS - 1)).toBeLessThan(0.05);
    expect(Math.abs(far.cadence - near.cadence)).toBeLessThan(2);
    expect(Math.abs(far.stepLengthSymmetry! - near.stepLengthSymmetry!)).toBeLessThan(0.04);
    expect(Math.abs(far.stepLengthA! - near.stepLengthA!)).toBeLessThan(0.04);
    expect(Math.abs(far.kneeFlexPeak! - near.kneeFlexPeak!)).toBeLessThan(4);
  });

  it("measures the same walk in a 16:9 and a 4:3 picture", () => {
    const wide = metricsOf({ aspect: 16 / 9, stepLengthRatio: 0.8 }), standard = metricsOf({ aspect: 4 / 3, stepLengthRatio: 0.8 });
    expect(Math.abs(wide.speedLegPerS / standard.speedLegPerS - 1)).toBeLessThan(0.05);
    expect(Math.abs(wide.cadence - standard.cadence)).toBeLessThan(2);
    expect(Math.abs(wide.stepLengthSymmetry! - standard.stepLengthSymmetry!)).toBeLessThan(0.04);
    expect(Math.abs(wide.stepLengthB! - standard.stepLengthB!)).toBeLessThan(0.04);
    expect(Math.abs(wide.trunkLeanDeg! - standard.trunkLeanDeg!)).toBeLessThan(1);
  });
});

describe("analyzeGait: missed heel strikes", () => {
  it("flips the parity across a missed strike, leaves that gap out and still counts the step", () => {
    const params: SyntheticWalkParams = { aspect: 16 / 9, stepLengthRatio: 0.75 };
    const reference = metricsOf(params), missed = metricsOf({ ...params, missStrikes: [3] });
    // The sides stay apart after the gap.
    expect(Math.abs(missed.stepLengthSymmetry! - 0.75)).toBeLessThan(0.05);
    expect(missed.stepLengthA!).toBeGreaterThan(missed.stepLengthB!);
    // The missed strike still counts as a step taken (the parity advanced by two)...
    expect(missed.steps).toBe(reference.steps);
    // ...but its double-length gap is not a step time: the timing stays even and the rhythm unchanged.
    expect(missed.stepTimeSymmetry).toBeGreaterThan(0.95);
    expect(Math.abs(missed.cadence - reference.cadence)).toBeLessThan(3);
    expect(missed.seenShare).toBeLessThan(1);
  });
});

describe("analyzeGait: a hesitant step", () => {
  it("keeps a genuine slow step on its own side, so the hesitation is measured", () => {
    // One step takes more than twice as long (a stop on both feet before it), with the other foot leading after it.
    const params: SyntheticWalkParams = { aspect: 16 / 9, stepLengthRatio: 0.75 };
    const reference = metricsOf(params), hesitant = metricsOf({ ...params, pauseAfter: [2], pauseMs: 700 });
    // The parity holds: the sides stay apart and no step is invented.
    expect(Math.abs(hesitant.stepLengthSymmetry! - 0.75)).toBeLessThan(0.05);
    expect(hesitant.stepLengthA!).toBeGreaterThan(hesitant.stepLengthB!);
    expect(hesitant.steps).toBe(reference.steps);
    expect(hesitant.passes).toBe(2);
    // The slow step's time is used: the timing is less even than without it.
    expect(hesitant.stepTimeSymmetry!).toBeLessThan(reference.stepTimeSymmetry! - 0.08);
  });
});

/** Every landmark moved across the picture by `shift(t)` frame heights: the whole body drifting. */
const shifted = (frames: GaitFrame[], shift: (t: number) => number) =>
  frames.map(frame => ({ ...frame, landmarks: frame.landmarks.map(p => ({ ...p, x: p.x + shift(frame.t) / frame.aspect })) }));

describe("analyzeGait: a stop-and-go walker (a walking frame, stepping to)", () => {
  // Standing still on both feet after every step, or after every second step, as a walking-frame user does.
  const framed: SyntheticWalkParams[] = [
    { cadence: 90, stepLength: 0.5, pauseMs: 700, pauseEvery: 1, aspect: 16 / 9 },
    { cadence: 90, stepLength: 0.5, pauseMs: 1000, pauseEvery: 2, aspect: 16 / 9 },
  ];
  /** Clinical gait speed (L/s) and cadence: distance and steps over the whole time, the stops included. */
  const cycleMs = ({ cadence = 100, pauseMs = 0, pauseEvery = 1 }: SyntheticWalkParams) => pauseEvery * 60000 / cadence + pauseMs;
  const clinicalSpeed = (params: SyntheticWalkParams) => (params.pauseEvery ?? 1) * (params.stepLength ?? 0.75) / (cycleMs(params) / 1000);
  const clinicalCadence = (params: SyntheticWalkParams) => (params.pauseEvery ?? 1) * 60000 / cycleMs(params);

  it("measures each crossing as one pass, its stops in the speed and the rhythm", () => {
    for (const params of framed) {
      const m = metricsOf(params);
      expect(m.passes).toBe(2);
      expect(m.speedLegPerS / clinicalSpeed(params)).toBeGreaterThan(0.85);
      expect(m.speedLegPerS / clinicalSpeed(params)).toBeLessThan(1.15);
      expect(m.cadence / clinicalCadence(params)).toBeGreaterThan(0.92);
      expect(m.cadence / clinicalCadence(params)).toBeLessThan(1.08);
      // Even steps (slow, short steps under jitter: a few percent either way).
      expect(Math.abs(m.stepLengthSymmetry! - 1)).toBeLessThan(0.08);
      // Much slower than the same steps walked without stopping.
      const steady = metricsOf({ ...params, pauseMs: 0 });
      expect(m.speedLegPerS).toBeLessThan(steady.speedLegPerS * 0.7);
    }
    // Stopping after every step keeps the timing even; stopping after the same foot each time makes the other foot's
    // steps slow (0.67 s against 1.67 s), and the steps are timed from landing, so that is what is measured.
    expect(metricsOf(framed[0]).stepTimeSymmetry).toBeGreaterThan(0.95);
    expect(Math.abs(metricsOf(framed[1]).stepTimeSymmetry! - 0.4)).toBeLessThan(0.05);
  });

  it("does not take a small drift back during a stop for a turn", () => {
    const params = framed[1];
    // The first stop is from 2.33 s to 3.33 s: the body sways back 0.15 leg lengths and forward again within it.
    const drift = (t: number) => t > 2450 && t < 2850 ? -0.15 * 0.27 * Math.sin(Math.PI * (t - 2450) / 400) : 0;
    const frames = shifted(walk(params), drift);
    // Live, the crossing goes on through the drift: the first pass counts when it would without it.
    const live = (list: GaitFrame[]) => { const counter = new LiveGait(); return list.map(frame => counter.push(frame)); };
    const states = live(frames), firstPass = (list: GaitFrame[]) => live(list).findIndex(state => state.passes === 1);
    expect(states[states.length - 1].passes).toBe(2);
    expect(Math.abs(firstPass(frames) - firstPass(walk(params)))).toBeLessThanOrEqual(2);
    // And the analysis keeps it one pass, with every step.
    const plain = metricsOf(params);
    const m = scored(analyzeGait(frames, { assist: "none", standingTrunkDeg: standing(frames) })).metrics;
    expect(m.passes).toBe(2);
    expect(m.steps).toBe(plain.steps);
    expect(Math.abs(m.speedLegPerS / plain.speedLegPerS - 1)).toBeLessThan(0.05);
  });

  it("counts the stop-and-go walk live, and does not stop the recording during a stop", () => {
    for (const params of framed) {
      const frames = walk({ ...params, endMs: 3000 });
      const live = new LiveGait();
      const states = frames.map(frame => live.push(frame)), end = states[states.length - 1];
      expect(end).toMatchObject({ passes: 2, still: true });
      // Never still from the first step to the last: a stop within a pass is not the end of the walk.
      const first = states.findIndex(state => state.walking), last = states.map(state => state.walking).lastIndexOf(true);
      expect(states.slice(first, last + 1).some(state => state.still)).toBe(false);
      expect(Math.abs(end.steps - metricsOf(params).steps)).toBeLessThanOrEqual(1);
    }
  });
});

describe("analyzeGait: honest when it cannot measure", () => {
  const cases: { name: string; params: SyntheticWalkParams; reason: string }[] = [
    { name: "too few steps", params: { across: 0.45 }, reason: GAIT_REASONS.fewSteps },
    { name: "walking toward the camera", params: { view: "toward" }, reason: GAIT_REASONS.sideOn },
    { name: "feet out of the picture", params: { yShift: 0.25 }, reason: GAIT_REASONS.body },
    { name: "no walk across", params: { passes: 0, startMs: 3000 }, reason: GAIT_REASONS.noPass },
  ];
  for (const { name, params, reason } of cases) {
    it(`says so, without a score: ${name}`, () => {
      const result = analyse(params);
      expect(result.status).toBe("not_measured");
      expect(result).toMatchObject({ reason, assist: "none" });
      expect("score" in result).toBe(false);
      expect("areaScore" in result).toBe(false);
      expect("components" in result).toBe(false);
    });
  }

  it("never scores no frames, an empty pose or nobody in view", () => {
    for (const frames of [[], [{ t: 0, landmarks: [], aspect: 4 / 3 }], walk({ passes: 0 }).map(frame => ({ ...frame, landmarks: [] }))]) {
      const result = analyzeGait(frames, { assist: "holds" });
      expect(result).toMatchObject({ status: "not_measured", reason: GAIT_REASONS.noPass, assist: "holds" });
      expect("score" in result).toBe(false);
    }
  });

  it("asks for the whole body when the feet are lost for much of the walk", () => {
    const frames = walk({}).map(frame => frame.t > 2500 && frame.t < 6000 ? { ...frame, landmarks: frame.landmarks.map((p, i) => i >= 27 ? { ...p, visibility: 0.05 } : p) } : frame);
    expect(analyzeGait(frames, { assist: "none" })).toMatchObject({ status: "not_measured", reason: GAIT_REASONS.body });
  });
});

describe("LiveGait", () => {
  it("counts passes and steps as the walk goes, then sees the walker standing still", () => {
    // Standing still 3 s at the end: "still" waits longer than a stop within a pass (2.5 s).
    const frames = walk({ endMs: 3000 });
    const live = new LiveGait();
    const states = frames.map(frame => live.push(frame));
    const last = states[states.length - 1];
    expect(last).toMatchObject({ passes: 2, still: true, walking: false, direction: 0 });
    expect(Math.abs(last.steps - scored(analyse()).metrics.steps)).toBeLessThanOrEqual(1);
    // Walking right on the way across, left on the way back; never two passes before the walk back.
    const firstPass = states.findIndex(state => state.passes === 1), secondPass = states.findIndex(state => state.passes === 2);
    expect(firstPass).toBeGreaterThan(0);
    expect(secondPass).toBeGreaterThan(firstPass);
    expect(states.slice(0, firstPass + 1).some(state => state.direction === 1)).toBe(true);
    expect(states.slice(firstPass + 1, secondPass + 1).some(state => state.direction === -1)).toBe(true);
    // Not still while walking; still 2.5 s after stopping.
    expect(states[secondPass].still).toBe(false);
    // Steps only grow.
    expect(states.every((state, i) => i === 0 || state.steps >= states[i - 1].steps)).toBe(true);
  });

  it("is not walking for a person standing still or walking toward the camera", () => {
    for (const frames of [walk({ passes: 0, startMs: 3000 }), walk({ view: "toward" })]) {
      const live = new LiveGait();
      const states = frames.map(frame => live.push(frame));
      expect(states.every(state => state.passes === 0)).toBe(true);
    }
  });
});

describe("gaitSetupCheck and trunkAngleDeg", () => {
  const first = (params: SyntheticWalkParams) => { const frame = walk(params)[5]; return gaitSetupCheck(frame.landmarks, frame.aspect); };

  it("passes a side-on walker standing head to feet in the picture", () => {
    expect(first({})).toEqual({ upright: { ok: true, hint: "" }, wholeBody: { ok: true, hint: "" }, sideOn: { ok: true, hint: "" }, room: { ok: true, hint: "" } });
    expect(first({ aspect: 16 / 9, scale: 0.8 }).room.ok).toBe(true);
    // A stoop is still upright.
    expect(first({ standingLean: 30 }).upright.ok).toBe(true);
  });

  it("asks to turn the phone on its side until the picture is landscape and upright", () => {
    const frame = walk({})[5];
    // Rotation lock: the phone is on its side but the picture stays portrait, the room turned a quarter.
    const portrait = frame.landmarks.map(p => ({ ...p, x: 1 - p.y, y: p.x }));
    for (const check of [gaitSetupCheck(portrait, 1 / frame.aspect), gaitSetupCheck(frame.landmarks, 3 / 4), gaitSetupCheck(null, 9 / 16)]) {
      expect(check.upright).toEqual({ ok: false, hint: TURN_PHONE_HINT });
      // Room is measured up the picture: it waits for the phone to turn.
      expect(check.room).toEqual({ ok: false, hint: "First, turn the phone on its side." });
    }
    // A landscape picture with the person lying across it (the picture turned inside a landscape frame).
    const cx = (frame.landmarks[23].x + frame.landmarks[24].x) / 2 * frame.aspect, cy = (frame.landmarks[23].y + frame.landmarks[24].y) / 2;
    const sideways = frame.landmarks.map(p => ({ ...p, x: (cx + (p.y - cy)) / frame.aspect, y: cy - (p.x * frame.aspect - cx) }));
    expect(gaitSetupCheck(sideways, frame.aspect).upright).toEqual({ ok: false, hint: TURN_PHONE_HINT });
    // Upside down is not upright either.
    const flipped = frame.landmarks.map(p => ({ ...p, x: 1 - p.x, y: 1 - p.y }));
    expect(gaitSetupCheck(flipped, frame.aspect).upright.ok).toBe(false);
    // Nobody in a landscape picture: the usual hint, not the phone's.
    expect(gaitSetupCheck(null, 4 / 3).upright).toEqual({ ok: false, hint: "Stand where the camera can see you, about 3 big steps away." });
  });

  it("asks to turn side-on, to bring the feet in, and to step closer or back", () => {
    const facing = first({ view: "toward" });
    expect(facing.sideOn.ok).toBe(false);
    expect(facing.sideOn.hint).toMatch(/side-on/);
    const feet = first({ yShift: 0.25 });
    expect(feet.wholeBody).toEqual({ ok: false, hint: "Your feet are out of the picture. Step back, or tilt the phone down a little." });
    expect(feet.room.ok).toBe(false);
    const head = first({ yShift: -0.25 });
    expect(head.wholeBody.ok).toBe(false);
    expect(head.wholeBody.hint).toMatch(/head/);
    expect(first({ scale: 1.25 }).room).toMatchObject({ ok: false, hint: expect.stringMatching(/step back/) });
    expect(first({ scale: 0.55 }).room).toMatchObject({ ok: false, hint: expect.stringMatching(/closer/) });
    expect(gaitSetupCheck(null, 4 / 3).wholeBody.ok).toBe(false);
  });

  it("measures forward lean as positive whichever way the person faces", () => {
    for (const startDir of [1, -1] as const) {
      const frame = walk({ startDir, standingLean: 7, noise: 0 })[5];
      expect(trunkAngleDeg(frame.landmarks, frame.aspect)).toBeCloseTo(7, 1);
      expect(trunkAngleDeg(frame.landmarks, frame.aspect, startDir)).toBeCloseTo(7, 1);
      expect(trunkAngleDeg(frame.landmarks, frame.aspect, -startDir as 1 | -1)).toBeCloseTo(-7, 1);
    }
    // Facing the camera there is no forward to lean toward.
    const front = walk({ view: "toward" })[5];
    expect(trunkAngleDeg(front.landmarks, front.aspect)).toBeNull();
    expect(trunkAngleDeg([], 4 / 3)).toBeNull();
  });
});

describe("syntheticWalk", () => {
  it("walks across, turns and walks back, head to feet inside the picture", () => {
    const frames = syntheticWalk({ aspect: 4 / 3 });
    expect(frames.length).toBeGreaterThan(200);
    expect(frames.every(frame => frame.landmarks.length === 33 && frame.aspect === 4 / 3)).toBe(true);
    expect(frames.every(frame => frame.landmarks.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1))).toBe(true);
    const pelvis = frames.map(frame => (frame.landmarks[23].x + frame.landmarks[24].x) / 2);
    const turnAt = pelvis.indexOf(Math.max(...pelvis));
    expect(pelvis[turnAt] - pelvis[0]).toBeGreaterThan(0.6);
    expect(pelvis[turnAt] - pelvis[pelvis.length - 1]).toBeGreaterThan(0.6);
    // Deterministic for a seed.
    expect(syntheticWalk({ noise: 0.003, seed: 7 })).toEqual(syntheticWalk({ noise: 0.003, seed: 7 }));
  });
});
