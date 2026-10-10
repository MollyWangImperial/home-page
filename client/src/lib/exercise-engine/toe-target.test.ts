import { describe, expect, it } from "vitest";
import { EXERCISES, usesSeatedTargets, usesTargetFlow, type Side } from "./config";
import { kneeDial } from "./knee-target";
import { compensationStatus, poseJoints, type PoseInput, type Pt } from "./metrics";
import { reachDemoState } from "./reach-demo";
import { exerciseScreenPreview } from "./screen-preview";
import { ExerciseSession, simFrame, type Snapshot } from "./session";
import {
  followToeFootGuide, heelIndex, toeDemoDuration, toeFootGuide, toeDemoState, toeDialCircle, toeDialDegrees, toeFrame, toeGhostContact, toeGhostTarget, toeGuide, ToeLiftFilter,
  toeInSetupView, toeLiftRaw, toePracticeGoal, toeRebase, toeRestCheck, toeRestShiftOk, ToeTarget, toeTrueLift, TOE_DIAL_GOAL_DEG, TOE_EASE_MS, TOE_EASED_LIFT, TOE_HYSTERESIS, TOE_PRACTICE_LIFT,
} from "./toe-target";

const ASPECT = 4 / 3;
const SIDES: Side[] = ["left", "right"];
const ID = "ex_ankle_dorsiflexion";

// ---------- a seated patient's landmarks, seen by a front camera ----------

type P3 = [number, number, number];
/**
 * The seated posture: how far the exercising foot is turned out about its heel (degrees, 60 by default; 0 points at
 * the camera), its toes turned up about the heel (degrees), the other foot's toes likewise, the heel raised (metres),
 * the lower leg swung forward about the knee (a kick, degrees), the whole foot slid forward (metres), the thigh lifted
 * (degrees) or the whole leg raised level (metres), the knee moved out from the body (metres), the other knee's angle,
 * the other foot moved, and trunk leans.
 */
type Posture = {
  turn?: number; dorsi?: number; otherDorsi?: number; heelUp?: number; kick?: number; slide?: number; thighLift?: number; legUp?: number; kneeOut?: number;
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
/** Turn (y, z) about the x axis by `deg`, about a pivot: positive turns a point in front of the pivot up (the thigh lifting about the hip), and one below it toward the camera (the lower leg swinging forward). */
const pitch = ([x, y, z]: P3, [, py, pz]: P3, deg: number): P3 => {
  const a = deg * Math.PI / 180, dy = y - py, dz = z - pz;
  return [x, py + dy * Math.cos(a) + dz * Math.sin(a), pz - dy * Math.sin(a) + dz * Math.cos(a)];
};
const plus = (p: P3, d: P3): P3 => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
type Leg = Record<"hip" | "knee" | "ankle" | "heel" | "toe", P3>;
/**
 * One leg from its hip: the thigh level forward to the knee, the lower leg straight down, the heel on the floor and the
 * foot (20 cm, heel to toes) turned `turn` degrees out (toward `out` in x) with its toes `dorsi` degrees up.
 */
function leg(hipX: number, out: number, posture: { turn?: number; dorsi?: number; heelUp?: number; kick?: number; slide?: number; thighLift?: number; legUp?: number; kneeOut?: number; knee?: number } = {}): Leg {
  const hip: P3 = [hipX, 0, 0];
  const knee: P3 = [hipX + out * (posture.kneeOut ?? 0), 0, 0.45];
  const lift = posture.heelUp ?? 0, slide = posture.slide ?? 0;
  const heel: P3 = [hipX, -0.47 + lift, 0.4 + slide];
  const turn = (posture.turn ?? 0) * Math.PI / 180, up = (posture.dorsi ?? 0) * Math.PI / 180;
  // With the heel raised the toes stay on the floor, so the foot tips down toward them.
  const length = 0.2, rise = Math.sin(up) * length - lift;
  const toe: P3 = [hipX + out * Math.sin(turn) * Math.cos(up) * length, -0.47 + lift + rise, 0.4 + slide + Math.cos(turn) * Math.cos(up) * length];
  const points: Leg = { hip, knee, ankle: [hipX, -0.42 + lift, 0.45 + slide], heel, toe };
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
  const mine = leg(affectedX, Math.sign(affectedX), { ...posture, turn: posture.turn ?? 60 });
  const theirs = leg(-affectedX, -Math.sign(affectedX), { dorsi: posture.otherDorsi, knee: posture.otherKnee });
  if (posture.otherFoot) for (const key of ["ankle", "heel", "toe"] as const) theirs[key] = plus(theirs[key], posture.otherFoot);
  const j = poseJoints(side);
  const points: Record<number, P3> = { ...UPPER };
  const set = (index: number, otherIndex: number, key: keyof Leg) => { points[index] = mine[key]; points[otherIndex] = theirs[key]; };
  set(j.hip, j.hipOther, "hip"); set(j.knee, j.kneeOther, "knee"); set(j.ankle, j.ankleOther, "ankle"); set(j.foot, j.footOther, "toe");
  set(heelIndex(side), side === "left" ? 30 : 29, "heel");
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
  it("runs on the target flow with the approved checks, seated head to feet with the foot turned out", () => {
    expect(usesTargetFlow(ID)).toBe(true);
    expect(usesSeatedTargets(ID)).toBe(false);
    expect(EXERCISES[ID].compensations.map(item => item.id)).toEqual(["heel_lift", "knee_motion", "knee_sideways", "other_leg", "trunk_forward", "trunk_lean"]);
    for (const item of EXERCISES[ID].compensations) expect(item.steps, item.id).toEqual([0]);
    // Not the other knee's 3D angle, which wanders with the leg still.
    expect(EXERCISES[ID].compensations.find(item => item.id === "other_leg")!.alternative).toBeUndefined();
    expect(EXERCISES[ID].cycle.map(step => step.kind)).toEqual(["reach", "return"]);
    expect(EXERCISES[ID].framing).toMatch(/seated, head to feet/);
    expect(EXERCISES[ID].framing).toMatch(/turned out/);
    expect(EXERCISES[ID].calibrationInstruction).toMatch(/out to the side/);
  });
  it.each(SIDES)("measures the turned-out foot's angle, rising as the toes turn up about the heel (%s side)", side => {
    const rest = lift(side);
    expect(Math.abs(rest)).toBeLessThan(15);
    // Steadily higher with the turn, roughly a degree a degree.
    const lifts = [5, 10, 20, 30].map(dorsi => lift(side, { dorsi }) - rest);
    lifts.reduce((low, high) => { expect(high).toBeGreaterThan(low); return high; }, 0);
    expect(lifts[2]).toBeGreaterThan(15);
    expect(lifts[2]).toBeLessThan(30);
  });
  it.each(SIDES)("does not count moving the whole foot or leg as lifting the toes (%s side)", side => {
    const rest = lift(side);
    for (const posture of [{ slide: 0.05 }, { slide: -0.05 }, { legUp: 0.05 }, { kneeOut: 0.05 }] as Posture[]) {
      expect(Math.abs(lift(side, posture) - rest), JSON.stringify(posture)).toBeLessThan(EXERCISES[ID].romSteps[0].learnedFloor!);
    }
    // The heel or the toes out of view: nothing measured.
    for (const hidden of [heelIndex(side), poseJoints(side).foot]) {
      const pose = toeBody(side);
      expect(toeLiftRaw({ ...pose, landmarks: pose.landmarks.map((p, index) => (index === hidden ? { ...p, visibility: 0.1 } : p)) }, side, ASPECT)).toBeUndefined();
    }
  });
  it("steadies the measure over the last few frames, dropping a single jump", () => {
    const filter = new ToeLiftFilter();
    for (const [t, value] of [[0, -5], [50, -5], [100, 20], [150, -5], [200, -5]] as const) filter.push(t, value);
    expect(filter.push(250, -5)).toBe(-5);
    // An old sample drops out after 250 ms; a lost frame reads nothing.
    expect(filter.push(260, undefined)).toBeUndefined();
    expect(filter.push(1000, 10)).toBe(10);
  });
  it.each(SIDES)("learns the resting foot once the seated body is in view with the foot turned out, toes down (%s side)", side => {
    const pose = toeBody(side), j = poseJoints(side);
    const rest = toeRestCheck(pose, side, ASPECT);
    expect(rest.lapRest).toBeDefined();
    expect(rest.lapRest!.x).toBeCloseTo(pose.landmarks[j.ankle].x);
    // A smaller turn out still counts.
    expect(toeRestCheck(toeBody(side, { turn: 35 }), side, ASPECT).lapRest).toBeDefined();
    // Pointing at the camera, or barely turned: asked to turn the foot out.
    const turnOut = `Keep your ${side} heel under your knee and turn your toes out to the side, onto the outline.`;
    expect(toeRestCheck(toeBody(side, { turn: 0 }), side, ASPECT).lapMissing).toBe(turnOut);
    expect(toeRestCheck(toeBody(side, { turn: 10 }), side, ASPECT).lapMissing).toBe(turnOut);
    // Turned in, toward the other foot.
    expect(toeRestCheck(toeBody(side, { turn: -60 }), side, ASPECT).lapMissing).toBe(turnOut);
    // The toes already up.
    expect(toeRestCheck(toeBody(side, { dorsi: 25 }), side, ASPECT).lapMissing).toBe("Rest your toes on the floor, heel down.");
    // The heel hidden.
    const hidden = { ...pose, landmarks: pose.landmarks.map((p, index) => (index === heelIndex(side) ? { ...p, visibility: 0.1 } : p)) };
    expect(toeRestCheck(hidden, side, ASPECT).lapMissing).toBe(`Tilt the camera down a little so I can see your ${side} heel and toes.`);
    // Too far away for the foot's turn to show.
    expect(toeRestCheck(toeBody(side, { camera: { y: 0, z: 5 } }), side, ASPECT).lapMissing).toBe("Move the camera a little closer, keeping your feet in view.");
    // The knee's own set-up checks still apply.
    expect(toeRestCheck(toeBody(side, { camera: { y: 0, z: 1.1 } }), side, ASPECT).lapMissing).toBeDefined();
    expect(toeRestCheck(null, side, ASPECT).lapMissing).toBeDefined();
  });
  it.each(SIDES)("curves the arrow up about the heel from just beyond the resting toes, inside the picture (%s side)", side => {
    const pose = toeBody(side), j = poseJoints(side);
    const geo = toeFrame({ pose }, side, 0, ASPECT, null).geo!;
    const dial = kneeDial(pose, side, ASPECT)!;
    const guide = toeGuide(geo, dial, ASPECT)!;
    const toe = pose.landmarks[j.foot], heel = pose.landmarks[heelIndex(side)];
    // The toes point out from the body, as the dial does; the arrow starts beyond them and rises.
    expect(guide.out).toBe(dial.out);
    expect((guide.start.x - toe.x) * guide.out).toBeGreaterThan(0);
    expect(guide.end.y).toBeLessThan(guide.start.y - 0.03);
    // Every point about the same distance from the heel (an arc), a little more than the foot's length.
    const foot = Math.hypot((toe.x - heel.x) * ASPECT, toe.y - heel.y);
    for (const p of [guide.start, guide.end]) expect(Math.hypot((p.x - heel.x) * ASPECT, p.y - heel.y)).toBeCloseTo(1.15 * foot, 2);
    for (const p of [guide.start, guide.control, guide.end]) { expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(1); }
    expect(toeGuide(null, dial, ASPECT)).toBeNull();
    expect(toeGuide(geo, null, ASPECT)).toBeNull();
  });
  it.each(SIDES)("draws the dial's circle beside the shoulder, the goal above the resting toes (%s side)", side => {
    const dial = kneeDial(toeBody(side), side, ASPECT)!;
    const goal = toeDialCircle(dial, false, 640, 480), down = toeDialCircle(dial, true, 640, 480);
    expect(goal.y).toBeLessThan(down.y);
    expect(goal.radius).toBeGreaterThan(0);
    for (const p of [goal, down]) { expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(640); expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(480); }
    expect(toeDialDegrees(0)).toBe(0);
    expect(toeDialDegrees(1)).toBe(TOE_DIAL_GOAL_DEG);
    expect(toeDialDegrees(Number.NaN)).toBe(0);
  });
  it.each(SIDES)("reports the foot's real lift, though the picture shows a partly turned foot lift further (%s side)", side => {
    for (const turn of [40, 60, 90]) {
      const ref = toeFrame({ pose: toeBody(side, { turn }) }, side, 0, ASPECT, null).geo!;
      const shown = lift(side, { turn, dorsi: 20 }) - lift(side, { turn });
      if (turn === 40) expect(shown).toBeGreaterThan(25);
      expect(Math.abs(toeTrueLift(shown, ref) - 20), String(turn)).toBeLessThan(4);
    }
  });
  it("takes a lift's resting foot angle only when the toes are plausibly resting", () => {
    // Set down a little more side-on (higher) or more toward the camera (lower): yes; toes already up: no.
    expect(toeRestShiftOk(6)).toBe(true);
    expect(toeRestShiftOk(-15)).toBe(true);
    expect(toeRestShiftOk(14)).toBe(false);
    expect(toeRestShiftOk(-25)).toBe(false);
  });
  it("sets a modest practice goal from the resting toes", () => {
    expect(toePracticeGoal(-4)).toBe(-4 + TOE_PRACTICE_LIFT);
  });
  it("judges the checks from where the legs rest before each lift, keeping the rest of the set-up reference", () => {
    const setup = toeFrame({ pose: toeBody("right") }, "right", 0, ASPECT, null).geo!;
    const moved = toeFrame({ pose: toeBody("right", { slide: 0.08, otherFoot: [0.05, 0, 0.05] }) }, "right", 0, ASPECT, null).geo!;
    const ref = toeRebase(setup, moved);
    expect(ref.heelImgY).toBe(moved.heelImgY);
    expect(ref.otherAnkleImgX).toBe(moved.otherAnkleImgX);
    expect(ref.kneeShin).toBe(setup.kneeShin);
    expect(ref.shoulderWidth).toBe(setup.shoulderWidth);
    // The set-up foot's turn stays: the session judges every lift as that foot would show it.
    expect(ref.footAcross).toBe(setup.footAcross);
  });
  it("shows a lift as the set-up foot would: the same when turned alike, smaller from a foot less side-on", () => {
    const geo = (turn: number) => toeFrame({ pose: toeBody("right", { turn }) }, "right", 0, ASPECT, null).geo!;
    const setup = geo(60), less = geo(35);
    expect(toeInSetupView(14, 4, -5, setup.footAcross, setup.footAcross, setup.kneeShin)).toBeCloseTo(5);
    // Below rest: as it is.
    expect(toeInSetupView(1, 4, -5, less.footAcross, setup.footAcross, setup.kneeShin)).toBeCloseTo(-8);
    // The real 20 degree lift seen from the less side-on foot shows larger; in the set-up foot's view, as the set-up foot shows it.
    const shownLess = lift("right", { turn: 35, dorsi: 20 }) - lift("right", { turn: 35 }), shownSetup = lift("right", { dorsi: 20 }) - lift("right");
    expect(shownLess).toBeGreaterThan(shownSetup + 5);
    expect(Math.abs(toeInSetupView(shownLess, 0, 0, less.footAcross, setup.footAcross, setup.kneeShin) - shownSetup)).toBeLessThan(2.5);
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
  it.each([
    ["heel_lift", { heelUp: 0.05 }],
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
    ["heel_lift", { heelUp: 0.015 }],
    ["heel_lift", { kick: 5 }],
    ["knee_motion", { thighLift: 2 }],
    ["knee_sideways", { kneeOut: 0.02 }],
    ["other_leg", { otherKnee: 100 }],
    ["other_leg", { otherDorsi: 3 }],
    ["trunk_forward", { lean: 4 }],
    ["trunk_lean", { lean: -4 }],
  ] as const)("lets a small %s pass (%j)", (_id, posture) => {
    for (const side of SIDES) expect(over(side, { dorsi: 15, ...posture }), side).toEqual([]);
  });
  it.each(SIDES)("reads a knee kick as much less lift than a toe lift of the same size (%s side)", side => {
    // From the front a kick hardly moves the heel in the picture (it comes toward the camera as it rises), and no
    // check catches a small one; but with the foot turned out it turns the foot up only about half as far.
    const rest = lift(side);
    expect(lift(side, { kick: 20 }) - rest).toBeLessThan(0.6 * (lift(side, { dorsi: 20 }) - rest));
  });
  it("leaves a check unmeasured when its body part is out of view, and the lift when the foot is", () => {
    const pose = toeBody("right", { dorsi: 15 });
    const hidden = { ...pose, landmarks: pose.landmarks.map((p, index) => (index <= 12 ? { ...p, visibility: 0.1 } : p)) };
    const frame = toeFrame({ pose: hidden }, "right", 0, ASPECT, reference("right"));
    expect(frame.comps.trunk_retreat_pct).toBeUndefined();
    expect(frame.comps.trunk_approach_pct).toBeUndefined();
    expect(frame.visible).toBe(true);
    const noHeel = { ...pose, landmarks: pose.landmarks.map((p, index) => (index === heelIndex("right") ? { ...p, visibility: 0.1 } : p)) };
    const lost = toeFrame({ pose: noHeel }, "right", 0, ASPECT, reference("right"));
    expect(lost.visible).toBe(false);
    expect(lost.values.toe_lift).toBeUndefined();
    expect(lost.comps.heel_lift_pct).toBeUndefined();
    expect(lost.missing).toBe("Keep your knees and feet in view of the camera.");
  });
});

describe("the toe lift's set-up foot guide", () => {
  it.each(SIDES)("outlines the foot on the floor: heel under the knee, toes turned out as set-up needs (%s side)", side => {
    const pose = toeBody(side, { turn: 0 }), j = poseJoints(side);
    const guide = toeFootGuide(pose, side, ASPECT)!;
    const knee = pose.landmarks[j.knee], heel = pose.landmarks[heelIndex(side)];
    const out = Math.sign(pose.landmarks[j.hip].x - pose.landmarks[j.hipOther].x);
    expect(guide.heel.x).toBeCloseTo(knee.x);
    expect(guide.heel.y).toBeCloseTo(heel.y);
    // The outline's toes point out from the body, a little below level: turned out as far as set-up needs, with some to spare.
    expect((guide.toe.x - guide.heel.x) * out).toBeGreaterThan(0);
    const angle = Math.atan2(guide.heel.y - guide.toe.y, Math.abs(guide.toe.x - guide.heel.x) * ASPECT) * 180 / Math.PI;
    expect(angle).toBeLessThan(-10);
    expect(angle).toBeGreaterThan(-35);
    // The other heel level with it, under the other knee.
    expect(guide.otherHeel!.x).toBeCloseTo(pose.landmarks[j.kneeOther].x);
    expect(guide.otherHeel!.y).toBeCloseTo(guide.heel.y);
    // Pointing at the camera: not in place yet; turned out: in place.
    expect(guide.met).toBe(false);
    expect(toeFootGuide(toeBody(side, { turn: 60 }), side, ASPECT)!.met).toBe(true);
    expect(toeFootGuide(null, side, ASPECT)).toBeNull();
  });
  it("shows the foot in place exactly when set-up's own check passes", () => {
    for (const side of SIDES) for (const turn of [0, 15, 30, 45, 60, 80]) {
      const pose = toeBody(side, { turn });
      expect(toeFootGuide(pose, side, ASPECT)!.met, `${side} ${turn}`).toBe(toeRestCheck(pose, side, ASPECT).lapRest !== undefined);
    }
  });
  it.each(SIDES)("asks for the heel under the knee and the toes out onto the outline, naming the side (%s side)", side => {
    expect(toeRestCheck(toeBody(side, { turn: 0 }), side, ASPECT).lapMissing).toBe(`Keep your ${side} heel under your knee and turn your toes out to the side, onto the outline.`);
  });
  it.each(SIDES)("does not send a foot set a little forward back toward the chair: set-up does not judge the knee's 3D angle (%s side)", side => {
    // 40 cm forward of under the knee: the knee reads about 134 degrees open in 3D, past the knee exercise's 130 at rest.
    expect(toeRestCheck(toeBody(side, { slide: 0.4 }), side, ASPECT).lapRest).toBeDefined();
  });
  it("follows the foot smoothly from frame to frame, but says at once whether it is in place", () => {
    const before = toeFootGuide(toeBody("right", { turn: 0 }), "right", ASPECT)!, after = toeFootGuide(toeBody("right", { turn: 60, kneeOut: 0.05 }), "right", ASPECT)!;
    const followed = followToeFootGuide(before, after)!;
    expect(followed.heel.x).toBeGreaterThan(Math.min(before.heel.x, after.heel.x));
    expect(followed.heel.x).toBeLessThan(Math.max(before.heel.x, after.heel.x));
    expect(followed.met).toBe(after.met);
    expect(followToeFootGuide(null, after)).toBe(after);
    expect(followToeFootGuide(before, null)).toBe(before);
  });
});

describe("the toes' targets", () => {
  const base = { rest: -4, goal: 16, lowering: false, armed: true, practice: false, t: 0 };
  it("is on the lift target at the goal, and stays on it until the toes sag a little", () => {
    const target = new ToeTarget();
    expect(target.update("a", { ...base, value: 15.5 }).contact).toBe(false);
    expect(target.update("a", { ...base, value: 16 }).contact).toBe(true);
    expect(target.update("a", { ...base, value: 16 - TOE_HYSTERESIS + 0.1 }).contact).toBe(true);
    expect(target.update("a", { ...base, value: 16 - TOE_HYSTERESIS - 0.1 }).contact).toBe(false);
    expect(target.update("a", { ...base, value: 15 }).contact).toBe(false);
    expect(target.update("a", { ...base, value: 6 }).progress).toBeCloseTo(0.5);
    expect(target.update("a", { ...base, value: undefined }).contact).toBe(false);
  });
  it("is on the lower target with the toes most of the way down, and a little higher after a while lowering", () => {
    const target = new ToeTarget(), lowering = { ...base, lowering: true };
    // The goal is 20 above rest: down within 30% of that (6).
    expect(target.update("b", { ...lowering, value: 3 }).contact).toBe(false);
    expect(target.update("b", { ...lowering, value: 1.5 }).contact).toBe(true);
    expect(target.update("b", { ...lowering, value: 4 }).contact).toBe(true);
    const late = new ToeTarget();
    expect(late.update("c", { ...lowering, value: 5, t: 0 }).contact).toBe(false);
    expect(late.update("c", { ...lowering, value: 5, t: 10500 }).contact).toBe(true);
    // A small goal (the learned floor): after a while, toes settled within the rest calibration's 8 degrees still count.
    const small = new ToeTarget(), floor = { ...lowering, goal: -4 + 6 };
    expect(small.update("d", { ...floor, value: 3, t: 0 }).contact).toBe(false);
    expect(small.update("d", { ...floor, value: 3, t: 10500 }).contact).toBe(true);
    expect(small.update("e", { ...floor, value: 6, t: 20000 }).contact).toBe(false);
    // Lifted well past the goal, then set down resting higher than before: half the way down from the top counts, after a while.
    const high = new ToeTarget();
    expect(high.update("f", { ...lowering, value: 26, t: 0 }).contact).toBe(false);
    expect(high.update("f", { ...lowering, value: 14, t: 5000 }).contact).toBe(false);
    expect(high.update("f", { ...lowering, value: 14, t: 10500 }).contact).toBe(true);
  });
  it("brings a practice goal closer when it is not reached for a while, but never a scored one", () => {
    const target = new ToeTarget(), practice = { ...base, practice: true, goal: toePracticeGoal(-4) };
    expect(target.update("p", { ...practice, value: 5, t: 0 }).contact).toBe(false);
    expect(target.update("p", { ...practice, value: 5, t: TOE_EASE_MS - 10 }).contact).toBe(false);
    expect(target.update("p", { ...practice, value: 5, t: TOE_EASE_MS + 10 })).toMatchObject({ contact: true, eased: true, goal: -4 + TOE_EASED_LIFT });
    const scored = new ToeTarget();
    expect(scored.update("s", { ...base, value: 5, t: 0 }).contact).toBe(false);
    expect(scored.update("s", { ...base, value: 5, t: TOE_EASE_MS * 2 }).contact).toBe(false);
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
  it("shows the circle on the demonstration's ankle dial, up beside the close-up foot, mirrored for the other side", () => {
    const right = toeGhostTarget(300, 270, false, "right"), left = toeGhostTarget(300, 270, false, "left");
    expect(left.x).toBeCloseTo(300 - right.x);
    expect(right.x).toBeGreaterThan(200);
    expect(right.y).toBeLessThan(120);
    // The goal circle is above the resting one.
    expect(toeGhostTarget(300, 270, true, "right").y).toBeGreaterThan(right.y);
    // The circle is reached as the demonstration's dial toes get there, before the hold.
    expect(toeDemoState(toeDemoDuration(false) - 1, false).target[0]).toBeCloseTo(right.x);
    expect(toeDemoState(0, false).instruction).toMatch(/turned out and your heel down/);
  });
  it("previews its two steps, the set-up checks with the heel and toes and the lighting, and the results", () => {
    expect(exerciseScreenPreview("warm-reach", 1, "right", ID).snapshot).toMatchObject({ kind: "reach", stepIndex: 0, stepCount: 2 });
    expect(exerciseScreenPreview("reps-return", 1, "right", ID).snapshot).toMatchObject({ kind: "return", stepIndex: 1 });
    expect(exerciseScreenPreview("setup", 1, "left", ID).bodyChecks.map(check => check.label)).toEqual(["Face", "Both shoulders", "Both hips", "Both knees", "Both feet", "Left heel and toes", "Foot turned out, heel down, space around you", "Lighting"]);
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
/**
 * eager: in the scored repetitions, the patient starts to lift as the cue begins, before the circle is active.
 * perRep: a posture kept through one scored repetition (by its number, from 1).
 */
function toePatient(side: Side, scored: (dorsi: number) => Posture = () => ({}), options: { reps?: number; lift?: number; repLift?: number; fastReps?: boolean; always?: Posture; perRep?: (rep: number) => Posture; speechMs?: number; eager?: boolean } = {}) {
  const said: string[] = [];
  // speechMs: each line keeps the voice busy this long (0: speech takes no time).
  let now = 0, speakingUntil = 0;
  const session = new ExerciseSession({ exerciseId: ID, rung: 1, side, repsOverride: options.reps ?? 2, reviewBetweenReps: true }, {
    say: text => { said.push(text); speakingUntil = now + (options.speechMs ?? 0); }, busy: at => at < speakingUntil, stop() { speakingUntil = 0; },
  });
  const target = new ToeTarget(), filter = new ToeLiftFilter();
  let t = 0, dorsi = 0;
  session.start(t);
  for (let n = 0; n < 40000 && session.snapshot().phase !== "done"; n++) {
    t += 50; now = t;
    const snap: Snapshot = session.snapshot();
    const live = (snap.phase === "warm" || snap.phase === "reps") && !snap.review;
    const high = snap.phase === "reps" ? options.repLift ?? options.lift ?? 20 : options.lift ?? 20;
    const moving = live && (snap.targetArmed || (options.eager === true && snap.phase === "reps" && snap.kind === "reach"));
    const want = moving ? (snap.kind === "return" ? 0 : high) : dorsi;
    const speed = options.fastReps && snap.phase === "reps" ? 150 : 20;
    dorsi += Math.sign(want - dorsi) * Math.min(Math.abs(want - dorsi), speed * 0.05);
    // A scored posture starts with the movement.
    // A repetition's own posture is taken up during the countdown before it.
    const repNumber = snap.review === "countdown" ? snap.repIndex + 1 : snap.repIndex;
    const extra = { ...(snap.phase === "reps" ? { ...options.always, ...options.perRep?.(repNumber) } : {}), ...(moving && snap.phase === "reps" && snap.kind === "reach" ? scored(dorsi) : {}) };
    const frame = toeFrame({ pose: toeBody(side, { dorsi, ...extra }) }, side, t, ASPECT, session.reference, filter);
    if (live) {
      const rest = session.restValues().toe_lift;
      const goal = snap.phase === "reps" ? session.targets().toe_lift : toePracticeGoal(rest);
      // Judged from where this lift's foot rested, and on target only once the circle is active, as the page does.
      const value = session.toeValue(frame.values.toe_lift);
      const result = target.update(`${snap.phase}:${snap.repIndex}:${snap.stepIndex}`, {
        value, rest, goal, lowering: snap.kind === "return", armed: snap.targetArmed, practice: snap.phase === "warm", t,
      });
      frame.targetContact = frame.visible && snap.targetArmed && result.contact;
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
    expect(Math.abs(session.learnedValue("toe_lift")! - (rest + 0.9 * (held - rest)))).toBeLessThan(1.5);
    // The best is read out as the lift from rest, in degrees: near the 20 degrees lifted.
    expect(snap.record?.best_value).toBeGreaterThan(15);
    expect(snap.record?.best_value).toBeLessThan(30);
    // The full instructions once in practice (with the dial moving with the foot), the short cues in each scored repetition, and no "slowly" reminder.
    const [up, down] = EXERCISES[ID].cycle;
    expect(said.filter(line => line === up.voice)).toHaveLength(1);
    expect(said.some(line => /moves with your foot/.test(line))).toBe(true);
    for (const step of [up, down]) expect(said.filter(line => line === step.cue)).toHaveLength(2);
    expect(said).not.toContain(EXERCISES[ID].speedCue!.lift);
  });
  it.each([
    // The heel coming up as the toes lift (which lowers the toes, so this patient lifts them further to reach).
    ["heel_lift", (dorsi: number) => ({ heelUp: 0.05 * Math.min(1, dorsi / 10) }), 35],
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
    const reps = toePatient("right", () => ({ heelUp: 0.05 }), { reps: 1 }).session.snapshot().reps;
    expect(reps[0].compensations).toEqual(["heel_lift"]);
  });
  it("does not count the other foot moved between repetitions as the other leg helping", () => {
    const { session } = toePatient("right", () => ({}), { always: { otherFoot: [0.1, 0, 0.08] } });
    expect(session.snapshot().reps.map(rep => rep.compensations)).toEqual([[], []]);
    expect(session.snapshot().record?.repetition_scores).toEqual([100, 100]);
  });
  it("does not count the foot or knee set down differently between repetitions as a check", () => {
    // The foot 8 cm further forward and the knee a little further out, kept still through each lift.
    const { session } = toePatient("right", () => ({}), { always: { slide: 0.08, kneeOut: 0.05 } });
    expect(session.snapshot().reps.map(rep => rep.compensations)).toEqual([[], []]);
    expect(session.snapshot().record?.repetition_scores).toEqual([100, 100]);
  });
  it.each([35, 85])("judges each lift from where its foot rests, as the set-up foot would show it, though turned differently (%s degrees)", turn => {
    // Set up and practised at 60 degrees lifting 20; each scored lift starts with the foot turned differently, so it
    // rests at another angle and shows the same real lift larger or smaller. The same real lift still reaches the circle.
    const { session } = toePatient("right", () => ({}), { always: { turn }, repLift: 20 });
    expect(session.snapshot().reps.map(rep => rep.compensations)).toEqual([[], []]);
    expect(session.snapshot().record?.repetition_scores).toEqual([100, 100]);
    // A much smaller real lift does not, though the less side-on foot shows it larger.
    if (turn === 35) expect(toePatient("right", () => ({}), { always: { turn }, repLift: 11, reps: 1 }).session.snapshot().reps[0].hold).toBe("none");
  });
  it("judges each lift from its own resting foot from the start, never the last one's", () => {
    // A weak patient; the foot is set down turned less for the first scored lift and back where it was set up for the
    // second (each during the countdown before it), with the cue taking its time as spoken.
    const { session } = toePatient("right", () => ({}), { lift: 9, repLift: 9, perRep: rep => (rep === 1 ? { turn: 30 } : {}), speechMs: 1200 });
    expect(session.snapshot().reps.map(rep => rep.hold)).toEqual(["full", "full"]);
    expect(session.snapshot().record?.repetition_scores).toEqual([100, 100]);
  });
  it("re-checks where the legs rest once per lift, not again when a reminder mid-lift re-arms it", () => {
    // Speech takes time, so the "slowly" reminder during a quick lift pauses the circle; the knee is moving out by then.
    const { session, said } = toePatient("right", dorsi => ({ kneeOut: 0.07 * Math.min(1, dorsi / 12) }), { fastReps: true, speechMs: 800, repLift: 24 });
    expect(said).toContain(EXERCISES[ID].speedCue!.lift);
    for (const rep of session.snapshot().reps) expect(rep.compensations).toEqual(["knee_sideways"]);
  });
  it("judges where the legs rest from the start of the instruction, before the patient moves with it", () => {
    // Speech takes time and the patient starts lifting, knee moving out, as soon as the cue begins.
    const { session } = toePatient("right", dorsi => ({ kneeOut: 0.07 * Math.min(1, dorsi / 12) }), { speechMs: 1500, repLift: 24, eager: true });
    for (const rep of session.snapshot().reps) expect(rep.compensations).toEqual(["knee_sideways"]);
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
