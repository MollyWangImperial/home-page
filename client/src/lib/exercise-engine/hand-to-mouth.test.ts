import { describe, expect, it } from "vitest";
import { EXERCISES, type Side } from "./config";
import { geoFrom, compensationStatus, headLeanMetrics, poseFrameValues, poseJoints, type Frame, type Geo, type PoseInput, type Pt } from "./metrics";
import { MouthCalibration, mouthContact, observedMouth, seatedPose, simulatedMouthComps, type SeatedPosture } from "./mouth-target";
import { mouthGhostPose } from "./ghost";
import { mouthDemoDuration, mouthDemoState, mouthGhostTarget } from "./mouth-demo";
import { reachDemoDuration, reachDemoState, reachGhostTarget } from "./reach-demo";
import { ExerciseSession, simFrame, type Voice } from "./session";
import { ELBOW_ADVICE, finalRepAdvice, MOUTH_ELBOW_ADVICE, MOUTH_SHOULDER_ADVICE, SHOULDER_ADVICE } from "./spoken";
import { exerciseScreenPreview } from "./screen-preview";

function pose(): PoseInput {
  const landmarks: Pt[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  for (const [index, x, y] of [[0, .5, .3], [2, .44, .25], [3, .41, .25], [5, .56, .25], [6, .59, .25], [9, .47, .35], [10, .53, .35], [7, .42, .3], [8, .58, .3], [11, .35, .5], [12, .65, .5], [23, .4, .8], [24, .6, .8]]) Object.assign(landmarks[index], { x, y });
  const world = landmarks.map(point => ({ ...point }));
  Object.assign(world[11], { y: .4 }); Object.assign(world[12], { y: .4 });
  return { landmarks, world };
}
const reference = geoFrom(pose(), "right");
const rules = EXERCISES.ex_h2m.compensations;
const head = rules.find(rule => rule.id === "head_forward")!;
const lean = rules.find(rule => rule.id === "trunk_forward")!;
const hike = rules.find(rule => rule.id === "shoulder_hike")!;
const SIDES: Side[] = ["left", "right"];

describe("mouth target anatomy and affected hand", () => {
  it.each(SIDES)("accepts a fingertip at the mouth with the wrist below it (%s)", side => {
    const input = pose();
    const joints = poseJoints(side);
    input.landmarks[joints.wrist] = { x: .5, y: .47, z: 0, visibility: 1 };
    input.landmarks[side === "left" ? 19 : 20] = { x: .5, y: .35, z: 0, visibility: 1 };
    const target = observedMouth(input)!;
    expect(target).toEqual({ x: .5, y: .35 });
    expect(mouthContact(input, side, target, .04, 4 / 3)).toBe(true);
    expect(mouthContact(input, side === "left" ? "right" : "left", target, .04, 4 / 3)).toBe(false);
    input.landmarks[side === "left" ? 19 : 20].visibility = .1;
    expect(mouthContact(input, side, target, .04, 4 / 3)).toBe(false);
  });
  it("does not double-mirror mouth coordinates or calibrate from an occluded mouth", () => {
    const input = pose(); input.landmarks[9].x = .27; input.landmarks[10].x = .33;
    expect(observedMouth(input)?.x).toBeCloseTo(.3);
    input.landmarks[9].visibility = .1;
    expect(observedMouth(input)).toBeUndefined();
  });
  it("learns the stable resting mouth despite occasional outliers, excluding a raised hand", () => {
    const calibration = new MouthCalibration();
    let point = null;
    for (let index = 0; index < 30; index++) {
      const frame = simFrame(index * 50, EXERCISES.ex_h2m, { elbow_flexion: 65, shoulder_flexion: 20 }, { level: 0, compensations: [] });
      if (index === 22) frame.mouthPoint = { x: .8, y: .1 };
      point = calibration.observe(frame);
    }
    expect(point).toEqual({ x: .5, y: .3 });
    const raised = new MouthCalibration();
    for (let index = 0; index < 30; index++) expect(raised.observe(simFrame(index * 50, EXERCISES.ex_h2m, {}, { level: 1, compensations: [] }))).toBeNull();
  });
});

describe("hand-to-mouth compensation independence", () => {
  it("puts the head lean first, so the simulator's leaning patient leans the head", () => {
    expect(rules.map(rule => rule.id)).toEqual(["head_forward", "trunk_forward", "shoulder_hike"]);
    expect(head).toMatchObject({ label: "head leaning forward", correction: "Keep your head up and bring the cup to your mouth, not your mouth to the cup.", unit: "%" });
    expect(head.minConsecutiveMs).toBeGreaterThanOrEqual(500);
    for (const rule of rules) expect(EXERCISES.ex_h2m.feedback.some(feedback => feedback.comp === rule.id)).toBe(true);
  });
  it("flags a shrug of 7 degrees held for 0.3 s, while the reach keeps its own shoulder rule", () => {
    expect(hike).toMatchObject({ metric: "shoulder_hike_rel_delta", thresholdDeg: 7, minConsecutiveMs: 300 }); expect(hike.alternative).toBeUndefined();
    expect(EXERCISES.ex_reach.compensations.find(rule => rule.id === "shoulder_hike")).toMatchObject({ thresholdDeg: 12, minConsecutiveMs: 400 });
  });
  it("does not turn shoulder depth noise into trunk lean, and permits modest shoulder motion", () => {
    const input = pose(); Object.assign(input.world[12], { y: .38, z: -.4 });
    const values = poseFrameValues(input, "right", reference).comps;
    expect(values.trunk_lean_delta).toBeGreaterThan(10);
    expect(values.shoulder_hike_delta).toBeCloseTo(3.8, 1);
    expect(compensationStatus(values, lean).over).toBe(false);
    expect(compensationStatus(values, hike).over).toBe(false);
    expect(compensationStatus(values, head).over).toBe(false);
  });
  it("detects camera approach of the shoulders and face as trunk lean, not head lean or a shoulder hike", () => {
    const input = pose(); input.landmarks.forEach(point => { point.x = .5 + (point.x - .5) * 1.1; point.y = .5 + (point.y - .5) * 1.1; });
    const values = poseFrameValues(input, "right", reference).comps;
    expect(values.trunk_approach_pct).toBeCloseTo(10);
    expect(compensationStatus(values, lean).over).toBe(true);
    expect(compensationStatus(values, hike).over).toBe(false);
    expect(compensationStatus(values, head).over).toBe(false);
  });
  it("detects the eyes sinking toward the shoulders as head lean, and leaves hidden eyes unmeasured", () => {
    const input = pose(); input.landmarks[2].y += .05; input.landmarks[5].y += .05;
    const values = poseFrameValues(input, "right", reference).comps;
    expect(values.head_drop_pct).toBeCloseTo(100 * .05 / .3);
    expect(compensationStatus(values, head).over).toBe(true);
    expect(compensationStatus(values, hike).over).toBe(false);
    expect(compensationStatus(values, lean).over).toBe(false);
    input.landmarks[5].visibility = .1;
    const hidden = poseFrameValues(input, "right", reference).comps;
    expect(hidden.head_forward_pct).toBeUndefined();
    expect(compensationStatus(hidden, head).ratio).toBeUndefined();
  });
  it.each(SIDES)("identifies affected shoulder lift without trunk/head flags (%s)", side => {
    const baseline = pose(); const input = pose(); input.world[poseJoints(side).shoulder].y -= .09;
    const values = poseFrameValues(input, side, geoFrom(baseline, side)).comps;
    expect(compensationStatus(values, hike).over).toBe(true);
    expect(compensationStatus(values, lean).over).toBe(false);
    expect(compensationStatus(values, head).over).toBe(false);
  });
  it("sizes the face from the outer eye corners, so eye-centre points nudged by a hand near the face are not a head lean", () => {
    // On camera the eye-centre points shifted apart by up to 4% as the hand came up; the outer corners did not.
    const input = pose(); input.landmarks[2].x -= .005; input.landmarks[5].x += .005;
    const values = poseFrameValues(input, "right", reference).comps;
    expect(values.head_approach_pct).toBe(0);
    expect(compensationStatus(values, head).over).toBe(false);
    // The face really coming closer moves the outer corners too.
    const closer = pose(); closer.landmarks[3].x -= .01; closer.landmarks[6].x += .01;
    expect(poseFrameValues(closer, "right", reference).comps.head_approach_pct).toBeCloseTo(100 * .02 / .18, 0);
  });
  it("still measures the eye line dropping when an outer eye corner is hidden", () => {
    const input = pose(); input.landmarks[2].y += .05; input.landmarks[5].y += .05; input.landmarks[6].visibility = .4;
    const values = poseFrameValues(input, "right", reference).comps;
    expect(values.head_drop_pct).toBeCloseTo(100 * .05 / .3);
    expect(values.head_approach_pct).toBeUndefined(); expect(values.trunk_approach_pct).toBeUndefined();
    expect(compensationStatus(values, head).over).toBe(true);
  });
  it("measures the head from the unaffected shoulder, so the lifting arm's shoulder point cannot fake a head lean", () => {
    const input = pose(); input.landmarks[12].y -= .06; // the right (affected) shoulder point drifts up
    expect(poseFrameValues(input, "right", reference).comps.head_drop_pct).toBe(0);
    expect(poseFrameValues(input, "left", geoFrom(pose(), "left")).comps.head_drop_pct).toBeGreaterThan(0);
  });
  it("removes the trunk's share before measuring the head, and does not inflate it when the shoulder span narrows", () => {
    const upright: Geo = { ...reference, shoulderWidth: .3, eyeSpan: .06, headLift: .7 };
    // Shoulders 10% closer and the face 16.5% (1.1^1.6) closer with the eye line 5% lower: a rigid trunk lean.
    const trunkOnly = headLeanMetrics({ ...upright, shoulderWidth: .33, eyeSpan: .06 * 1.1 ** 1.6, headLift: .65 }, upright);
    expect(trunkOnly.trunk_approach_pct).toBeCloseTo(10);
    expect(trunkOnly.head_drop_pct).toBeCloseTo(0); expect(trunkOnly.head_approach_pct).toBeCloseTo(0); expect(trunkOnly.head_forward_pct).toBeCloseTo(0);
    // A narrower shoulder span (the affected shoulder rolling forward) is not read as the head moving.
    expect(headLeanMetrics({ ...upright, shoulderWidth: .28 }, upright)).toMatchObject({ head_forward_pct: 0, trunk_approach_pct: 0 });
    // The face 6% closer with the shoulders still: forward travel in shoulder widths (camera ~2.5 widths away).
    expect(headLeanMetrics({ ...upright, eyeSpan: .06 * 1.06 }, upright).head_forward_pct).toBeCloseTo(6 * 2.5);
  });
});

// Simulated seated patient seen by a front camera at several heights (metres above the hips / from the hips).
const CAMERAS = { low: { y: .25, z: 1.2 }, chest: { y: .35, z: 1 }, face: { y: .62, z: .75 }, high: { y: .8, z: .8 } };
const flagged = (side: Side, posture: SeatedPosture, camera: { y: number; z: number }) => {
  const comps = poseFrameValues(seatedPose(side, { ...posture, camera }), side, geoFrom(seatedPose(side, { camera }), side)).comps;
  return { comps, over: rules.filter(rule => compensationStatus(comps, rule).over).map(rule => rule.id) };
};
const cases = SIDES.flatMap(side => Object.entries(CAMERAS).map(([name, camera]) => ({ side, name, camera })));

describe("hand-to-mouth posture classification from landmarks", () => {
  it.each(cases)("upright rest: nothing flagged, every check measured ($side side, $name camera)", ({ side, camera }) => {
    const { comps, over } = flagged(side, {}, camera);
    expect(over).toEqual([]);
    for (const rule of rules) expect(compensationStatus(comps, rule).ratio).toBe(0);
  });
  it.each(cases)("normal hand-to-mouth with a slight chin dip and the mouth hidden by the cup: nothing flagged ($side side, $name camera)", ({ side, camera }) => {
    const { comps, over } = flagged(side, { hand: 1, headFlexDeg: 6 }, camera);
    expect(comps.face_approach_pct).toBeUndefined(); // mouth corners covered
    expect(over).toEqual([]);
    expect(compensationStatus(comps, head).ratio).toBeLessThan(.7);
    // The shoulder point drifting up as the arm lifts stays well under the shrug threshold.
    expect(compensationStatus(comps, hike).ratio).toBeLessThan(.25);
  });
  it.each(cases)("head-only lean to meet the cup: head_forward only ($side side, $name camera)", ({ side, camera }) => {
    expect(flagged(side, { hand: 1, headFlexDeg: 20 }, camera).over).toEqual(["head_forward"]);
    expect(flagged(side, { hand: 1, headForwardM: .06 }, camera).over).toEqual(["head_forward"]);
  });
  it.each(cases)("whole-trunk lean: trunk_forward, not head_forward ($side side, $name camera)", ({ side, camera }) => {
    const { comps, over } = flagged(side, { hand: 1, headFlexDeg: 4, trunkLeanDeg: 12 }, camera);
    expect(over).toEqual(["trunk_forward"]);
    expect(compensationStatus(comps, head).ratio).toBeLessThan(1);
  });
  it.each(cases.filter(item => item.name !== "high"))("trunk lean with the head going clearly beyond it: both ($side side, $name camera)", ({ side, camera }) => {
    const { comps, over } = flagged(side, { hand: 1, headFlexDeg: 26, trunkLeanDeg: 12 }, camera);
    expect(over).toEqual(["head_forward", "trunk_forward"]);
    expect(compensationStatus(comps, head).ratio).toBeGreaterThanOrEqual(head.yieldsTo!.minRatio);
  });
  it.each(cases)("shoulder hike: shoulder_hike only ($side side, $name camera)", ({ side, camera }) => {
    expect(flagged(side, { hand: 1, headFlexDeg: 4, shoulderHikeM: .11 }, camera).over).toEqual(["shoulder_hike"]);
  });
  it.each(SIDES)("a sideways lean of the whole upper body toward the stronger side is not a shrug; a shrug while leaning still is (%s)", side => {
    const upright = geoFrom(seatedPose(side), side);
    /** Lean the world landmarks about the hip centre toward the unaffected side (world x is the patient's left). */
    const leaning = (posture: SeatedPosture, degrees: number) => {
      const pose = seatedPose(side, posture);
      const a = degrees * Math.PI / 180 * (side === "right" ? 1 : -1);
      pose.world = pose.world.map(point => ({ ...point, x: point.x * Math.cos(a) - point.y * Math.sin(a), y: point.x * Math.sin(a) + point.y * Math.cos(a) }));
      return poseFrameValues(pose, side, upright).comps;
    };
    for (const degrees of [6, 8, 10]) {
      const comps = leaning({ hand: 1, headFlexDeg: 4 }, degrees);
      expect(comps.shoulder_hike_delta).toBeGreaterThan(7); // the plain tilt would have called it a shrug
      expect(compensationStatus(comps, hike).over).toBe(false);
    }
    expect(compensationStatus(leaning({ hand: 1, headFlexDeg: 4, shoulderHikeM: .055 }, 6), hike).over).toBe(true);
  });
  it.each(cases)("a natural shrug to reach the mouth (about 5.5 cm, 10°): shoulder_hike only ($side side, $name camera)", ({ side, camera }) => {
    const { comps, over } = flagged(side, { hand: 1, headFlexDeg: 4, shoulderHikeM: .055 }, camera);
    expect(over).toEqual(["shoulder_hike"]);
    expect(comps.shoulder_hike_rel_delta).toBeGreaterThan(9);
  });
});

function patient(side: Side = "right", suppliedVoice?: Voice, reps = 1) {
  const said: string[] = [];
  const session = new ExerciseSession({ exerciseId: "ex_h2m", rung: 1, side, repsOverride: reps, reviewBetweenReps: true }, suppliedVoice ?? { say: text => said.push(text), busy: () => false, stop() {} });
  let t = 0; session.start(t);
  const push = (options: { level?: number; contact?: boolean; unsure?: boolean; progress?: number; comps?: Frame["comps"]; visible?: boolean; geo?: Geo; simulate?: string[] } = {}) => {
    const snap = session.snapshot();
    const level = options.level ?? (snap.phase === "setup" || session.currentStep?.kind === "return" ? 0 : 1);
    const frame = simFrame(t += 50, session.cfg, session.targets(), { level, compensations: options.simulate ?? [], visible: options.visible });
    frame.geo = options.geo ?? reference;
    if (snap.phase === "warm" || snap.phase === "reps") frame.targetContact = options.contact ?? true;
    if (options.unsure) frame.targetUnsure = true;
    if (options.progress !== undefined) frame.targetProgress = options.progress;
    if (options.comps) frame.comps = options.comps;
    session.push(frame); return session.snapshot();
  };
  const until = (predicate: () => boolean, options = {}) => {
    for (let n = 0; n < 1000 && !predicate(); n++) push(options);
    expect(predicate()).toBe(true);
  };
  return { session, push, until, said };
}
function scored(side: Side = "right", reps = 1) {
  const p = patient(side, undefined, reps);
  p.until(() => p.session.snapshot().phase === "demo"); p.session.skipAhead(3000);
  p.until(() => p.session.snapshot().phase === "reps" && p.session.snapshot().targetArmed);
  return p;
}

describe("hand-to-mouth level 1 progression and scoring", () => {
  it.each(SIDES)("keeps seated references and learns target-hold angles without an increment (%s)", side => {
    const p = patient(side); p.until(() => p.session.snapshot().phase === "demo");
    expect(p.session.lapPoint).toEqual({ x: .6, y: .8, bodyScale: .4 });
    expect(p.session.mouthPoint).toEqual({ x: .5, y: .3 });
    p.session.skipAhead(3000);
    const compensated = { ...reference, nosePitch: 30, shoulderTilt: 20, headLift: .2 };
    p.until(() => p.session.snapshot().phase === "reps", { geo: compensated });
    expect(p.session.reference).toEqual(reference);
    expect(p.session.targets()).toEqual({ elbow_flexion: 65, shoulder_flexion: 20 });
    expect(p.session.startingAngles()).toEqual({ elbow_flexion: 10, shoulder_flexion: 8 });
  });
  it("requires continuous, equal 1.5-second mouth and lap holds and resets on lost tracking", () => {
    const p = scored();
    p.push({ contact: false });
    for (let n = 0; n < 10; n++) p.push();
    expect(p.session.snapshot().holdProgress).toBeCloseTo(1 / 3);
    // The cup leaves the lips with the elbow still bent: the hold restarts on the same target, as in the reach.
    p.push({ contact: false });
    expect(p.session.currentStep?.kind).toBe("reach"); expect(p.session.snapshot().holdProgress).toBe(0);
    for (let n = 0; n < 10; n++) p.push();
    p.push({ visible: false }); expect(p.session.snapshot().holdProgress).toBe(0);
    p.until(() => p.session.currentStep?.kind === "return");
    p.until(() => p.session.snapshot().targetArmed);
    p.push({ contact: false });
    for (let n = 0; n < 10; n++) p.push();
    expect(p.session.snapshot().holdProgress).toBeCloseTo(1 / 3);
    p.push({ contact: false }); expect(p.session.snapshot().holdProgress).toBe(0);
    p.until(() => p.session.snapshot().review === "complete");
    expect(p.session.snapshot().reps[0].score).toBe(100);
  });
  it("does not count leaning in to the screen while the hand is still far from the mouth", () => {
    const leaning = { head_forward_pct: 40, trunk_approach_pct: 20, shoulder_hike_rel_delta: 12 };
    const lap = scored();
    // Two seconds leaning toward the screen, shoulder up too, with the hand still by the lap: nothing counts.
    for (let n = 0; n < 40; n++) lap.push({ contact: false, progress: 0.1, level: 0.1, comps: leaning });
    lap.until(() => lap.session.snapshot().review === "complete");
    expect(lap.session.snapshot().reps[0]).toMatchObject({ compensations: [], score: 100, unmeasured: [] });
    // With the arm moving and the hand 40% of the way to the mouth, the leans still do not count; the shoulder hike
    // does, as it lifts the arm.
    const far = scored();
    for (let n = 0; n < 40; n++) far.push({ contact: false, progress: 0.4, level: 0.6, comps: leaning });
    far.until(() => far.session.snapshot().review === "complete");
    expect(far.session.snapshot().reps[0].compensations).toEqual(["shoulder_hike"]);
    // The same lean with the hand most of the way to the mouth is meeting the cup.
    const near = scored();
    for (let n = 0; n < 40; n++) near.push({ contact: false, progress: 0.7, level: 0.6, comps: leaning });
    near.until(() => near.session.snapshot().review === "complete");
    expect(near.session.snapshot().reps[0].compensations.sort()).toEqual(["head_forward", "shoulder_hike", "trunk_forward"]);
  });
  it("flags a shoulder hiked on the way up to the mouth, though the hand's points jump about by the face", () => {
    const hiked = { head_forward_pct: 0, trunk_approach_pct: 0, shoulder_hike_rel_delta: 10 };
    const p = scored();
    // As in a replayed camera recording: the hike runs while the hand rises, its reported progress mostly between 25%
    // and 55% of the way and only now and then past the mouth posture's 60% (too seldom for that alone to count it).
    for (let n = 0; n < 30; n++) p.push({ contact: false, progress: n % 8 === 0 ? 0.7 : 0.25 + 0.01 * n, level: 0.6, comps: hiked });
    p.until(() => p.session.snapshot().review === "complete");
    expect(p.session.snapshot().reps[0].compensations).toEqual(["shoulder_hike"]);
  });
  it("says the score and the shoulder's short correction after a hiked repetition, and no best measure at the end", () => {
    const hiked = { head_forward_pct: 0, trunk_approach_pct: 0, shoulder_hike_rel_delta: 10 };
    const p = scored();
    for (let n = 0; n < 30; n++) p.push({ contact: false, progress: 0.25 + 0.01 * n, level: 0.6, comps: hiked });
    p.until(() => p.session.snapshot().review === "complete");
    expect(p.session.snapshot().reps[0].compensations).toEqual(["shoulder_hike"]);
    const correction = p.session.cfg.compensations.find(rule => rule.id === "shoulder_hike")!.correction;
    expect(p.said.at(-2)).toMatch(/^Your score is \d+ out of 100\.$/);
    expect(p.said.at(-1)).toBe(correction);
    // The card keeps the longer advice.
    expect(p.session.snapshot().reviewAdvice.join(" ")).toMatch(/shoulder/i);
    p.until(() => p.session.snapshot().phase === "done");
    expect(p.said.some(line => line.startsWith("Your best"))).toBe(false);
  });
  it("says a fault that keeps coming back every other repetition, not after each one", () => {
    const hiked = { head_forward_pct: 0, trunk_approach_pct: 0, shoulder_hike_rel_delta: 10 };
    const p = scored("right", 3);
    const correction = p.session.cfg.compensations.find(rule => rule.id === "shoulder_hike")!.correction;
    const spokenAfter: string[][] = [];
    for (let rep = 0; rep < 3; rep++) {
      for (let n = 0; n < 30; n++) p.push({ contact: false, progress: 0.25 + 0.01 * n, level: 0.6, comps: hiked });
      const from = p.said.length;
      p.until(() => p.session.snapshot().review === "complete");
      spokenAfter.push(p.said.slice(from));
      expect(p.session.snapshot().reps[rep].compensations).toEqual(["shoulder_hike"]);
      if (rep < 2) p.until(() => p.session.snapshot().review === null && p.session.snapshot().targetArmed);
    }
    expect(spokenAfter.map(lines => lines.includes(correction))).toEqual([true, false, true]);
  });
  it("keeps a head lean near the mouth running through a one-frame wrist glitch", () => {
    const leaning = { head_forward_pct: 40, trunk_approach_pct: 0, shoulder_hike_rel_delta: 0 };
    const p = scored();
    // Hovering short of the circle with the head leaning in; every sixth frame the tracker drops the wrist to the lap.
    for (let n = 0; n < 40; n++) p.push({ contact: false, progress: n % 6 === 5 ? 0.05 : 0.7, level: 0.6, comps: leaning });
    p.until(() => p.session.snapshot().review === "complete");
    expect(p.session.snapshot().reps[0].compensations).toEqual(["head_forward"]);
  });
  it("does not call posture unmeasured when the hand never came near the mouth", () => {
    const p = scored();
    p.until(() => p.session.snapshot().review === "complete", { contact: false, progress: 0.3, level: 0.6 });
    const rep = p.session.snapshot().reps[0];
    expect(rep.hold).toBe("none");
    expect(rep.unmeasured).toEqual([]);
    expect(p.session.snapshot().reviewAdvice.join(" ")).not.toMatch(/in view so I can check your posture/);
  });
  it("pauses the mouth hold while tracking has briefly lost a hand that was at the lips", () => {
    const p = scored();
    p.push({ contact: false });
    for (let n = 0; n < 10; n++) p.push();
    expect(p.session.snapshot().holdProgress).toBeCloseTo(1 / 3);
    // The tracker shows the arm hanging down: neither counted, reset nor ended as a touch.
    for (let n = 0; n < 10; n++) {
      const snap = p.push({ contact: false, unsure: true, level: 0 });
      expect(snap.holdProgress).toBeCloseTo(1 / 3); expect(snap.inZone).toBe(true);
    }
    expect(p.session.currentStep?.kind).toBe("reach");
    for (let n = 0; n < 20; n++) p.push();
    expect(p.session.currentStep?.kind).toBe("return");
    p.until(() => p.session.snapshot().review === "complete");
    expect(p.session.snapshot().reps[0]).toMatchObject({ score: 100, hold: "full" });
  });
  it.each([["head_forward"], ["trunk_forward"], ["shoulder_hike"], ["head_forward", "shoulder_hike"], ["trunk_forward", "shoulder_hike"]])("confirms sustained %j and gives fixed compensation points", (...expected) => {
    const p = scored();
    const values = Object.fromEntries(rules.map(rule => [rule.metric, expected.includes(rule.id) ? rule.thresholdDeg + 3 : 0]));
    p.until(() => p.session.currentStep?.kind === "return", { comps: values });
    p.until(() => p.session.snapshot().review === "complete");
    const result = p.session.snapshot().reps[0];
    expect(result.compensations.sort()).toEqual([...expected].sort());
    expect(result.score).toBe(expected.length === 1 ? 30 : 15);
    expect(p.session.snapshot().reviewAdvice.length).toBe(expected.length);
  });
  it("reports a head lean during a trunk lean only when the head goes clearly beyond the trunk", () => {
    for (const [headPct, expected] of [[13, ["trunk_forward"]], [16, ["head_forward", "trunk_forward"]]] as const) {
      const p = scored();
      p.until(() => p.session.currentStep?.kind === "return", { comps: { head_forward_pct: headPct, trunk_approach_pct: 9, shoulder_hike_rel_delta: 0 } });
      p.until(() => p.session.snapshot().review === "complete");
      expect(p.session.snapshot().reps[0].compensations.sort()).toEqual([...expected]);
      expect(p.session.snapshot().reps[0].score).toBe(expected.length === 1 ? 30 : 15);
    }
  });
  it("rejects brief compensation spikes and never labels wholly unmeasured posture as a good rep", () => {
    const p = scored();
    for (let n = 0; n < 3; n++) p.push({ comps: { trunk_approach_pct: 10, shoulder_hike_rel_delta: 15, head_forward_pct: 20 } });
    p.until(() => p.session.snapshot().review === "complete");
    expect(p.session.snapshot().reps[0].compensations).toEqual([]);
    const unknown = scored(); unknown.until(() => unknown.session.currentStep?.kind === "return", { comps: {} });
    unknown.until(() => unknown.session.snapshot().review === "complete");
    expect(unknown.session.snapshot().reps[0].unmeasured).toEqual(["head_forward", "trunk_forward", "shoulder_hike"]);
    expect(unknown.session.snapshot().reps[0].good).toBe(false);
  });
  it("shows feedback for all six reps, a countdown before each, then the summary", () => {
    const p = patient("right", undefined, 6);
    p.until(() => p.session.snapshot().phase === "demo"); p.session.skipAhead(3000);
    let completionCount = 0, countdownCount = 0, previous = "";
    for (let n = 0; n < 3000 && p.session.snapshot().phase !== "done"; n++) {
      const snap = p.push(); const state = `${snap.review}:${snap.reps.length}`;
      if (state !== previous) { if (snap.review === "complete") completionCount++; if (snap.review === "countdown") countdownCount++; previous = state; }
    }
    expect(completionCount).toBe(6); expect(countdownCount).toBe(6);
    expect(p.session.snapshot().record?.repetition_scores).toEqual([100, 100, 100, 100, 100, 100]);
    expect(p.session.snapshot().phase).toBe("done");
  });
  it("cannot accumulate early contact while instruction speech is busy", () => {
    let busy = false;
    const p = patient("right", { say() {}, busy: () => busy, stop() {} });
    p.until(() => p.session.snapshot().phase === "demo"); p.session.skipAhead(3000);
    p.until(() => p.session.snapshot().targetArmed); busy = true;
    for (let n = 0; n < 40; n++) p.push();
    expect(p.session.snapshot().targetArmed).toBe(false); expect(p.session.snapshot().holdProgress).toBe(0);
    busy = false; p.until(() => p.session.currentStep?.kind === "return");
  });
  it("cannot learn a mouth target from a raised hand or an occluded mouth", () => {
    const raised = patient();
    for (let n = 0; n < 100; n++) raised.push({ level: 1 });
    expect(raised.session.snapshot().phase).toBe("setup");
    const session = new ExerciseSession({ exerciseId: "ex_h2m", rung: 1, side: "left" }, { say() {}, busy: () => false, stop() {} });
    session.start(0);
    for (let t = 50; t <= 5000; t += 50) {
      const frame = simFrame(t, session.cfg, session.targets(), { level: 0, compensations: [] });
      delete frame.mouthPoint; session.push(frame);
    }
    expect(session.snapshot().phase).toBe("setup"); expect(session.mouthPoint).toBeNull();
  });
});

describe("hand-to-mouth posture over a scored repetition (landmark measures)", () => {
  /** One scored repetition; during the mouth step each frame's measures come from simulated landmarks. */
  function repWith(side: Side, postureAt: (ms: number) => SeatedPosture) {
    const p = scored(side);
    const upright = geoFrom(seatedPose(side), side);
    let ms = 0;
    for (let n = 0; n < 400 && p.session.snapshot().review !== "complete"; n++) {
      const reaching = p.session.currentStep?.kind === "reach";
      const comps = poseFrameValues(seatedPose(side, reaching ? { hand: 1, ...postureAt(ms) } : {}), side, upright).comps;
      if (reaching) ms += 50;
      p.push({ comps });
    }
    expect(p.session.snapshot().review).toBe("complete");
    return p.session.snapshot().reps[0];
  }
  it.each(SIDES)("a normal hand-to-mouth is clean (%s)", side => {
    const rep = repWith(side, () => ({ headFlexDeg: 6 }));
    expect(rep.compensations).toEqual([]); expect(rep.unmeasured).toEqual([]); expect(rep.score).toBe(100);
  });
  it.each(SIDES)("a glance down at the screen shorter than the sustained window is not a compensation (%s)", side => {
    const rep = repWith(side, ms => ({ headFlexDeg: ms >= 300 && ms < 750 ? 22 : 4 }));
    expect(rep.compensations).toEqual([]); expect(rep.score).toBe(100);
  });
  it.each(SIDES)("a sustained head lean to meet the cup is head_forward (%s)", side => {
    const rep = repWith(side, ms => ({ headFlexDeg: ms >= 200 ? 22 : 4 }));
    expect(rep.compensations).toEqual(["head_forward"]); expect(rep.score).toBe(30);
  });
  it.each(SIDES)("a whole-trunk lean is trunk_forward, not also head_forward (%s)", side => {
    expect(repWith(side, () => ({ headFlexDeg: 4, trunkLeanDeg: 12 })).compensations).toEqual(["trunk_forward"]);
  });
  it.each(SIDES)("a trunk lean with the head clearly beyond it reports both (%s)", side => {
    expect(repWith(side, () => ({ headFlexDeg: 26, trunkLeanDeg: 12 })).compensations.sort()).toEqual(["head_forward", "trunk_forward"]);
  });
  it.each(SIDES)("a shoulder hike is shoulder_hike alone (%s)", side => {
    expect(repWith(side, () => ({ headFlexDeg: 4, shoulderHikeM: .11 })).compensations).toEqual(["shoulder_hike"]);
  });
  it.each(SIDES)("a natural shrug held at the mouth is shoulder_hike (%s)", side => {
    expect(repWith(side, ms => ({ headFlexDeg: 4, shoulderHikeM: ms >= 200 ? .055 : 0 }))).toMatchObject({ compensations: ["shoulder_hike"], score: 30 });
  });
  it.each(SIDES)("a shrug shorter than 0.3 s, or a small shoulder rise, is not a compensation (%s)", side => {
    expect(repWith(side, ms => ({ headFlexDeg: 4, shoulderHikeM: ms >= 300 && ms < 500 ? .055 : 0 })).compensations).toEqual([]);
    expect(repWith(side, () => ({ headFlexDeg: 4, shoulderHikeM: .03 })).compensations).toEqual([]);
  });
});

describe("hand-to-mouth simulator", () => {
  it("measures the simulated patient with the camera code: a lean builds as the cup nears the mouth", () => {
    expect(simulatedMouthComps(0, ["head_forward"]).head_forward_pct).toBe(0);
    const near = simulatedMouthComps(1, ["head_forward"]);
    expect(compensationStatus(near, head).ratio).toBeGreaterThan(1.5);
    expect(compensationStatus(near, lean).over).toBe(false);
    expect(compensationStatus(near, hike).over).toBe(false);
    const normal = simulatedMouthComps(1, []);
    expect(rules.filter(rule => compensationStatus(normal, rule).over)).toEqual([]);
  });
  it.each(rules.map(rule => rule.id))("reports the simulated %s alone in the repetition and its review", id => {
    const p = scored();
    p.until(() => p.session.snapshot().review === "complete", { simulate: [id] });
    expect(p.session.snapshot().reps[0].compensations).toEqual([id]);
    expect(p.session.snapshot().reviewAdvice).toContain(finalRepAdvice(EXERCISES.ex_h2m.feedback.find(rule => rule.comp === id)!.say));
  });
});

// ---------- the same flow as Graded Forward Reach ----------

const quiet = (said: string[] = []): Voice => ({ say: text => said.push(text), busy: () => false, stop() {} });
/** Either seated exercise through set up and practice, driven by the same simulated patient. */
function seated(exerciseId: string, voice: Voice = quiet(), reps = 1) {
  const session = new ExerciseSession({ exerciseId, rung: 1, side: "right", repsOverride: reps, reviewBetweenReps: true }, voice);
  let t = 0;
  session.start(t);
  type PushOptions = { level?: number; contact?: boolean; visible?: boolean; values?: Frame["values"]; simulate?: string[] };
  const push = (options: PushOptions = {}) => {
    const snap = session.snapshot();
    const reaching = session.currentStep?.kind === "reach" || session.currentStep?.kind === "open";
    const scoredReach = reaching && snap.phase === "reps";
    const frame = simFrame(t += 50, session.cfg, session.targets(), { level: options.level ?? (snap.phase !== "setup" && reaching ? 1 : 0), compensations: scoredReach ? options.simulate ?? [] : [], visible: options.visible });
    if (snap.phase === "warm" || snap.phase === "reps") frame.targetContact = options.contact ?? true;
    if (options.values && scoredReach) frame.values = { ...frame.values, ...options.values };
    session.push(frame);
    return session.snapshot();
  };
  const until = (predicate: () => boolean, options: PushOptions = {}) => {
    for (let n = 0; n < 2000 && !predicate(); n++) push(options);
    expect(predicate()).toBe(true);
  };
  /** Set up, skip the demonstration, learn the practice target, then arm the first scored target with the hand still on the lap. */
  const toScoredRep = () => {
    until(() => session.snapshot().phase === "demo");
    session.skipAhead(t += 1);
    until(() => session.snapshot().phase === "reps");
    until(() => session.snapshot().targetArmed, { contact: false, level: 0 });
  };
  return { session, push, until, toScoredRep };
}
const SEATED = ["ex_reach", "ex_h2m"];
/** Every exercise on the shared target flow: the seated ones, Active Hand Opening, Seated Knee Extension and Supported Arm Elevation. */
const TARGET_FLOW = [...SEATED, "ex_handopen", "ex_lower_selective", "ex_wallslide", "ex_pinch", "ex_ankle_dorsiflexion"];
/** The exercises that ask for the affected hand when it leaves the view (the knee asks for the legs, the slide names what is missing). */
const HAND_FLOW = TARGET_FLOW.filter(id => id !== "ex_lower_selective" && id !== "ex_wallslide" && id !== "ex_ankle_dorsiflexion");

describe("hand-to-mouth follows Graded Forward Reach's flow", () => {
  // Two-step cycles (a target, then back); Pinch and Peg's four steps are counted in pinch-target.test.ts.
  it.each(TARGET_FLOW.filter(id => EXERCISES[id].cycle.length === 2))("%s: each scored repetition starts after the countdown, with each step instructed only in practice", id => {
    const said: string[] = [];
    const p = seated(id, quiet(said), 3);
    let countdowns = 0, previous: string | null = null, inactive = 0;
    for (let n = 0; n < 4000 && p.session.snapshot().phase !== "done"; n++) {
      const snap = p.push();
      if (snap.review === "countdown" && previous !== "countdown") { countdowns++; expect(snap.repIndex).toBe(snap.reps.length); }
      // Every scored step is live from its first frame: nothing is said, nothing flashes inactive.
      if (snap.phase === "reps" && snap.review === null && !snap.targetArmed) inactive++;
      previous = snap.review;
    }
    const [reach, back] = EXERCISES[id].cycle;
    if (reach.cue || back.cue) {
      // Hand opening says a short cue as each scored step starts ("Open your hand."): inactive only while it
      // starts (two 50 ms frames per step).
      expect(inactive).toBeLessThanOrEqual(4 * 3);
      for (const cue of [reach.cue, back.cue]) expect(said.filter(line => line === cue)).toHaveLength(3);
    } else expect(inactive).toBe(0);
    expect(countdowns).toBe(3);
    expect(said.filter(line => line === reach.voice)).toHaveLength(1);
    expect(said.filter(line => line === back.voice)).toHaveLength(1);
    // Said before the first scored repetition only; the ring and the card show the later countdowns.
    expect(said.filter(line => line === "The next repetition starts in three seconds.")).toHaveLength(1);
    expect(p.session.snapshot().record?.repetition_scores).toEqual([100, 100, 100]);
  });
  it.each(TARGET_FLOW)("%s: touching the target and lowering the arm before the hold ends the movement as touched", id => {
    const p = seated(id);
    p.toScoredRep();
    for (let n = 0; n < 5; n++) p.push();
    expect(p.session.snapshot().holdProgress).toBeCloseTo(250 / 1500);
    p.push({ contact: false, level: 0 });
    expect(p.session.currentStep?.kind).toBe("return");
    p.until(() => p.session.snapshot().review === "complete");
    expect(p.session.snapshot().reps[0]).toMatchObject({ hold: "touched", score: 80, good: false });
  });
  it.each(TARGET_FLOW)("%s: a target never touched for 30 s is a miss", id => {
    const p = seated(id);
    p.toScoredRep();
    for (let n = 0; n < 650 && !p.session.snapshot().review; n++) p.push({ contact: false, level: 0 });
    expect(p.session.snapshot().reps[0]).toMatchObject({ hold: "none", score: 0 });
  });
  it.each(HAND_FLOW)("%s: asks for the affected hand back when it leaves the view mid-repetition", id => {
    const said: string[] = [];
    const p = seated(id, quiet(said));
    p.toScoredRep();
    for (let n = 0; n < 30; n++) p.push({ visible: false });
    expect(p.session.snapshot().paused).toBe(true);
    expect(said.at(-1)).toBe("Bring your affected hand back into view.");
    expect(p.session.snapshot().prompt).toBe("Bring your affected hand back into view.");
  });
  it.each(TARGET_FLOW)("%s: may start the demonstration 12 s into a long introduction once the posture is learned", id => {
    const session = new ExerciseSession({ exerciseId: id, rung: 1, side: "right" }, { say() {}, busy: () => true, stop() {} });
    session.start(0);
    let t = 0;
    while (t < 11950) session.push(simFrame(t += 50, session.cfg, session.targets(), { level: 0, compensations: [] }));
    expect(session.snapshot().phase).toBe("setup");
    expect(session.snapshot().calibrationProgress).toBe(1);
    for (let n = 0; n < 3; n++) session.push(simFrame(t += 50, session.cfg, session.targets(), { level: 0, compensations: [] }));
    expect(session.snapshot().phase).toBe("demo");
  });
  it.each([
    ["ex_reach", { shoulder_flexion: 20 }, [SHOULDER_ADVICE]],
    ["ex_reach", { elbow_extension: 110 }, [ELBOW_ADVICE]],
    ["ex_h2m", { elbow_flexion: 40 }, [MOUTH_ELBOW_ADVICE]],
    ["ex_h2m", { shoulder_flexion: 12 }, [MOUTH_SHOULDER_ADVICE]],
    ["ex_handopen", { finger_extension: 115 }, ["Open your fingers a little wider, out to the ring."]],
    ["ex_lower_selective", { knee_extension: 110 }, ["Straighten your knee a little more, as far as is comfortable."]],
    ["ex_ankle_dorsiflexion", { toe_lift: -17 }, ["Lift your toes a little higher, keeping your heel down."]],
    ["ex_wallslide", { slide_out: 0.2 }, ["Move your hand a little further out toward the cup."]],
  ] as const)("%s: the review names the angle that fell short, in the movement's own words (%j)", (id, values, advice) => {
    const p = seated(id);
    p.toScoredRep();
    p.until(() => p.session.snapshot().review === "complete", { values });
    expect(p.session.snapshot().reviewAdvice).toEqual(advice);
    expect(p.session.snapshot().reps[0].score).toBeLessThan(100);
  });
  it.each(TARGET_FLOW)("%s: the final repetition's advice drops \"next repetition\"", id => {
    for (const rule of EXERCISES[id].feedback.filter(rule => rule.comp)) expect(finalRepAdvice(rule.say)).not.toMatch(/next/i);
  });
  it.each(TARGET_FLOW)("%s: the simulator's leaning patient uses the first check, reported with its advice", id => {
    const first = EXERCISES[id].compensations[0].id;
    const p = seated(id);
    p.toScoredRep();
    p.until(() => p.session.snapshot().review === "complete", { simulate: [first] });
    expect(p.session.snapshot().reps[0].compensations).toEqual([first]);
    expect(p.session.snapshot().reps[0].score).toBe(30);
    // A single planned repetition, so this is the final repetition's wording.
    expect(p.session.snapshot().reviewAdvice).toEqual([finalRepAdvice(EXERCISES[id].feedback.find(rule => rule.comp === first)!.say)]);
  });
  it.each([false, true])("mouth demonstration has the reach demonstration's states, fields and listening wording (returning=%s)", returning => {
    const [mouth, reach] = [mouthDemoState(0, returning, false), reachDemoState(0, returning, false)];
    expect(Object.keys(mouth).sort()).toEqual(Object.keys(reach).sort());
    expect(mouth.phase).toBe("waiting"); expect(mouth.instruction).toBe(reach.instruction);
    expect(mouthDemoState(0, returning).phase).toBe("move");
    expect(mouthDemoState(mouthDemoDuration(returning) - 1, returning).phase).toBe("complete");
    expect(reachDemoState(reachDemoDuration(returning) - 1, returning).phase).toBe("complete");
    expect(mouthDemoState(0, returning).label).toBe(returning ? "Lap target" : "Mouth target");
    // The lap circle is the reach's lap circle; the mouth circle is smaller.
    expect(mouthGhostTarget(300, 270, true).radius).toBe(reachGhostTarget(300, 270, true).radius);
    expect(mouthGhostTarget(300, 270, false).radius).toBeLessThan(reachGhostTarget(300, 270, false).radius);
  });
  it("previews show hand-to-mouth's head lean where the reach shows its trunk lean", () => {
    for (const id of TARGET_FLOW) {
      const first = EXERCISES[id].compensations[0];
      const results = exerciseScreenPreview("results", 1, "right", id);
      expect(results.snapshot.record?.compensation_counts[first.id]).toBe(2);
      expect(exerciseScreenPreview("complete", 1, "right", id).snapshot.reviewAdvice[0]).toBe(EXERCISES[id].feedback.find(rule => rule.comp === first.id)!.say);
      expect(results.live.comps.map(comp => comp.label)).toEqual(EXERCISES[id].compensations.map(comp => comp.label));
    }
    expect(EXERCISES.ex_h2m.compensations[0].label).toBe("head leaning forward");
  });
});

it.each([false, true])("mouth demonstration waits for contact, holds for 1.5s and completes before returning (%s)", returning => {
  let contactAt = 0;
  for (; contactAt < 1200; contactAt++) if (mouthDemoState(contactAt, returning).contact) break;
  const atContact = mouthDemoState(contactAt, returning);
  const hand = mouthGhostPose(atContact.pose).wrist, target = mouthGhostPose(returning ? 0 : 1).wrist;
  expect(atContact.target).toEqual(target);
  expect(Math.hypot(hand[0] - target[0], hand[1] - target[1])).toBeLessThanOrEqual(atContact.radius);
  expect(mouthDemoState(contactAt - 1, returning).contact).toBe(false);
  expect(mouthDemoState(contactAt + 750, returning).progress).toBeCloseTo(.5, 2);
  expect(mouthDemoState(mouthDemoDuration(returning), returning).phase).toBe("complete");
  expect(mouthDemoState(10000, returning, false).progress).toBe(0);
});
