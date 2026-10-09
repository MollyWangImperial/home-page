import { describe, expect, it } from "vitest";
import { EXERCISES, usesSeatedTargets, usesTargetFlow, type Side } from "./config";
import { kneeDial } from "./knee-target";
import { compensationStatus, poseJoints, type PoseInput, type Pt } from "./metrics";
import { reachDemoState } from "./reach-demo";
import { exerciseScreenPreview } from "./screen-preview";
import { ExerciseSession, simFrame, type Snapshot } from "./session";
import {
  toeDemoDuration, toeDemoState, toeDialCircle, toeDialDegrees, toeFrame, toeGhostContact, toeGhostTarget, toeGuide, ToeLiftFilter,
  toeLiftRaw, toePracticeGoal, toeRestCheck, ToeTarget, TOE_DIAL_GOAL_DEG, TOE_EASE_MS, TOE_EASED_LIFT, TOE_HYSTERESIS, TOE_PRACTICE_LIFT,
} from "./toe-target";

const ASPECT = 4 / 3;
const SIDES: Side[] = ["left", "right"];
const ID = "ex_ankle_dorsiflexion";

// ---------- a seated patient's landmarks, seen by a front camera ----------

type P3 = [number, number, number];
/**
 * The seated posture: the toes turned up about the heel (degrees), the other foot's likewise, the heel raised off
 * the floor (metres), the lower leg swung forward about the knee (a kick, degrees), the whole foot slid forward
 * (metres), the thigh lifted (degrees) or the whole leg raised level (metres), the knee moved out from the body
 * (metres), the other knee's angle, the other foot moved, and trunk leans.
 */
type Posture = {
  dorsi?: number; otherDorsi?: number; heelUp?: number; kick?: number; slide?: number; thighLift?: number; legUp?: number; kneeOut?: number;
  otherKnee?: number; otherFoot?: P3; lean?: number; camera?: { y: number; z: number };
};

// Body points in metres: x to the patient's left, y up, z toward the camera, from the middle of the hips.
const UPPER: Record<number, P3> = {
  0: [0, 0.62, 0.1], 1: [0.015, 0.655, 0.085], 2: [0.03, 0.655, 0.08], 3: [0.045, 0.655, 0.075], 4: [-0.015, 0.655, 0.085], 5: [-0.03, 0.655, 0.08], 6: [-0.045, 0.655, 0.075],
  7: [0.075, 0.64, 0], 8: [-0.075, 0.64, 0], 9: [0.025, 0.585, 0.09], 10: [-0.025, 0.585, 0.09],
  11: [0.18, 0.5, 0], 12: [-0.18, 0.5, 0], 13: [0.21, 0.26, 0.05], 14: [-0.21, 0.26, 0.05],
  // Hands resting on the thighs.
  15: [0.16, 0.06, 0.3], 16: [-0.16, 0.06, 0.3], 17: [0.17, 0.04, 0.36], 18: [-0.17, 0.04, 0.36], 19: [0.15, 0.04, 0.37], 20: [-0.15, 0.04, 0.37], 21: [0.13, 0.06, 0.33], 22: [-0.13, 0.06, 0.33],
};
/** Turn (y, z) about the x axis by `deg`, about a pivot: positive turns a point in front of the pivot up (the toes lifting about the heel, the thigh lifting about the hip). */
const pitch = ([x, y, z]: P3, [, py, pz]: P3, deg: number): P3 => {
  const a = deg * Math.PI / 180, dy = y - py, dz = z - pz;
  return [x, py + dy * Math.cos(a) + dz * Math.sin(a), pz - dy * Math.sin(a) + dz * Math.cos(a)];
};
const plus = (p: P3, d: P3): P3 => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
type Leg = Record<"hip" | "knee" | "ankle" | "heel" | "toe", P3>;
/** One leg from its hip: the thigh level forward to the knee, the lower leg straight down, the foot flat with the toes turned up `dorsi` about the heel. */
function leg(hipX: number, out: number, posture: { dorsi?: number; heelUp?: number; kick?: number; slide?: number; thighLift?: number; legUp?: number; kneeOut?: number; knee?: number } = {}): Leg {
  const hip: P3 = [hipX, 0, 0];
  const knee: P3 = [hipX + out * (posture.kneeOut ?? 0), 0, 0.45];
  const foot = (p: P3): P3 => [p[0], p[1], p[2] + (posture.slide ?? 0)];
  const heel = foot([hipX, -0.47 + (posture.heelUp ?? 0), 0.4]);
  const points: Leg = { hip, knee, ankle: foot([hipX, -0.42 + (posture.heelUp ?? 0), 0.45]), heel, toe: pitch(foot([hipX, -0.47, 0.6]), heel, posture.dorsi ?? 0) };
  // The knee straightening (the other knee's angle, or a kick) swings the lower leg forward about the knee, the foot with it.
  const swing = (posture.knee !== undefined ? posture.knee - 90 : 0) + (posture.kick ?? 0);
  if (swing) for (const key of ["ankle", "heel", "toe"] as const) points[key] = pitch(points[key], knee, swing);
  if (posture.thighLift) for (const key of ["knee", "ankle", "heel", "toe"] as const) points[key] = pitch(points[key], hip, posture.thighLift);
  if (posture.legUp) for (const key of ["knee", "ankle", "heel", "toe"] as const) points[key] = plus(points[key], [0, posture.legUp, 0]);
  return points;
}

/** MediaPipe-style landmarks (image and world) of the seated patient, the camera at hip height 2.2 m away by default. */
function toeBody(side: Side, posture: Posture = {}): PoseInput {
  const camera = posture.camera ?? { y: 0, z: 2.2 };
  const affectedX = side === "left" ? 0.1 : -0.1;
  const mine = leg(affectedX, Math.sign(affectedX), posture);
  const theirs = leg(-affectedX, -Math.sign(affectedX), { dorsi: posture.otherDorsi, knee: posture.otherKnee });
  if (posture.otherFoot) for (const key of ["ankle", "heel", "toe"] as const) theirs[key] = plus(theirs[key], posture.otherFoot);
  const j = poseJoints(side);
  const points: Record<number, P3> = { ...UPPER };
  const set = (index: number, otherIndex: number, key: keyof Leg) => { points[index] = mine[key]; points[otherIndex] = theirs[key]; };
  set(j.hip, j.hipOther, "hip"); set(j.knee, j.kneeOther, "knee"); set(j.ankle, j.ankleOther, "ankle"); set(j.foot, j.footOther, "toe");
  set(side === "left" ? 29 : 30, side === "left" ? 30 : 29, "heel");
  const landmarks: Pt[] = [], world: Pt[] = [];
  for (let index = 0; index < 33; index++) {
    // The trunk leans about the hips: forward (positive) toward the camera.
    const p = index <= 22 ? pitch(points[index], [0, 0, 0], -(posture.lean ?? 0)) : points[index];
    const depth = camera.z - p[2];
    landmarks.push({ x: 0.5 + 0.75 * p[0] / depth, y: 0.5 - (p[1] - camera.y) / depth, z: -p[2], visibility: 1 });
    world.push({ x: p[0], y: -p[1], z: -p[2], visibility: 1 });
  }
  return { landmarks, world };
}

const lift = (side: Side, posture: Posture = {}) => toeLiftRaw(toeBody(side, posture), side, ASPECT)!;

describe("Seated Toe Lift on the shared target flow", () => {
  it("runs on the target flow with the approved checks, seated head to feet", () => {
    expect(usesTargetFlow(ID)).toBe(true);
    expect(usesSeatedTargets(ID)).toBe(false);
    expect(EXERCISES[ID].compensations.map(item => item.id)).toEqual(["heel_lift", "knee_motion", "knee_sideways", "other_leg", "trunk_forward", "trunk_lean"]);
    for (const item of EXERCISES[ID].compensations) expect(item.steps, item.id).toEqual([0]);
    expect(EXERCISES[ID].cycle.map(step => step.kind)).toEqual(["reach", "return"]);
    expect(EXERCISES[ID].framing).toMatch(/seated, head to feet/);
  });
  it.each(SIDES)("measures the toes rising above the ankle as they turn up about the heel (%s side)", side => {
    const rest = lift(side);
    expect(rest).toBeLessThan(-15);
    // Steadily higher with the turn, roughly one percent of the lower leg a degree.
    const lifts = [5, 10, 20, 30].map(dorsi => lift(side, { dorsi }) - rest);
    lifts.reduce((low, high) => { expect(high).toBeGreaterThan(low); return high; }, 0);
    expect(lifts[2]).toBeGreaterThan(14);
    expect(lifts[2]).toBeLessThan(24);
  });
  it.each(SIDES)("does not count moving the whole foot or leg as lifting the toes (%s side)", side => {
    const rest = lift(side);
    for (const posture of [{ slide: 0.05 }, { slide: -0.05 }, { legUp: 0.05 }, { kneeOut: 0.05 }] as Posture[]) {
      expect(Math.abs(lift(side, posture) - rest), JSON.stringify(posture)).toBeLessThan(EXERCISES[ID].romSteps[0].learnedFloor!);
    }
    expect(toeLiftRaw({ ...toeBody(side), landmarks: toeBody(side).landmarks.map((p, index) => (index === poseJoints(side).foot ? { ...p, visibility: 0.1 } : p)) }, side, ASPECT)).toBeUndefined();
  });
  it("steadies the measure over the last few frames, dropping a single jump", () => {
    const filter = new ToeLiftFilter();
    for (const [t, value] of [[0, -20], [50, -20], [100, -5], [150, -20], [200, -20]] as const) filter.push(t, value);
    expect(filter.push(250, -20)).toBe(-20);
    // An old sample drops out after 250 ms; a lost frame reads nothing.
    expect(filter.push(260, undefined)).toBeUndefined();
    expect(filter.push(1000, -10)).toBe(-10);
  });
  it.each(SIDES)("learns the resting foot once the seated body and the toes are in view, the foot flat (%s side)", side => {
    const pose = toeBody(side), j = poseJoints(side);
    const rest = toeRestCheck(pose, side, ASPECT);
    expect(rest.lapRest).toBeDefined();
    expect(rest.lapRest!.x).toBeCloseTo(pose.landmarks[j.ankle].x);
    // The toes already up.
    expect(toeRestCheck(toeBody(side, { dorsi: 20 }), side, ASPECT).lapMissing).toBe("Rest your foot flat on the floor, toes down.");
    // The toes hidden, or at the bottom edge of the picture (the camera a little high).
    const hidden = { ...pose, landmarks: pose.landmarks.map((p, index) => (index === j.foot ? { ...p, visibility: 0.1 } : p)) };
    expect(toeRestCheck(hidden, side, ASPECT).lapMissing).toBe("Tilt the camera down a little so I can see your toes.");
    expect(toeRestCheck(toeBody(side, { camera: { y: 0.3, z: 2.2 } }), side, ASPECT).lapMissing).toBe("Tilt the camera down a little so there is space below your feet.");
    // Too far away for the toes' small rise to show.
    expect(toeRestCheck(toeBody(side, { camera: { y: 0, z: 5 } }), side, ASPECT).lapMissing).toBe("Move the camera a little closer, keeping your feet in view.");
    // The knee's own set-up checks still apply.
    expect(toeRestCheck(toeBody(side, { camera: { y: 0, z: 1.1 } }), side, ASPECT).lapMissing).toBeDefined();
    expect(toeRestCheck(null, side, ASPECT).lapMissing).toBeDefined();
  });
  it.each(SIDES)("points the arrow up beside the resting toes, on the dial's side, inside the picture (%s side)", side => {
    const pose = toeBody(side), j = poseJoints(side);
    const geo = toeFrame({ pose }, side, 0, ASPECT, null).geo!;
    const dial = kneeDial(pose, side, ASPECT)!;
    const guide = toeGuide(geo, dial, ASPECT)!;
    const toe = pose.landmarks[j.foot];
    expect((guide.start.x - toe.x) * dial.out).toBeGreaterThan(0);
    expect(guide.end.x).toBeCloseTo(guide.start.x);
    expect(guide.end.y).toBeLessThan(guide.start.y);
    expect(guide.start.y).toBeLessThanOrEqual(toe.y);
    for (const p of [guide.start, guide.control, guide.end]) { expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(1); }
    expect(toeGuide(null, dial, ASPECT)).toBeNull();
    expect(toeGuide(geo, null, ASPECT)).toBeNull();
  });
  it.each(SIDES)("draws the dial's circle beside the shoulder, the goal above the resting toes and turned toward the body (%s side)", side => {
    const dial = kneeDial(toeBody(side), side, ASPECT)!;
    const goal = toeDialCircle(dial, false, 640, 480), down = toeDialCircle(dial, true, 640, 480);
    expect(goal.y).toBeLessThan(down.y);
    expect(goal.radius).toBeGreaterThan(0);
    for (const p of [goal, down]) { expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(640); expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(480); }
    expect(toeDialDegrees(0)).toBe(0);
    expect(toeDialDegrees(1)).toBe(TOE_DIAL_GOAL_DEG);
    expect(toeDialDegrees(Number.NaN)).toBe(0);
  });
  it("sets a modest practice goal from the resting toes", () => {
    expect(toePracticeGoal(-22)).toBe(-22 + TOE_PRACTICE_LIFT);
  });
});

describe("the toe lift's checks from camera landmarks", () => {
  const reference = (side: Side) => toeFrame({ pose: toeBody(side) }, side, 0, ASPECT, null).geo!;
  const comps = (side: Side, posture: Posture) => toeFrame({ pose: toeBody(side, posture) }, side, 0, ASPECT, reference(side)).comps;
  const over = (side: Side, posture: Posture) => EXERCISES[ID].compensations.filter(item => compensationStatus(comps(side, posture), item).over).map(item => item.id);
  it.each(SIDES)("a clean lift trips no check, all the way up (%s side)", side => {
    for (const dorsi of [0, 10, 20, 30]) expect(over(side, { dorsi })).toEqual([]);
    // Every check is measurable with the body in view.
    const measured = comps(side, { dorsi: 15 });
    for (const item of EXERCISES[ID].compensations) expect(measured[item.metric], item.id).toBeDefined();
  });
  it.each(SIDES)("a knee kick lifts the toes in the picture, and is caught as the heel lifting (%s side)", side => {
    // A 10 degree kick reads as a typical scored lift, with the knee itself still.
    expect(lift(side, { kick: 10 }) - lift(side)).toBeGreaterThan(4);
    expect(comps(side, { kick: 10 }).thigh_lift_pct).toBeCloseTo(0);
    expect(over(side, { kick: 10 })).toEqual(["heel_lift"]);
  });
  it.each([
    ["heel_lift", { heelUp: 0.04 }],
    ["heel_lift", { kick: 12 }],
    ["knee_motion", { thighLift: 15 }],
    // Lifting the whole foot off the floor, level: the knee rises with it.
    ["knee_motion", { legUp: 0.05 }],
    ["knee_sideways", { kneeOut: 0.06 }],
    ["knee_sideways", { kneeOut: -0.06 }],
    ["other_leg", { otherKnee: 120 }],
    ["other_leg", { otherFoot: [0.08, 0.1, 0.05] as P3 }],
    // A mirror movement: the other foot's toes lift too.
    ["other_leg", { otherDorsi: 15 }],
    ["trunk_forward", { lean: 14 }],
    ["trunk_lean", { lean: -14 }],
  ] as const)("flags %s (%j) and nothing else, on both sides", (id, posture) => {
    for (const side of SIDES) expect(over(side, { dorsi: 15, ...posture }), side).toEqual([id]);
  });
  it.each([
    ["heel_lift", { heelUp: 0.01 }],
    ["heel_lift", { kick: 4 }],
    ["knee_motion", { thighLift: 2 }],
    ["knee_sideways", { kneeOut: 0.02 }],
    ["other_leg", { otherKnee: 100 }],
    ["other_leg", { otherDorsi: 3 }],
    ["trunk_forward", { lean: 4 }],
    ["trunk_lean", { lean: -4 }],
  ] as const)("lets a small %s pass (%j)", (_id, posture) => {
    for (const side of SIDES) expect(over(side, { dorsi: 15, ...posture }), side).toEqual([]);
  });
  it("leaves a check unmeasured when its body part is out of view, and the lift when the leg is", () => {
    const pose = toeBody("right", { dorsi: 15 });
    const hidden = { ...pose, landmarks: pose.landmarks.map((p, index) => (index <= 12 ? { ...p, visibility: 0.1 } : p)) };
    const frame = toeFrame({ pose: hidden }, "right", 0, ASPECT, reference("right"));
    expect(frame.comps.trunk_retreat_pct).toBeUndefined();
    expect(frame.comps.trunk_approach_pct).toBeUndefined();
    expect(frame.visible).toBe(true);
    const noToes = { ...pose, landmarks: pose.landmarks.map((p, index) => (index === poseJoints("right").foot ? { ...p, visibility: 0.1 } : p)) };
    const lost = toeFrame({ pose: noToes }, "right", 0, ASPECT, reference("right"));
    expect(lost.visible).toBe(false);
    expect(lost.values.toe_lift).toBeUndefined();
    expect(lost.missing).toBe("Keep your knees and feet in view of the camera.");
  });
});

describe("the toes' targets", () => {
  const base = { rest: -22, goal: -10, lowering: false, armed: true, practice: false, t: 0 };
  it("is on the lift target at the goal, and stays on it until the toes sag a little", () => {
    const target = new ToeTarget();
    expect(target.update("a", { ...base, value: -10.5 }).contact).toBe(false);
    expect(target.update("a", { ...base, value: -10 }).contact).toBe(true);
    expect(target.update("a", { ...base, value: -10 - TOE_HYSTERESIS + 0.1 }).contact).toBe(true);
    expect(target.update("a", { ...base, value: -10 - TOE_HYSTERESIS - 0.1 }).contact).toBe(false);
    expect(target.update("a", { ...base, value: -11 }).contact).toBe(false);
    expect(target.update("a", { ...base, value: -16 }).progress).toBeCloseTo(0.5);
    expect(target.update("a", { ...base, value: undefined }).contact).toBe(false);
  });
  it("is on the lower target with the toes most of the way down, and a little higher after a while lowering", () => {
    const target = new ToeTarget(), lowering = { ...base, lowering: true };
    // The goal is 12 above rest: down within 30% of that (3.6).
    expect(target.update("b", { ...lowering, value: -18 }).contact).toBe(false);
    expect(target.update("b", { ...lowering, value: -18.5 }).contact).toBe(true);
    expect(target.update("b", { ...lowering, value: -17.2 }).contact).toBe(true);
    const late = new ToeTarget();
    expect(late.update("c", { ...lowering, value: -17, t: 0 }).contact).toBe(false);
    expect(late.update("c", { ...lowering, value: -17, t: 10500 }).contact).toBe(true);
    // A small goal (the learned floor): after a while, toes settled within the rest calibration's 5% still count.
    const small = new ToeTarget(), floor = { ...lowering, goal: -22 + 3.5 };
    expect(small.update("d", { ...floor, value: -17.5, t: 0 }).contact).toBe(false);
    expect(small.update("d", { ...floor, value: -17.5, t: 10500 }).contact).toBe(true);
    expect(small.update("e", { ...floor, value: -16, t: 20000 }).contact).toBe(false);
  });
  it("brings a practice goal closer when it is not reached for a while, but never a scored one", () => {
    const target = new ToeTarget(), practice = { ...base, practice: true, goal: toePracticeGoal(-22) };
    expect(target.update("p", { ...practice, value: -17.5, t: 0 }).contact).toBe(false);
    expect(target.update("p", { ...practice, value: -17.5, t: TOE_EASE_MS - 10 }).contact).toBe(false);
    expect(target.update("p", { ...practice, value: -17.5, t: TOE_EASE_MS + 10 })).toMatchObject({ contact: true, eased: true, goal: -22 + TOE_EASED_LIFT });
    const scored = new ToeTarget();
    expect(scored.update("s", { ...base, value: -17.5, t: 0 }).contact).toBe(false);
    expect(scored.update("s", { ...base, value: -17.5, t: TOE_EASE_MS * 2 }).contact).toBe(false);
  });
});

describe("Seated Toe Lift demonstration, simulator and previews", () => {
  it.each([false, true])("has the reach demonstration's states and fields (returning=%s)", returning => {
    expect(Object.keys(toeDemoState(0, returning, false)).sort()).toEqual(Object.keys(reachDemoState(0, returning, false)).sort());
    expect(toeDemoState(0, returning, false).instruction).toBe(reachDemoState(0, returning, false).instruction);
    expect(toeDemoState(0, returning).phase).toBe("move");
    expect(toeDemoState(toeDemoDuration(returning) - 1, returning).phase).toBe("complete");
    expect(toeGhostTarget(300, 270, returning).radius).toBeGreaterThan(0);
    expect(toeGhostContact(returning ? 0 : 1, returning)).toBe(true);
    expect(toeGhostContact(0.5, returning)).toBe(false);
  });
  it("shows the circle on the demonstration's ankle dial beside the shoulder, mirrored for the other side, not at the foot", () => {
    const right = toeGhostTarget(300, 270, false, "right"), left = toeGhostTarget(300, 270, false, "left");
    expect(left.x).toBeCloseTo(300 - right.x);
    expect(right.x).toBeGreaterThan(200);
    expect(right.y).toBeLessThan(150);
    // The goal circle is above the resting one.
    expect(toeGhostTarget(300, 270, true, "right").y).toBeGreaterThan(right.y);
    // The circle is reached as the demonstration's dial toes get there, before the hold.
    expect(toeDemoState(toeDemoDuration(false) - 1, false).target[0]).toBeCloseTo(right.x);
    expect(toeDemoState(0, false).instruction).toMatch(/heel down/);
  });
  it("previews its two steps, the set-up checks with the toes and the lighting, and the results", () => {
    expect(exerciseScreenPreview("warm-reach", 1, "right", ID).snapshot).toMatchObject({ kind: "reach", stepIndex: 0, stepCount: 2 });
    expect(exerciseScreenPreview("reps-return", 1, "right", ID).snapshot).toMatchObject({ kind: "return", stepIndex: 1 });
    expect(exerciseScreenPreview("setup", 1, "left", ID).bodyChecks.map(check => check.label)).toEqual(["Face", "Both shoulders", "Both hips", "Both knees", "Both feet", "Left toes", "Foot flat, heel down, space around you", "Lighting"]);
    const results = exerciseScreenPreview("results", 1, "right", ID).snapshot.record!;
    const ids = EXERCISES[ID].compensations.map(item => item.id);
    for (const id of Object.keys(results.compensation_counts)) expect(ids).toContain(id);
    expect(results.best_label).toBe("toe lift");
  });
  it("the no-camera simulator completes every step", () => {
    const session = new ExerciseSession({ exerciseId: ID, rung: 1, side: "right", repsOverride: 1, reviewBetweenReps: true }, { say() {}, busy: () => false, stop() {} });
    session.start(0);
    for (let t = 50; t < 200000 && session.snapshot().phase !== "done"; t += 50) {
      const snap = session.snapshot(), live = snap.phase === "warm" || snap.phase === "reps";
      const level = live && snap.targetArmed && snap.kind === "reach" ? 1 : 0;
      session.push({ ...simFrame(t, session.cfg, session.targets(), { level, compensations: [] }), ...(live ? { targetContact: toeGhostContact(level, snap.kind === "return") } : {}) });
    }
    expect(session.snapshot().record?.repetition_scores).toEqual([100]);
  });
});

// ---------- a whole session from simulated camera landmarks, as the page drives it ----------

/**
 * A patient who lifts the toes (at `speed` degrees a second) once the circle is active, then lowers them once the
 * lower circle is. options.always: a posture kept through the whole of the scored repetitions; repLift: how far the
 * scored lifts go (degrees).
 */
function toePatient(side: Side, scored: (dorsi: number) => Posture = () => ({}), options: { reps?: number; lift?: number; repLift?: number; fastReps?: boolean; always?: Posture } = {}) {
  const said: string[] = [];
  const session = new ExerciseSession({ exerciseId: ID, rung: 1, side, repsOverride: options.reps ?? 2, reviewBetweenReps: true }, { say: text => said.push(text), busy: () => false, stop() {} });
  const target = new ToeTarget(), filter = new ToeLiftFilter();
  let t = 0, dorsi = 0;
  session.start(t);
  for (let n = 0; n < 20000 && session.snapshot().phase !== "done"; n++) {
    t += 50;
    const snap: Snapshot = session.snapshot();
    const live = (snap.phase === "warm" || snap.phase === "reps") && !snap.review;
    const high = snap.phase === "reps" ? options.repLift ?? options.lift ?? 20 : options.lift ?? 20;
    const want = live && snap.targetArmed ? (snap.kind === "return" ? 0 : high) : dorsi;
    const speed = options.fastReps && snap.phase === "reps" ? 150 : 20;
    dorsi += Math.sign(want - dorsi) * Math.min(Math.abs(want - dorsi), speed * 0.05);
    const extra = { ...(snap.phase === "reps" ? options.always : {}), ...(live && snap.phase === "reps" && snap.kind === "reach" ? scored(dorsi) : {}) };
    const frame = toeFrame({ pose: toeBody(side, { dorsi, ...extra }) }, side, t, ASPECT, session.reference, filter);
    if (live) {
      const rest = session.restValues().toe_lift;
      const goal = snap.phase === "reps" ? session.targets().toe_lift : toePracticeGoal(rest);
      const result = target.update(`${snap.phase}:${snap.repIndex}:${snap.stepIndex}`, {
        value: frame.values.toe_lift, rest, goal, lowering: snap.kind === "return", armed: snap.targetArmed, practice: snap.phase === "warm", t,
      });
      frame.targetContact = frame.visible && result.contact;
      frame.targetProgress = frame.targetContact ? 1 : Math.max(0, Math.min(0.98, result.progress));
    }
    session.push(frame);
  }
  return { session, said };
}

describe("Seated Toe Lift session from camera landmarks", () => {
  it.each(SIDES)("a clean repetition scores 100 with every check measured (%s side)", side => {
    const { session, said } = toePatient(side);
    const snap = session.snapshot();
    expect(snap.phase).toBe("done");
    expect(snap.record?.repetition_scores).toEqual([100, 100]);
    expect(snap.reps.every(rep => !rep.compensations.length && !rep.unmeasured?.length)).toBe(true);
    // The rest learned at set-up, and the scored goal just inside the practice hold (rest + 0.9 x the lift).
    const rest = lift(side), held = lift(side, { dorsi: 20 });
    expect(session.restValues().toe_lift).toBeCloseTo(rest, 0);
    expect(Math.abs(session.learnedValue("toe_lift")! - (rest + 0.9 * (held - rest)))).toBeLessThan(1);
    // The best is read out as the lift from rest, in about-degrees: near the 20 degrees lifted.
    expect(snap.record?.best_value).toBeGreaterThan(17);
    expect(snap.record?.best_value).toBeLessThan(24);
    // The full instructions once in practice (with the dial moving with the foot), the short cues in each scored repetition, and no "slowly" reminder.
    const [up, down] = EXERCISES[ID].cycle;
    expect(said.filter(line => line === up.voice)).toHaveLength(1);
    expect(said.some(line => /moves with your foot/.test(line))).toBe(true);
    for (const step of [up, down]) expect(said.filter(line => line === step.cue)).toHaveLength(2);
    expect(said).not.toContain(EXERCISES[ID].speedCue!.lift);
  });
  it.each([
    // The heel up lowers the toes against the ankle, so this patient lifts them further to reach the circle.
    ["heel_lift", { heelUp: 0.04 }, 30],
    // A kick: the knee straightens as the toes lift.
    ["heel_lift", (dorsi: number) => ({ kick: 0.6 * dorsi }), 20],
    ["knee_motion", { legUp: 0.05 }, 20],
    ["knee_sideways", { kneeOut: 0.06 }, 20],
    // Mirror movement: the other foot's toes lift along with the affected ones.
    ["other_leg", (dorsi: number) => ({ otherDorsi: 0.8 * dorsi }), 20],
    ["trunk_forward", { lean: 14 }, 20],
    ["trunk_lean", { lean: -14 }, 20],
  ] as const)("flags %s in each scored repetition, which still reaches its circle", (id, posture, repLift) => {
    for (const side of SIDES) {
      const reps = toePatient(side, dorsi => (typeof posture === "function" ? posture(dorsi) : posture), { repLift }).session.snapshot().reps;
      expect(reps).toHaveLength(2);
      for (const rep of reps) { expect(rep.compensations, side).toEqual([id]); expect(rep.hold, side).not.toBe("none"); }
    }
  });
  it("flags a heel that comes up before the toes reach their circle", () => {
    const reps = toePatient("right", () => ({ heelUp: 0.04 }), { reps: 1 }).session.snapshot().reps;
    expect(reps[0].compensations).toEqual(["heel_lift"]);
  });
  it("does not count the other foot moved between repetitions as the other leg helping", () => {
    const { session } = toePatient("right", () => ({}), { always: { otherFoot: [0.1, 0, 0.08] } });
    expect(session.snapshot().reps.map(rep => rep.compensations)).toEqual([[], []]);
    expect(session.snapshot().record?.repetition_scores).toEqual([100, 100]);
  });
  it("does not count the foot set down further forward between repetitions as a kick", () => {
    // 10 cm forward opens the knee about 13 degrees, kept still through each lift (which goes a little higher to reach).
    const { session } = toePatient("right", () => ({}), { always: { slide: 0.1 }, repLift: 25 });
    expect(session.snapshot().reps.map(rep => rep.compensations)).toEqual([[], []]);
    expect(session.snapshot().record?.repetition_scores).toEqual([100, 100]);
  });
  it("leaves the checks unjudged, not unmeasured, when the toes hardly lift", () => {
    // Practice learns a 20 degree lift; in the scored repetition the toes only turn up 3 degrees and never hold the circle.
    const { session } = toePatient("right", () => ({}), { reps: 1, repLift: 3 });
    expect(session.snapshot().reps[0]).toMatchObject({ hold: "none", score: 0, unmeasured: [] });
  });
  it("reminds a patient who flicks the toes up or drops them to go slowly, without changing the score", () => {
    const { session, said } = toePatient("right", () => ({}), { fastReps: true });
    const cue = EXERCISES[ID].speedCue!;
    expect(said.filter(line => line === cue.lift)).toHaveLength(2);
    expect(said.filter(line => line === cue.lower)).toHaveLength(2);
    expect(session.snapshot().record?.repetition_scores).toEqual([100, 100]);
  });
});
