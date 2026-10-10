import { describe, expect, it } from "vitest";
import { EXERCISES, usesSeatedTargets, usesTargetFlow, type Side } from "./config";
import { exerciseScreenPreview } from "./screen-preview";
import { ExerciseSession, simFrame, type Snapshot } from "./session";
import { handZone, palmGeo, simulatedHand } from "./hand-target";
import { poseJoints, type Geo, type HandInput, type PoseInput, type Pt } from "./metrics";
import { seatedPose, type SeatedPosture } from "./mouth-target";
import { reachDemoState } from "./reach-demo";
import {
  closureOf, fingerReach, gapOf, imageGap, massFlexion, otherHandNear, pegsDropped, pinchCircle, pinchDemoDuration, pinchDemoState, pinchFrame,
  pinchGap, pinchGeo, pinchGhostContact, pinchGhostPoints, pinchGhostTarget, pinchHand, pinchPracticeGoal, pinchRest, PinchTarget, releaseClosure,
  startGap, tipAlong, TOUCH_CLOSURE, PINCH_EASE_MS, type PinchGeo,
} from "./pinch-target";

const ASPECT = 4 / 3;
const SIDES: Side[] = ["left", "right"];

// ---------- a simulated hand pinching, palm to the camera in the shaded area ----------

const placeAt = (x: number, y: number, z = 0.9): [number, number, number] => [(x - 0.5) * z / 0.75, (y - 0.5) * z + 0.065, z];
const zoneFor = (side: Side) => handZone(seatedPose(side), side, ASPECT)!;
const inZone = (side: Side) => { const zone = zoneFor(side); return placeAt((zone.x0 + zone.x1) / 2, (zone.y0 + zone.y1) / 2); };

export type Shape = {
  /** 0 the thumb apart, 1 tip to tip with the finger. */
  close?: number;
  finger?: number;
  /** The thumb pressed on the side of the finger (between its middle joints) instead of its tip. */
  key?: boolean;
  /** The middle, ring and little fingers curled in toward the palm (0-1). */
  curl?: number;
  wristFlexDeg?: number;
  forearmTurnDeg?: number;
};

const lerp = (a: Pt, b: { x: number; y: number; z: number }, k: number): Pt => ({ ...a, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
const mean = (points: Pt[]) => ({ x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length, z: points.reduce((s, p) => s + p.z, 0) / points.length });

/** The simulated hand with its thumb closing on a finger (in both its image and 3D landmarks). */
export function pinchingHand(side: Side, shape: Shape = {}, at = inZone(side)): HandInput {
  const base = simulatedHand({ side, open: 0.55, at, wristFlexDeg: shape.wristFlexDeg, forearmTurnDeg: shape.forearmTurnDeg });
  const tip = shape.finger === 1 ? 12 : 8, k = shape.close ?? 0, curl = shape.curl ?? 0;
  const shape3 = (points: Pt[]) => {
    const out = points.map(p => ({ ...p }));
    const target = shape.key ? mean([points[6], points[7]]) : points[tip];
    out[4] = lerp(points[4], target, k);
    out[3] = lerp(points[3], target, 0.6 * k);
    out[2] = lerp(points[2], target, 0.25 * k);
    if (curl) {
      const centre = mean([0, 5, 9, 13, 17].map(index => points[index]));
      for (const [dip, end] of [[11, 12], [15, 16], [19, 20]]) { out[end] = lerp(points[end], centre, curl); out[dip] = lerp(points[dip], centre, 0.6 * curl); }
    }
    return out;
  };
  return { landmarks: shape3(base.landmarks), world: shape3(base.world) };
}

const relaxedRef = (side: Side, shape: Shape = {}): Geo => pinchGeo(pinchingHand(side, shape)) as Geo;

/** The body with its affected wrist where the raised hand's wrist is, as the pose model sees it. */
export function withWrist(pose: PoseInput, side: Side, hand: HandInput): PoseInput {
  const index = poseJoints(side).wrist;
  return { ...pose, landmarks: pose.landmarks.map((p, i) => (i === index ? { ...p, x: hand.landmarks[0].x, y: hand.landmarks[0].y } : p)) };
}

describe("Pinch and Peg measures", () => {
  it.each(SIDES)("measures the thumb closing on each finger in 3D, from apart to tip to tip (%s hand)", side => {
    for (const finger of [0, 1]) {
      const gaps = [0, 0.5, 0.8, 1].map(close => pinchGap(pinchingHand(side, { finger, close }), finger)!);
      expect(gaps[0]).toBeGreaterThan(0.35);
      for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]);
      expect(gaps[3]).toBeLessThan(0.05);
      expect(closureOf(gaps[3])).toBeGreaterThan(TOUCH_CLOSURE);
      // The thumb ends at the far end of the finger.
      expect(tipAlong(pinchingHand(side, { finger, close: 1 }), finger)!).toBeGreaterThan(0.95);
    }
    // The same pinch with the wrist bent or the palm turned reads the same in 3D.
    const straight = pinchGap(pinchingHand(side, { close: 0.6 }), 0)!;
    for (const turn of [{ wristFlexDeg: 30 }, { forearmTurnDeg: 30 }]) expect(pinchGap(pinchingHand(side, { close: 0.6, ...turn }), 0)!).toBeCloseTo(straight, 2);
    expect(closureOf(gapOf(60))).toBeCloseTo(60);
  });
  it.each(SIDES)("tells a key pinch on the side of the finger from tip to tip (%s hand)", side => {
    expect(tipAlong(pinchingHand(side, { key: true, close: 1 }), 0)!).toBeLessThan(0.75);
    // The picture agrees with the 3D gap for a pinch made palm to the camera.
    expect(imageGap(pinchingHand(side, { close: 1 }), 0, ASPECT)!).toBeLessThan(0.1);
  });
  it.each(SIDES)("measures the other fingers curling in, against how far they reached at set-up (%s hand)", side => {
    const ref = relaxedRef(side) as PinchGeo;
    expect(massFlexion(pinchingHand(side, { close: 1 }), ref)).toBe(0);
    expect(massFlexion(pinchingHand(side, { close: 1, curl: 0.8 }), ref)!).toBeGreaterThan(25);
    expect(fingerReach(pinchingHand(side, { curl: 0.8 }), 16)!).toBeLessThan(fingerReach(pinchingHand(side), 16)!);
    // A hand that rested with those fingers already curled cannot be judged.
    expect(massFlexion(pinchingHand(side, { curl: 0.9 }), relaxedRef(side, { curl: 0.9 }) as PinchGeo)).toBeUndefined();
    expect(massFlexion(pinchingHand(side), null)).toBeUndefined();
  });
  it.each(SIDES)("finds the other hand coming over to help, and never takes it for the affected hand (%s side)", side => {
    const mine = pinchingHand(side, { close: 0.5 });
    const pose = withWrist(seatedPose(side), side, mine);
    // The other hand resting on the lap is far away; brought up beside the affected hand, it is near.
    expect(otherHandNear({ pose, hands: [mine] }, mine, side, ASPECT)!).toBeLessThan(0.5);
    const zone = zoneFor(side);
    const other: Side = side === "right" ? "left" : "right";
    const helper = simulatedHand({ side: other, at: placeAt((zone.x0 + zone.x1) / 2 + (side === "right" ? 1 : -1) * 0.02, (zone.y0 + zone.y1) / 2 + 0.06) });
    expect(otherHandNear({ pose, hands: [mine, helper] }, mine, side, ASPECT)!).toBeGreaterThan(1);
    expect(pinchHand({ pose, hands: [helper, mine] }, side)).toBe(mine);
    expect(otherHandNear({ pose: null, hands: [mine] }, mine, side, ASPECT)).toBe(0);
  });
});

describe("Pinch and Peg set-up and readiness", () => {
  it.each(SIDES)("learns a relaxed hand in the shaded area with the thumb resting away from the finger (%s hand)", side => {
    const zone = zoneFor(side);
    const rest = pinchRest(pinchingHand(side), ASPECT, side, true, zone);
    expect(rest.lapRest, rest.lapMissing).toBeDefined();
    expect(pinchRest(pinchingHand(side, { close: 0.9 }), ASPECT, side, true, zone).lapMissing).toBe("Open your fingers and thumb, so your thumb is away from your first finger.");
    expect(pinchRest(pinchingHand(side, { forearmTurnDeg: 180 }), ASPECT, side, true, zone).lapMissing).toBe("Turn your palm to face the camera.");
    expect(pinchRest(pinchingHand(side), ASPECT, side, false, zone).lapMissing).toBe("Keep your face and both shoulders in view.");
  });
  it.each(SIDES)("starts each pinch with the thumb apart, palm to the camera in the shaded area (%s hand)", side => {
    const zone = zoneFor(side), pose = seatedPose(side);
    const frame = (shape: Shape, ref: Geo | null = null) => pinchFrame({ pose, hands: [pinchingHand(side, shape)] }, side, 0, ASPECT, ref, { zone, startGap: startGap(closureOf(pinchGap(pinchingHand(side), 0)!)) });
    expect(frame({})).toMatchObject({ ready: true, placed: true, visible: true });
    expect(frame({ close: 0.8 })).toMatchObject({ ready: false, readyAlmost: true, readyHint: "Open your fingers and thumb." });
    const away = pinchFrame({ pose, hands: [pinchingHand(side, {}, placeAt(0.5, 0.85))] }, side, 0, ASPECT, null, { zone });
    expect(away.ready).toBe(false);
  });
});

describe("Pinch and Peg frame and checks", () => {
  it.each(SIDES)("reads both fingers' closure and the checks against the set-up hand (%s hand)", side => {
    const zone = zoneFor(side);
    const setup = pinchFrame({ pose: seatedPose(side), hands: [pinchingHand(side)] }, side, 0, ASPECT, null, { zone });
    const ref = setup.geo!;
    const at = (shape: Shape, posture: SeatedPosture = {}) => pinchFrame({ pose: seatedPose(side, posture), hands: [pinchingHand(side, shape)] }, side, 0, ASPECT, ref, { zone });
    const clean = at({ close: 1 });
    expect(clean.values.pinch_index!).toBeGreaterThan(TOUCH_CLOSURE);
    expect(clean.values.pinch_middle!).toBeLessThan(clean.values.pinch_index!);
    expect(clean.comps).toMatchObject({ wrist_flexion_deg: expect.any(Number), forearm_turn_deg: expect.any(Number), trunk_approach_pct: expect.any(Number), shoulder_hike_rel_delta: expect.any(Number), other_hand_near: expect.any(Number), mass_flexion_pct: 0 });
    expect(clean.comps.wrist_flexion_deg!).toBeLessThan(5);
    expect(at({ close: 1, wristFlexDeg: 30 }).comps.wrist_flexion_deg!).toBeGreaterThan(18);
    expect(at({ close: 1, forearmTurnDeg: 40 }).comps.forearm_turn_deg!).toBeGreaterThan(25);
    expect(at({ close: 1 }, { trunkLeanDeg: 12 }).comps.trunk_approach_pct!).toBeGreaterThan(6);
    expect(at({ close: 1, curl: 0.8 }).comps.mass_flexion_pct!).toBeGreaterThan(25);
    expect(pegsDropped(0)).toBe(0); expect(pegsDropped(2)).toBe(1); expect(pegsDropped(3)).toBe(1);
  });
});

describe("Pinch and Peg targets", () => {
  const base = { rest: 30, goal: TOUCH_CLOSURE, letGo: false, armed: true, practice: false, t: 0, along: 1, imageGap: 0.05 };
  it("is on the pinch target tip to tip at the goal, and stays on it until the thumb opens a little", () => {
    const target = new PinchTarget();
    expect(target.update("a", { ...base, closure: 70 }).contact).toBe(false);
    expect(target.update("a", { ...base, closure: 80 }).contact).toBe(true);
    expect(target.update("a", { ...base, closure: 68 }).contact).toBe(true);
    expect(target.update("a", { ...base, closure: 60 }).contact).toBe(false);
    // A key pinch on the side of the finger, or a picture showing the tips apart, is not tip to tip.
    expect(new PinchTarget().update("b", { ...base, closure: 90, along: 0.6 }).contact).toBe(false);
    expect(new PinchTarget().update("c", { ...base, closure: 90, imageGap: 0.8 }).contact).toBe(false);
    expect(new PinchTarget().update("d", { ...base, closure: undefined }).contact).toBe(false);
    expect(new PinchTarget().update("e", { ...base, closure: 52.5 }).progress).toBeCloseTo(0.5);
  });
  it("is on the let-go target once the thumb opens back most of the way", () => {
    const target = new PinchTarget(), letGo = { ...base, letGo: true };
    const release = releaseClosure(TOUCH_CLOSURE, 30);
    expect(release).toBeCloseTo(48);
    expect(target.update("l", { ...letGo, closure: 70 }).contact).toBe(false);
    expect(target.update("l", { ...letGo, closure: 45 }).contact).toBe(true);
    expect(target.update("l", { ...letGo, closure: 51 }).contact).toBe(true);
    expect(target.update("l", { ...letGo, closure: 60 }).contact).toBe(false);
  });
  it("sets a practice goal part of the way to touching, and brings it closer when it is not reached", () => {
    expect(pinchPracticeGoal(30)).toBeCloseTo(52.5);
    expect(pinchPracticeGoal(80)).toBe(TOUCH_CLOSURE);
    const target = new PinchTarget(), practice = { ...base, practice: true, goal: pinchPracticeGoal(30) };
    expect(target.update("p", { ...practice, closure: 45, t: 0 }).contact).toBe(false);
    expect(target.update("p", { ...practice, closure: 45, t: PINCH_EASE_MS + 10 })).toMatchObject({ contact: true, eased: true });
    // A brief touch before the circle is active does not stop the easing; the wait runs from the last real contact.
    const early = new PinchTarget();
    expect(early.update("q", { ...practice, closure: 60, armed: false, t: 0 }).contact).toBe(true);
    early.update("q", { ...practice, closure: 45, t: 100 });
    expect(early.update("q", { ...practice, closure: 45, t: 100 + PINCH_EASE_MS + 10 }).eased).toBe(true);
    // Short of touching, the thumb only has to close: it is not yet at either fingertip.
    expect(new PinchTarget().update("r", { ...practice, closure: 55, along: 0.4, rival: 70 }).contact).toBe(true);
    // A scored pinch never eases.
    const scored = new PinchTarget();
    expect(scored.update("s", { ...base, closure: 45, t: 0 }).contact).toBe(false);
    expect(scored.update("s", { ...base, closure: 45, t: PINCH_EASE_MS * 2 }).contact).toBe(false);
  });
  it.each(SIDES)("draws the circle round the thumb tip and the fingertip, big enough for both at the goal (%s hand)", side => {
    const hand = pinchingHand(side, { close: 0.4 });
    const circle = pinchCircle(hand, 0, ASPECT, TOUCH_CLOSURE)!;
    const wide = pinchCircle(hand, 0, ASPECT, 40)!;
    expect(wide.radius).toBeGreaterThan(circle.radius);
    expect(circle.x).toBeCloseTo((hand.landmarks[4].x + hand.landmarks[8].x) / 2);
  });
});

describe("Pinch and Peg demonstration and simulator", () => {
  const steps = [{ finger: 0, letGo: false, index: 0 }, { finger: 0, letGo: true, index: 1 }, { finger: 1, letGo: false, index: 2 }, { finger: 1, letGo: true, index: 3 }];
  it.each(steps)("has the reach demonstration's states and fields (%j)", step => {
    expect(Object.keys(pinchDemoState(0, step, false)).sort()).toEqual(Object.keys(reachDemoState(0, false, false)).sort());
    expect(pinchDemoState(0, step, false).instruction).toBe(reachDemoState(0, false, false).instruction);
    expect(pinchDemoState(0, step).phase).toBe("move");
    expect(pinchDemoState(pinchDemoDuration(step.letGo) - 1, step).phase).toBe("complete");
    expect(pinchGhostTarget(300, 270, step).radius).toBeGreaterThan(0);
    expect(pinchGhostContact(step.letGo ? 0 : 1, step.letGo)).toBe(true);
    expect(pinchGhostContact(0.5, step.letGo)).toBe(false);
  });
  it("closes the ghost's thumb on the right fingertip", () => {
    for (const finger of [0, 1]) {
      const points = pinchGhostPoints(finger, 1), tip = points[finger === 1 ? 12 : 8];
      expect(Math.hypot(points[4][0] - tip[0], points[4][1] - tip[1])).toBeLessThan(10);
    }
  });
});

describe("Pinch and Peg on the shared target flow", () => {
  it("runs on the target flow with the approved checks, keeping Alira's level planning as it is", () => {
    expect(usesTargetFlow("ex_pinch")).toBe(true);
    expect(usesSeatedTargets("ex_pinch")).toBe(false);
    expect(EXERCISES.ex_pinch.compensations.map(item => item.id)).toEqual(["trunk_forward", "shoulder_hike", "forearm_turn", "other_hand", "wrist_bend", "mass_flexion"]);
    expect(EXERCISES.ex_pinch.cycle.map(step => [step.kind, step.finger])).toEqual([["reach", 0], ["return", undefined], ["reach", 1], ["return", undefined]]);
    expect(EXERCISES.ex_pinch.tracking).toBe("pose+hand");
  });
  it("previews its steps, the set-up checks with the lighting, and the results", () => {
    expect(exerciseScreenPreview("warm-reach", 1, "right", "ex_pinch").snapshot).toMatchObject({ kind: "reach", stepIndex: 0, stepCount: 4 });
    expect(exerciseScreenPreview("warm-waiting", 1, "right", "ex_pinch").snapshot.awaitingReady).toBe(true);
    expect(exerciseScreenPreview("setup", 1, "right", "ex_pinch").bodyChecks.map(check => check.label)).toEqual(["Face", "Right shoulder", "Other shoulder", "Right hand in the shaded area", "Palm to camera, fingers open", "Lighting"]);
    expect(exerciseScreenPreview("results", 1, "right", "ex_pinch").snapshot.record!.compensation_counts).toEqual({ trunk_forward: 2, shoulder_hike: 1 });
  });
  it("the no-camera simulator completes every step", () => {
    const session = new ExerciseSession({ exerciseId: "ex_pinch", rung: 1, side: "right", repsOverride: 1, reviewBetweenReps: true }, { say() {}, busy: () => false, stop() {} });
    session.start(0);
    for (let t = 50; t < 200000 && session.snapshot().phase !== "done"; t += 50) {
      const snap = session.snapshot(), live = snap.phase === "warm" || snap.phase === "reps";
      const level = live && snap.targetArmed && snap.kind === "reach" ? 1 : 0;
      session.push({ ...simFrame(t, session.cfg, session.targets(), { level, compensations: [] }), ...(live ? { targetContact: pinchGhostContact(level, snap.kind === "return") } : {}) });
    }
    expect(session.snapshot().record?.repetition_scores).toEqual([100]);
  });
});

// ---------- a whole session from simulated camera landmarks, as the page drives it ----------

type Act = { shape?: Shape; posture?: SeatedPosture; helper?: boolean };

/** A patient who pinches each finger once its circle is active, then lets go, from simulated pose and hand landmarks. */
function pinchPatient(side: Side, scored: (finger: number) => Act = () => ({}), reps = 2, options: { close?: (finger: number) => number; frames?: number } = {}) {
  const said: string[] = [];
  const session = new ExerciseSession({ exerciseId: "ex_pinch", rung: 1, side, repsOverride: reps, reviewBetweenReps: true }, { say: text => said.push(text), busy: () => false, stop() {} });
  const zone = zoneFor(side);
  const target = new PinchTarget();
  const other: Side = side === "right" ? "left" : "right";
  const helper = simulatedHand({ side: other, at: placeAt((zone.x0 + zone.x1) / 2 + (side === "right" ? 1 : -1) * 0.02, (zone.y0 + zone.y1) / 2 + 0.06) });
  let t = 0;
  session.start(t);
  for (let n = 0; n < (options.frames ?? 20000) && session.snapshot().phase !== "done"; n++) {
    t += 50;
    const snap: Snapshot = session.snapshot();
    const live = (snap.phase === "warm" || snap.phase === "reps") && !snap.review;
    const cycle = session.cfg.cycle, step = cycle[snap.stepIndex];
    const finger = step?.kind === "return" ? cycle[snap.stepIndex - 1]?.finger ?? 0 : step?.finger ?? 0;
    const closing = live && snap.targetArmed && step?.kind === "reach";
    const act = closing && snap.phase === "reps" ? scored(finger) : {};
    const hand = pinchingHand(side, { finger, close: closing ? options.close?.(finger) ?? 1 : 0, ...act.shape });
    const pose = withWrist(seatedPose(side, act.posture), side, hand);
    const restClosure = session.restValues().pinch_index;
    const frame = pinchFrame({ pose, hands: act.helper ? [hand, helper] : [hand] }, side, t, ASPECT, session.reference, Number.isFinite(restClosure) ? { zone, startGap: startGap(restClosure) } : { zone });
    if (live) {
      const metric = finger === 1 ? "pinch_middle" : "pinch_index", rival = finger === 1 ? "pinch_index" : "pinch_middle";
      const rest = session.restValues()[metric], learned = session.learnedValue(metric);
      const goal = snap.phase === "reps" ? Math.min(TOUCH_CLOSURE, session.targets()[metric]) : step?.kind === "return" && learned !== undefined ? learned : pinchPracticeGoal(rest);
      const result = target.update(`${snap.phase}:${snap.repIndex}:${snap.stepIndex}`, {
        closure: frame.values[metric], imageGap: imageGap(hand, finger, ASPECT), along: tipAlong(hand, finger), rival: frame.values[rival],
        rest, goal, letGo: step?.kind === "return", armed: snap.targetArmed, practice: snap.phase === "warm", t,
      });
      frame.targetContact = frame.visible && result.contact && (step?.kind === "return" || frame.placed !== false);
      frame.targetProgress = frame.targetContact ? 1 : Math.min(0.98, result.progress);
    }
    session.push(frame);
  }
  return { session, said };
}

describe("Pinch and Peg session from camera landmarks", () => {
  it.each(SIDES)("a clean repetition scores 100 with every check measured (%s hand)", side => {
    const { session, said } = pinchPatient(side);
    const snap = session.snapshot();
    expect(snap.phase).toBe("done");
    expect(snap.record?.repetition_scores).toEqual([100, 100]);
    expect(snap.reps.every(rep => !rep.compensations.length && !rep.unmeasured?.length)).toBe(true);
    // Touching in practice sets each finger's scored goal at touching.
    expect(session.learnedValue("pinch_index")).toBe(TOUCH_CLOSURE);
    expect(session.learnedValue("pinch_middle")).toBe(TOUCH_CLOSURE);
    // The full instructions once in practice; each scored repetition says only the short cues.
    const [first, letGo, second] = EXERCISES.ex_pinch.cycle;
    expect(said.filter(line => line === first.voice)).toHaveLength(1);
    expect(said.filter(line => line === first.cue)).toHaveLength(2);
    expect(said.filter(line => line === second.cue)).toHaveLength(2);
    // Twice per scored repetition, plus the demonstration's two "Let go." captions.
    expect(said.filter(line => line === letGo.cue)).toHaveLength(4 + 2);
    expect(snap.record?.wrap).toMatch(/pinch closure was \d+ percent/);
  });
  it.each(SIDES)("a pinch that only closes part of the way still finishes practice, and is scored on its own goal (%s hand)", side => {
    // About 60% closed on the first finger and 55% on the middle: never tip to tip, never past the other fingertip.
    const { session } = pinchPatient(side, () => ({}), 2, { close: finger => (finger === 0 ? 0.6 : 0.55) });
    const snap = session.snapshot();
    expect(snap.phase).toBe("done");
    expect(snap.record?.repetition_scores).toEqual([100, 100]);
    for (const metric of ["pinch_index", "pinch_middle"]) {
      expect(session.learnedValue(metric)!).toBeLessThan(TOUCH_CLOSURE);
      expect(session.learnedValue(metric)!).toBeGreaterThan(session.restValues()[metric]);
    }
  });
  it("practises again until both fingers' goals are learned, instead of scoring a finger on a default goal", () => {
    // The middle finger does not move at first; the session must not start the scored repetitions without its goal.
    let tries = 0;
    const { session, said } = pinchPatient("right", () => ({}), 1, { frames: 3000, close: finger => (finger === 1 ? (tries++ < 700 ? 0 : 1) : 1) });
    expect(said.filter(line => line.startsWith("Now one practice repetition"))).toHaveLength(2);
    expect(session.learnedValue("pinch_middle")).toBeDefined();
    expect(session.snapshot().phase).toBe("done");
  });
  it.each([
    ["trunk_forward", () => ({ posture: { trunkLeanDeg: 12 } })],
    ["shoulder_hike", () => ({ posture: { shoulderHikeM: 0.055 } })],
    ["forearm_turn", () => ({ shape: { forearmTurnDeg: 40 } })],
    ["other_hand", () => ({ helper: true })],
    ["wrist_bend", () => ({ shape: { wristFlexDeg: 30 } })],
    ["mass_flexion", (finger: number) => (finger === 0 ? { shape: { curl: 0.8 } } : {})],
  ] as const)("flags %s in each scored repetition", (id, scored) => {
    for (const side of SIDES) {
      const reps = pinchPatient(side, scored as (finger: number) => Act).session.snapshot().reps;
      for (const rep of reps) expect(rep.compensations, side).toEqual([id]);
    }
  });
});

void palmGeo;
