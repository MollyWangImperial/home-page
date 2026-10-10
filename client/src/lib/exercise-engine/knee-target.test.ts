import { describe, expect, it } from "vitest";
import { EXERCISES, usesSeatedTargets, usesTargetFlow, type Side } from "./config";
import { compensationStatus, poseJoints, type PoseInput, type Pt } from "./metrics";
import { reachDemoState } from "./reach-demo";
import { exerciseScreenPreview } from "./screen-preview";
import { ExerciseSession, simFrame, type Snapshot } from "./session";
import {
  DIAL_GOAL_DEG, dialPoint, drawKneeDial, drawKneeGuide, drawKneeScene, kneeDemoDuration, kneeDemoState, kneeDial, kneeFrame, kneeGhostContact, kneeGhostTarget, kneeGuide,
  kneePracticeGoal, kneeRestCheck, KneeTarget, KNEE_EASE_MS, KNEE_EASED_DEG, KNEE_HYSTERESIS_DEG,
} from "./knee-target";
import { drawToeScene } from "./toe-target";

/** A canvas context that records its drawing calls (text measured at about 0.6 of the font size a character). */
function recordingContext() {
  const calls: { name: string; args: unknown[] }[] = [];
  const state: Record<string, unknown> = { font: "10px sans-serif" };
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop === "measureText") return (text: string) => ({ width: text.length * 0.6 * Number(/(\d+(?:\.\d+)?)px/.exec(String(target.font))?.[1] ?? 10) });
      if (prop in target) return target[prop];
      return (...args: unknown[]) => { calls.push({ name: prop, args }); return gradient; };
    },
    set(target, prop: string, value) { target[prop] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, texts: () => calls.filter(call => call.name === "fillText").map(call => ({ text: call.args[0] as string, x: call.args[1] as number, y: call.args[2] as number })) };
}

const ASPECT = 4 / 3;
const SIDES: Side[] = ["left", "right"];
const ID = "ex_lower_selective";
const rule = (id: string) => EXERCISES[ID].compensations.find(item => item.id === id)!;

// ---------- a seated patient's landmarks, seen by a front camera ----------

type P3 = [number, number, number];
/** The seated posture: knee angles (90 resting), trunk leans (degrees), the affected hip hitched (metres), the thigh lifted (degrees). */
type Posture = { knee?: number; otherKnee?: number; lean?: number; sideLean?: number; hipHike?: number; thighLift?: number; otherFoot?: P3; camera?: { y: number; z: number } };

// Body points in metres: x to the patient's left, y up, z toward the camera, from the middle of the hips.
const UPPER: Record<number, P3> = {
  0: [0, 0.62, 0.1], 1: [0.015, 0.655, 0.085], 2: [0.03, 0.655, 0.08], 3: [0.045, 0.655, 0.075], 4: [-0.015, 0.655, 0.085], 5: [-0.03, 0.655, 0.08], 6: [-0.045, 0.655, 0.075],
  7: [0.075, 0.64, 0], 8: [-0.075, 0.64, 0], 9: [0.025, 0.585, 0.09], 10: [-0.025, 0.585, 0.09],
  11: [0.18, 0.5, 0], 12: [-0.18, 0.5, 0], 13: [0.21, 0.26, 0.05], 14: [-0.21, 0.26, 0.05],
  // Hands resting on the thighs.
  15: [0.16, 0.06, 0.3], 16: [-0.16, 0.06, 0.3], 17: [0.17, 0.04, 0.36], 18: [-0.17, 0.04, 0.36], 19: [0.15, 0.04, 0.37], 20: [-0.15, 0.04, 0.37], 21: [0.13, 0.06, 0.33], 22: [-0.13, 0.06, 0.33],
};
/**
 * Turn (y, z) about the x axis by `deg`, about a pivot: positive turns a point below the pivot toward the camera
 * (the lower leg swinging forward) and a point in front of it up (the thigh lifting); negative turns a point above
 * it toward the camera (the trunk leaning forward).
 */
const pitch = ([x, y, z]: P3, [, py, pz]: P3, deg: number): P3 => {
  const a = deg * Math.PI / 180, dy = y - py, dz = z - pz;
  return [x, py + dy * Math.cos(a) + dz * Math.sin(a), pz - dy * Math.sin(a) + dz * Math.cos(a)];
};
/** One leg from its hip: the thigh level forward to the knee, the lower leg at `knee` degrees, the foot turning with it. */
function leg(hipX: number, knee: number, thighLift = 0, lift = 0): Record<"hip" | "knee" | "ankle" | "heel" | "toe", P3> {
  const hip: P3 = [hipX, lift, 0];
  const kneeAt: P3 = [hipX, lift, 0.45];
  const below = (p: P3) => pitch([hipX, kneeAt[1] + p[1], kneeAt[2] + p[2]], kneeAt, knee - 90);
  const points = { hip, knee: kneeAt, ankle: below([0, -0.42, 0]), heel: below([0, -0.47, -0.05]), toe: below([0, -0.47, 0.15]) };
  if (thighLift) for (const key of ["knee", "ankle", "heel", "toe"] as const) points[key] = pitch(points[key], hip, thighLift);
  return points;
}

/** MediaPipe-style landmarks (image and world) of the seated patient, the camera at hip height 2.2 m away by default. */
function kneeBody(side: Side, posture: Posture = {}): PoseInput {
  const camera = posture.camera ?? { y: 0, z: 2.2 };
  const affectedX = side === "left" ? 0.1 : -0.1;
  const mine = leg(affectedX, posture.knee ?? 90, posture.thighLift ?? 0, posture.hipHike ?? 0);
  const theirs = leg(-affectedX, posture.otherKnee ?? 90);
  if (posture.otherFoot) for (const key of ["ankle", "heel", "toe"] as const) theirs[key] = [theirs[key][0] + posture.otherFoot[0], theirs[key][1] + posture.otherFoot[1], theirs[key][2] + posture.otherFoot[2]];
  const j = poseJoints(side);
  const points: Record<number, P3> = { ...UPPER };
  const set = (index: number, otherIndex: number, key: keyof typeof mine) => { points[index] = mine[key]; points[otherIndex] = theirs[key]; };
  set(j.hip, j.hipOther, "hip"); set(j.knee, j.kneeOther, "knee"); set(j.ankle, j.ankleOther, "ankle"); set(j.foot, j.footOther, "toe");
  set(side === "left" ? 29 : 30, side === "left" ? 30 : 29, "heel");
  const landmarks: Pt[] = [], world: Pt[] = [];
  for (let index = 0; index < 33; index++) {
    let p = points[index];
    if (index <= 22) {
      // The trunk leans about the hips: forward (positive) toward the camera, sideways (positive) to the patient's left.
      p = pitch(p, [0, 0, 0], -(posture.lean ?? 0));
      const b = (posture.sideLean ?? 0) * Math.PI / 180;
      p = [p[0] * Math.cos(b) + p[1] * Math.sin(b), -p[0] * Math.sin(b) + p[1] * Math.cos(b), p[2]];
    }
    const depth = camera.z - p[2];
    landmarks.push({ x: 0.5 + 0.75 * p[0] / depth, y: 0.5 - (p[1] - camera.y) / depth, z: -p[2], visibility: 1 });
    world.push({ x: p[0], y: -p[1], z: -p[2], visibility: 1 });
  }
  return { landmarks, world };
}

const at = (pose: PoseInput, index: number) => pose.landmarks[index];

describe("Seated Knee Extension on the shared target flow", () => {
  it("runs on the target flow with the approved checks, keeping Alira's level planning as it is", () => {
    expect(usesTargetFlow(ID)).toBe(true);
    expect(usesSeatedTargets(ID)).toBe(false);
    expect(EXERCISES[ID].compensations.map(item => item.id)).toEqual(["trunk_lean", "trunk_forward", "trunk_side_lean", "hip_hike", "thigh_lift", "other_leg"]);
    expect(EXERCISES[ID].cycle.map(step => step.kind)).toEqual(["reach", "return"]);
    expect(EXERCISES[ID].framing).toMatch(/head to feet/);
  });
  it.each(SIDES)("measures the knee from the 3D landmarks as it straightens (%s side)", side => {
    for (const knee of [90, 125, 150, 175]) expect(kneeFrame({ pose: kneeBody(side, { knee }) }, side, 0, ASPECT, null).values.knee_extension!).toBeCloseTo(knee, 0);
  });
  it.each(SIDES)("learns the resting foot once the whole seated body is in view with both feet flat (%s side)", side => {
    const pose = kneeBody(side), j = poseJoints(side);
    const rest = kneeRestCheck(pose, side, ASPECT);
    expect(rest.lapRest).toBeDefined();
    expect(rest.lapRest!.x).toBeCloseTo(at(pose, poseJoints(side).ankle).x);
    expect(rest.lapRest!.bodyScale).toBeGreaterThan(0.15);
    // Too close: the head is out of the picture.
    expect(kneeRestCheck(kneeBody(side, { camera: { y: 0, z: 1.1 } }), side, ASPECT).lapMissing).toMatch(/head to your feet|space|both feet/);
    // A foot raised off the floor.
    expect(kneeRestCheck(kneeBody(side, { knee: 150 }), side, ASPECT).lapMissing).toMatch(/flat on the floor/);
    // A foot out in front that the picture still shows below the knee: the knee's 3D angle gives it away.
    const forward = { landmarks: pose.landmarks, world: kneeBody(side, { knee: 140 }).world };
    expect(kneeRestCheck(forward, side, ASPECT).lapMissing).toBe("Put your foot flat on the floor, below your knee.");
    // The camera a little high: the toes out of the picture are fine, the ankles near the bottom edge are not.
    const toesOut = kneeBody(side, { camera: { y: 0.3, z: 2.2 } });
    expect(toesOut.landmarks[j.foot].y).toBeGreaterThan(0.97);
    expect(kneeRestCheck(toesOut, side, ASPECT).lapRest).toBeDefined();
    expect(kneeRestCheck(kneeBody(side, { camera: { y: 0.42, z: 2.2 } }), side, ASPECT).lapMissing).toBe("Tilt the camera down a little so there is space below your feet.");
    // Standing up (both knees straight): asked to sit down.
    expect(kneeRestCheck(kneeBody(side, { knee: 178, otherKnee: 178 }), side, ASPECT).lapMissing).toBe("Sit down on a chair facing the camera, with your knees bent and both feet flat on the floor.");
    expect(kneeRestCheck(null, side, ASPECT).lapMissing).toBeDefined();
  });
  it.each(SIDES)("puts the knee dial beside the affected shoulder at chest height, out from the body and inside the picture (%s side)", side => {
    const pose = kneeBody(side), j = poseJoints(side);
    const dial = kneeDial(pose, side, ASPECT)!;
    const shoulder = at(pose, j.shoulder), other = at(pose, j.shoulderOther), hip = at(pose, j.hip);
    const out = Math.sign(shoulder.x - other.x);
    expect(dial.out).toBe(out);
    // Out past the affected shoulder (away from the other one), between the shoulders and the hips.
    expect((dial.pivot.x - shoulder.x) * out).toBeGreaterThan(0);
    expect(dial.pivot.y).toBeGreaterThan(shoulder.y);
    expect(dial.pivot.y).toBeLessThan(hip.y);
    // Resting: the dial's foot straight below its knee; at the goal, out to the side, still in the picture.
    const down = dialPoint(dial, 0, ASPECT), goal = dialPoint(dial, DIAL_GOAL_DEG, ASPECT);
    expect(down.x).toBeCloseTo(dial.pivot.x);
    expect(down.y).toBeGreaterThan(dial.pivot.y);
    expect((goal.x - dial.pivot.x) * dial.out).toBeGreaterThan(0);
    for (const p of [down, goal]) { expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(1); expect(p.y).toBeLessThan(1); }
    // Clear of the leg: the whole dial sits above the knee.
    expect(down.y + 0.3 * dial.radius).toBeLessThan(at(pose, j.knee).y + 0.02);
  });
  it.each(SIDES)("draws the straightening arrow forward toward the camera and a little out: from by the resting foot, rising out to the side (%s side)", side => {
    const pose = kneeBody(side), j = poseJoints(side);
    const geo = kneeFrame({ pose }, side, 0, ASPECT, null).geo!;
    const dial = kneeDial(pose, side, ASPECT)!;
    const guide = kneeGuide(geo, dial, ASPECT)!;
    const ankle = at(pose, j.ankle), { lift, lower } = guide;
    const out = (p: { x: number }) => (p.x - ankle.x) * dial.out;
    // It starts just out from the resting foot, on the dial's side.
    expect(Math.hypot((lift.start.x - ankle.x) * ASPECT, lift.start.y - ankle.y)).toBeLessThan(0.6 * guide.shin);
    expect(out(lift.start)).toBeGreaterThan(0);
    // It runs well out to the side and up, its head above the resting foot, sagging a little on the way.
    expect(out(lift.end) * ASPECT).toBeGreaterThan(guide.shin);
    expect(lift.end.y).toBeLessThan(ankle.y - 0.3 * guide.shin);
    expect(lift.control.y).toBeGreaterThan((lift.start.y + lift.end.y) / 2);
    // Lowering: the same path back to the resting foot.
    expect(lower).toEqual({ start: lift.end, control: lift.control, end: lift.start });
    expect(kneeGuide(null, dial, ASPECT)).toBeNull();
    // Near the edge of the picture the arrow reaches less far out, so it stays in view.
    const nearEdge = { ...geo, kneeImgX: dial.out > 0 ? 0.9 : 0.1, ankleImgX: dial.out > 0 ? 0.9 : 0.1 };
    const short = kneeGuide(nearEdge, dial, ASPECT)!;
    for (const p of [short.lift.start, short.lift.control, short.lift.end]) { expect(p.x).toBeGreaterThanOrEqual(0.03); expect(p.x).toBeLessThanOrEqual(0.97); }
  });
  it("sets a modest practice goal from the resting knee", () => {
    expect(kneePracticeGoal(90)).toBe(118);
    expect(kneePracticeGoal(150)).toBe(165);
    expect(kneePracticeGoal(100)).toBeGreaterThan(100 + 15 - 1e-9);
  });
});

describe("the knee's checks from camera landmarks", () => {
  const reference = (side: Side) => kneeFrame({ pose: kneeBody(side) }, side, 0, ASPECT, null).geo!;
  const comps = (side: Side, posture: Posture) => kneeFrame({ pose: kneeBody(side, posture) }, side, 0, ASPECT, reference(side)).comps;
  const over = (side: Side, posture: Posture) => EXERCISES[ID].compensations.filter(item => compensationStatus(comps(side, posture), item).over).map(item => item.id);
  it.each(SIDES)("a clean straightening trips no check, all the way to straight (%s side)", side => {
    for (const knee of [90, 125, 150, 178]) expect(over(side, { knee })).toEqual([]);
    // Every check is measurable with the body in view.
    const measured = comps(side, { knee: 140 });
    for (const item of EXERCISES[ID].compensations) expect(measured[item.metric], item.id).toBeDefined();
  });
  it.each([
    ["trunk_lean", { lean: -14 }],
    ["trunk_forward", { lean: 14 }],
    ["trunk_side_lean", { sideLean: 11 }],
    ["hip_hike", { hipHike: 0.05 }],
    ["thigh_lift", { thighLift: 15 }],
    ["other_leg", { otherKnee: 120 }],
    ["other_leg", { otherFoot: [0.08, 0.1, 0.05] as P3 }],
  ] as const)("flags %s (%j) and nothing else, on both sides", (id, posture) => {
    for (const side of SIDES) expect(over(side, { knee: 130, ...posture }), side).toEqual([id]);
  });
  it.each([
    ["trunk_lean", { lean: -4 }],
    ["trunk_forward", { lean: 4 }],
    ["trunk_side_lean", { sideLean: 3 }],
    ["hip_hike", { hipHike: 0.01 }],
    ["thigh_lift", { thighLift: 4 }],
    ["other_leg", { otherKnee: 100 }],
  ] as const)("lets a small %s pass (%j)", (_id, posture) => {
    for (const side of SIDES) expect(over(side, { knee: 130, ...posture }), side).toEqual([]);
  });
  it("leaves a check unmeasured when its body part is out of view, and the knee when the leg is", () => {
    const pose = kneeBody("right", { knee: 130 });
    const hidden = { ...pose, landmarks: pose.landmarks.map((p, index) => (index <= 12 ? { ...p, visibility: 0.1 } : p)) };
    const frame = kneeFrame({ pose: hidden }, "right", 0, ASPECT, reference("right"));
    expect(frame.comps.trunk_retreat_pct).toBeUndefined();
    expect(frame.comps.trunk_side_lean_delta).toBeUndefined();
    expect(frame.visible).toBe(true);
    const noLeg = { ...pose, landmarks: pose.landmarks.map((p, index) => (index === poseJoints("right").ankle ? { ...p, visibility: 0.1 } : p)) };
    const lost = kneeFrame({ pose: noLeg }, "right", 0, ASPECT, reference("right"));
    expect(lost.visible).toBe(false);
    expect(lost.values.knee_extension).toBeUndefined();
    expect(lost.missing).toBe("Keep your knees and feet in view of the camera.");
  });
});

describe("the knee's targets", () => {
  const foot = { x: 0.45, y: 0.73, bodyScale: 0.24 };
  const base = { rest: 90, goal: 120, lowering: false, aspect: ASPECT, armed: true, practice: false, t: 0 };
  it("is on the straighten target at the goal, and stays on it until the knee sags a few degrees", () => {
    const target = new KneeTarget();
    expect(target.update("a", { ...base, value: 119 }).contact).toBe(false);
    expect(target.update("a", { ...base, value: 120 }).contact).toBe(true);
    expect(target.update("a", { ...base, value: 120 - KNEE_HYSTERESIS_DEG + 0.5 }).contact).toBe(true);
    expect(target.update("a", { ...base, value: 120 - KNEE_HYSTERESIS_DEG - 0.5 }).contact).toBe(false);
    expect(target.update("a", { ...base, value: 118 }).contact).toBe(false);
    expect(target.update("a", { ...base, value: 105 }).progress).toBeCloseTo(0.5);
    expect(target.update("a", { ...base, value: undefined }).contact).toBe(false);
  });
  it("is on the lower target with the foot back where it rested, or down with the knee most of the way back", () => {
    const target = new KneeTarget(), lowering = { ...base, lowering: true, restFoot: foot };
    expect(target.update("b", { ...lowering, value: 118, ankle: { x: 0.45, y: 0.66 } }).contact).toBe(false);
    expect(target.update("b", { ...lowering, value: 93, ankle: { x: 0.45, y: 0.73 } }).contact).toBe(true);
    // The foot back on the floor a little forward of where it rested, the knee nearly back.
    expect(target.update("c", { ...lowering, value: 97, ankle: { x: 0.45 + 0.12 / ASPECT, y: 0.74 } }).contact).toBe(true);
    // The knee back but the foot held up (the thigh lifted): not down.
    expect(target.update("d", { ...lowering, value: 92, ankle: { x: 0.45, y: 0.6 } }).contact).toBe(false);
  });
  it.each(SIDES)("needs the knee back down for the lower target, though from the front the foot hardly moves in the picture (%s side)", side => {
    const j = poseJoints(side), foot = kneeRestCheck(kneeBody(side), side, ASPECT).lapRest!;
    const target = new KneeTarget();
    const lower = (knee: number, t = 0) => target.update(`lower-${side}`, { ...base, lowering: true, restFoot: foot, value: knee, ankle: at(kneeBody(side, { knee }), j.ankle), t });
    for (const knee of [126, 118, 108]) expect(lower(knee).contact, String(knee)).toBe(false);
    expect(lower(95).contact).toBe(true);
    // A 3D angle that settles a little high: after a while lowering, the foot back where it rested is enough.
    const drifted = new KneeTarget();
    const late = (t: number) => drifted.update("late", { ...base, lowering: true, restFoot: foot, value: 108, ankle: at(kneeBody(side), j.ankle), t });
    expect(late(0).contact).toBe(false);
    expect(late(10500).contact).toBe(true);
  });
  it("brings a practice goal closer when it is not reached for a while", () => {
    const target = new KneeTarget(), practice = { ...base, practice: true, goal: 118 };
    expect(target.update("p", { ...practice, value: 101, t: 0 }).contact).toBe(false);
    expect(target.update("p", { ...practice, value: 101, t: KNEE_EASE_MS - 10 }).contact).toBe(false);
    const eased = target.update("p", { ...practice, value: 101, t: KNEE_EASE_MS + 10 });
    expect(eased).toMatchObject({ contact: true, eased: true, goal: 90 + KNEE_EASED_DEG });
    // Touched once, then never held: it eases 12 s after the knee last left the target.
    const touched = new KneeTarget();
    expect(touched.update("q", { ...practice, value: 119, t: 0 }).contact).toBe(true);
    expect(touched.update("q", { ...practice, value: 110, t: 50 }).contact).toBe(false);
    expect(touched.update("q", { ...practice, value: 110, t: KNEE_EASE_MS - 100 }).eased).toBe(false);
    expect(touched.update("q", { ...practice, value: 110, t: KNEE_EASE_MS + 100 })).toMatchObject({ contact: true, eased: true });
    // A scored lift never eases.
    const scored = new KneeTarget();
    expect(scored.update("s", { ...base, value: 101, t: 0 }).contact).toBe(false);
    expect(scored.update("s", { ...base, value: 101, t: KNEE_EASE_MS * 2 }).contact).toBe(false);
  });
});

describe("Seated Knee Extension demonstration, simulator and previews", () => {
  it.each([false, true])("has the reach demonstration's states and fields (returning=%s)", returning => {
    expect(Object.keys(kneeDemoState(0, returning, false)).sort()).toEqual(Object.keys(reachDemoState(0, returning, false)).sort());
    expect(kneeDemoState(0, returning, false).instruction).toBe(reachDemoState(0, returning, false).instruction);
    expect(kneeDemoState(0, returning).phase).toBe("move");
    expect(kneeDemoState(kneeDemoDuration(returning) - 1, returning).phase).toBe("complete");
    expect(kneeGhostTarget(300, 270, returning).radius).toBeGreaterThan(0);
    expect(kneeGhostContact(returning ? 0 : 1, returning)).toBe(true);
    expect(kneeGhostContact(0.5, returning)).toBe(false);
  });
  it("shows the circle on the demonstration's knee dial beside the shoulder, on the affected side, not at the foot", () => {
    const right = kneeGhostTarget(300, 270, false, "right"), left = kneeGhostTarget(300, 270, false, "left");
    // Mirrored for the other side, up by the shoulder (the figure's feet are near the bottom).
    expect(left.x).toBeCloseTo(300 - right.x);
    expect(right.x).toBeGreaterThan(200);
    expect(right.y).toBeLessThan(150);
    // The goal circle is out to the side of the resting one, which is below the dial's knee.
    const rest = kneeGhostTarget(300, 270, true, "right");
    expect(right.x).toBeGreaterThan(rest.x);
    expect(rest.y).toBeGreaterThan(right.y);
    // The circle is reached as the demonstration's dial foot gets there, before the hold.
    const at = kneeDemoState(kneeDemoDuration(false) - 1, false);
    expect(at.target[0]).toBeCloseTo(right.x);
  });
  it.each(SIDES)("draws the demonstration's arrow from by the resting foot, rising out on the affected side (%s side)", side => {
    const { ctx, calls, texts } = recordingContext();
    drawKneeScene(ctx, 300, 270, { progress: 0.5, lowering: false, side, arrow: true, armed: true, now: 0, reducedMotion: true });
    // Still (reduced motion): the whole arrow. The resting foot is at x 178 for a right leg, mirrored for a left, y 244.
    const curves = calls.filter(call => call.name === "quadraticCurveTo");
    expect(curves.length).toBeGreaterThan(0);
    const foot = side === "left" ? 122 : 178, out = side === "left" ? -1 : 1;
    for (const call of curves) {
      const [, , endX, endY] = call.args as number[];
      expect((endX - foot) * out).toBeGreaterThan(60);
      expect(endY).toBeLessThan(230);
    }
    expect(texts().some(text => text.text === "Toward the camera")).toBe(true);
    // Lowering: the same path back down.
    const lowering = recordingContext();
    drawKneeScene(lowering.ctx, 300, 270, { progress: 0.5, lowering: true, side, arrow: true, armed: true, now: 0, reducedMotion: true });
    const back = lowering.calls.find(call => call.name === "quadraticCurveTo")!.args as number[];
    expect((back[2] - foot) * out).toBeLessThan(40);
    expect(lowering.texts().some(text => text.text === "Foot down")).toBe(true);
  });
  it("draws the arrow itself along its path while the movement is asked for, the head at the line's tip", () => {
    const pose = kneeBody("right"), geo = kneeFrame({ pose }, "right", 0, ASPECT, null).geo!, dial = kneeDial(pose, "right", ASPECT)!;
    const guide = kneeGuide(geo, dial, ASPECT)!, end = { x: (1 - guide.lift.end.x) * 640, y: guide.lift.end.y * 480 };
    const lastPoint = (calls: { name: string; args: unknown[] }[]) => calls.filter(call => call.name === "lineTo" || call.name === "quadraticCurveTo").map(call => call.args.slice(-2) as number[]);
    // Part way through drawing: a line through points along the path, stopping short of the end.
    const drawing = recordingContext();
    drawKneeGuide(drawing.ctx, guide, 640, 480, { lowering: false, emphasis: true, now: 400, reducedMotion: false });
    expect(drawing.calls.some(call => call.name === "quadraticCurveTo")).toBe(false);
    const points = lastPoint(drawing.calls);
    const tipDistance = Math.min(...points.map(([x, y]) => Math.hypot(x - end.x, y - end.y)));
    expect(tipDistance).toBeGreaterThan(20);
    // Drawn: the whole arrow, to its end.
    const drawn = recordingContext();
    drawKneeGuide(drawn.ctx, guide, 640, 480, { lowering: false, emphasis: true, now: 1500, reducedMotion: false });
    const curve = drawn.calls.find(call => call.name === "quadraticCurveTo")!.args as number[];
    expect(Math.hypot(curve[2] - end.x, curve[3] - end.y)).toBeLessThan(1);
    // Not asked (faint) or motion reduced: whole and still.
    const still = recordingContext();
    drawKneeGuide(still.ctx, guide, 640, 480, { lowering: false, emphasis: false, now: 400, reducedMotion: false });
    expect(still.calls.some(call => call.name === "quadraticCurveTo")).toBe(true);
  });
  it.each(SIDES)("labels the camera view's arrow clear of the knee dial's practice hint (%s side)", side => {
    // The usual picture, and one with the knee low in it (the camera higher).
    for (const [width, height, camera] of [[640, 480, undefined], [1280, 720, undefined], [640, 480, { y: 0.3, z: 2.2 }]] as const) {
      const pose = kneeBody(side, camera ? { camera } : {}), geo = kneeFrame({ pose }, side, 0, ASPECT, null).geo!, dial = kneeDial(pose, side, ASPECT)!;
      const guide = kneeGuide(geo, dial, ASPECT)!;
      const { ctx, calls, texts } = recordingContext();
      drawKneeDial(ctx, dial, width, height, { progress: 0, lowering: false, armed: true, contact: false, hold: 0, label: "Straighten", now: 0, reducedMotion: true, hint: "Moves with your knee" });
      drawKneeGuide(ctx, guide, width, height, { lowering: false, emphasis: true, now: 0, reducedMotion: true });
      expect(calls.some(call => call.name === "quadraticCurveTo")).toBe(true);
      const hint = texts().find(text => text.text === "Moves with your knee")!, label = texts().find(text => /toward the camera/i.test(text.text))!;
      // Not printed over the hint: well apart in height, or side by side.
      const fontPx = Math.max(14, Math.round(height / 30)), apart = Math.abs(label.y - hint.y) > fontPx * 1.2;
      const halfLabel = label.text.length * 0.6 * fontPx / 2, halfHint = hint.text.length * 0.6 * Math.max(13, Math.round(height / 34)) / 2;
      expect(apart || Math.abs(label.x - hint.x) > halfLabel + halfHint, `${width}x${height}`).toBe(true);
    }
  });
  it.each(SIDES)("fits the camera view's arrow label inside a portrait picture (%s side)", side => {
    const portrait = 3 / 4, pose = kneeBody(side), geo = kneeFrame({ pose }, side, 0, portrait, null).geo!, dial = kneeDial(pose, side, portrait);
    // A portrait picture may leave no room for the dial; the arrow is drawn from the dial's side regardless.
    const guide = kneeGuide(geo, dial ?? { pivot: { x: 0.5, y: 0.3 }, radius: 0.1, out: side === "left" ? 1 : -1 }, portrait)!;
    const { ctx, texts } = recordingContext();
    drawKneeGuide(ctx, guide, 480, 640, { lowering: false, emphasis: true, now: 0, reducedMotion: true });
    const label = texts().find(text => /toward the camera/i.test(text.text))!;
    const fontPx = Number(/(\d+)px/.exec(String((ctx as unknown as { font: string }).font))?.[1] ?? 14), half = label.text.length * 0.6 * fontPx / 2;
    expect(label.x - half).toBeGreaterThanOrEqual(0);
    expect(label.x + half).toBeLessThanOrEqual(480);
  });
  it("leaves the toe lift's arrows as they were: whole, with the moving glow, not drawing themselves", () => {
    const { ctx, calls } = recordingContext();
    drawToeScene(ctx, 300, 270, { progress: 0.5, lowering: false, side: "right", arrow: true, armed: true, now: 400, reducedMotion: false });
    expect(calls.some(call => call.name === "quadraticCurveTo")).toBe(true);
    expect(calls.some(call => call.name === "setLineDash")).toBe(true);
  });
  it("previews its two steps, the set-up checks with the lighting, and the results", () => {
    expect(exerciseScreenPreview("warm-reach", 1, "right", ID).snapshot).toMatchObject({ kind: "reach", stepIndex: 0, stepCount: 2 });
    expect(exerciseScreenPreview("reps-return", 1, "right", ID).snapshot).toMatchObject({ kind: "return", stepIndex: 1 });
    expect(exerciseScreenPreview("setup", 1, "right", ID).bodyChecks.map(check => check.label)).toEqual(["Face", "Both shoulders", "Both hips", "Both knees", "Both feet", "Feet flat, space around you", "Lighting", "Clothes stand out from the background"]);
    const results = exerciseScreenPreview("results", 1, "right", ID).snapshot.record!;
    expect(results.compensation_counts).toEqual({ trunk_lean: 2, trunk_forward: 1 });
    expect(results.best_label).toBe("knee straightening");
  });
  it("the no-camera simulator completes every step", () => {
    const session = new ExerciseSession({ exerciseId: ID, rung: 1, side: "right", repsOverride: 1, reviewBetweenReps: true }, { say() {}, busy: () => false, stop() {} });
    session.start(0);
    for (let t = 50; t < 200000 && session.snapshot().phase !== "done"; t += 50) {
      const snap = session.snapshot(), live = snap.phase === "warm" || snap.phase === "reps";
      const level = live && snap.targetArmed && snap.kind === "reach" ? 1 : 0;
      session.push({ ...simFrame(t, session.cfg, session.targets(), { level, compensations: [] }), ...(live ? { targetContact: kneeGhostContact(level, snap.kind === "return") } : {}) });
    }
    expect(session.snapshot().record?.repetition_scores).toEqual([100]);
  });
});

// ---------- a whole session from simulated camera landmarks, as the page drives it ----------

/** A patient who straightens the knee (at `speed` degrees a second) once the circle is active, then lowers it once the foot circle is. */
/** options.always: a posture kept through the whole of the scored repetitions; repLift: how far the scored lifts go. */
function kneePatient(side: Side, scored: (knee: number) => Posture = () => ({}), options: { reps?: number; lift?: number; repLift?: number; fastReps?: boolean; always?: Posture } = {}) {
  const said: string[] = [];
  const session = new ExerciseSession({ exerciseId: ID, rung: 1, side, repsOverride: options.reps ?? 2, reviewBetweenReps: true }, { say: text => said.push(text), busy: () => false, stop() {} });
  const target = new KneeTarget();
  let t = 0, knee = 90;
  session.start(t);
  for (let n = 0; n < 20000 && session.snapshot().phase !== "done"; n++) {
    t += 50;
    const snap: Snapshot = session.snapshot();
    const live = (snap.phase === "warm" || snap.phase === "reps") && !snap.review;
    const lift = snap.phase === "reps" ? options.repLift ?? options.lift ?? 130 : options.lift ?? 130;
    const want = live && snap.targetArmed ? (snap.kind === "return" ? 90 : lift) : knee;
    const speed = options.fastReps && snap.phase === "reps" ? 500 : 60;
    knee += Math.sign(want - knee) * Math.min(Math.abs(want - knee), speed * 0.05);
    const extra = { ...(snap.phase === "reps" ? options.always : {}), ...(live && snap.phase === "reps" && snap.kind === "reach" ? scored(knee) : {}) };
    const pose = kneeBody(side, { knee, ...extra });
    const frame = kneeFrame({ pose }, side, t, ASPECT, session.reference);
    if (live) {
      const rest = session.restValues().knee_extension;
      const goal = snap.phase === "reps" ? session.targets().knee_extension : kneePracticeGoal(rest);
      const result = target.update(`${snap.phase}:${snap.repIndex}:${snap.stepIndex}`, {
        value: frame.values.knee_extension, rest, goal, lowering: snap.kind === "return", ankle: pose.landmarks[poseJoints(side).ankle],
        restFoot: session.lapPoint, aspect: ASPECT, armed: snap.targetArmed, practice: snap.phase === "warm", t,
      });
      frame.targetContact = frame.visible && result.contact;
      frame.targetProgress = frame.targetContact ? 1 : Math.max(0, Math.min(0.98, result.progress));
    }
    session.push(frame);
  }
  return { session, said };
}

describe("Seated Knee Extension session from camera landmarks", () => {
  it.each(SIDES)("a clean repetition scores 100 with every check measured (%s side)", side => {
    const { session, said } = kneePatient(side);
    const snap = session.snapshot();
    expect(snap.phase).toBe("done");
    expect(snap.record?.repetition_scores).toEqual([100, 100]);
    expect(snap.reps.every(rep => !rep.compensations.length && !rep.unmeasured?.length)).toBe(true);
    // The rest learned at set-up, and the scored goal just inside the practice hold (rest + 0.9 x the straightening).
    expect(session.restValues().knee_extension).toBeCloseTo(90, 0);
    expect(session.learnedValue("knee_extension")!).toBeCloseTo(90 + 0.9 * 40, 0);
    // The full instructions once in practice, the short cues in each scored repetition, and no "slowly" reminder.
    const [lift, lower] = EXERCISES[ID].cycle;
    expect(said.filter(line => line === lift.voice)).toHaveLength(1);
    for (const step of [lift, lower]) expect(said.filter(line => line === step.cue)).toHaveLength(2);
    expect(said).not.toContain(EXERCISES[ID].speedCue!.lift);
  });
  it.each([
    ["trunk_lean", { lean: -14 }],
    ["trunk_forward", { lean: 14 }],
    ["trunk_side_lean", { sideLean: 11 }],
    ["hip_hike", { hipHike: 0.05 }],
    ["thigh_lift", { thighLift: 15 }],
    // Mirror movement: the other knee straightens along with the affected one.
    ["other_leg", (knee: number) => ({ otherKnee: 90 + 0.9 * (knee - 90) })],
  ] as const)("flags %s in each scored repetition", (id, posture) => {
    for (const side of SIDES) {
      const reps = kneePatient(side, knee => (typeof posture === "function" ? posture(knee) : posture)).session.snapshot().reps;
      for (const rep of reps) expect(rep.compensations, side).toEqual([id]);
    }
  });
  it("does not count the other foot moved between repetitions as the other leg helping", () => {
    // The other foot set down further out after the practice, and kept still through each straightening.
    const { session } = kneePatient("right", () => ({}), { always: { otherFoot: [0.1, 0, 0.08] } });
    expect(session.snapshot().reps.map(rep => rep.compensations)).toEqual([[], []]);
    expect(session.snapshot().record?.repetition_scores).toEqual([100, 100]);
  });
  it("leaves the posture checks unjudged, not unmeasured, when the knee hardly straightens", () => {
    // Practice learns 130; in the scored repetition the knee only reaches 96 and never holds the circle.
    const { session } = kneePatient("right", () => ({}), { reps: 1, repLift: 96 });
    const rep = session.snapshot().reps[0];
    expect(rep).toMatchObject({ hold: "none", score: 0, unmeasured: [] });
  });
  it("reminds a patient who kicks the foot up or drops it to go slowly, without changing the score", () => {
    const { session, said } = kneePatient("right", () => ({}), { fastReps: true });
    const cue = EXERCISES[ID].speedCue!;
    expect(said.filter(line => line === cue.lift)).toHaveLength(2);
    expect(said.filter(line => line === cue.lower)).toHaveLength(2);
    expect(session.snapshot().record?.repetition_scores).toEqual([100, 100]);
  });
});
