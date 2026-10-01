import { describe, expect, it } from "vitest";
import { EXERCISES, type Side } from "./config";
import { geoFrom, compensationStatus, poseFrameValues, poseJoints, type Frame, type Geo, type PoseInput, type Pt } from "./metrics";
import { MouthCalibration, mouthContact, observedMouth, mouthCompensations } from "./mouth-target";
import { mouthGhostPose } from "./ghost";
import { mouthDemoDuration, mouthDemoState } from "./mouth-demo";
import { ExerciseSession, simFrame, type Voice } from "./session";

function pose(): PoseInput {
  const landmarks: Pt[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  for (const [index, x, y] of [[0, .5, .3], [2, .44, .25], [5, .56, .25], [9, .47, .35], [10, .53, .35], [7, .42, .3], [8, .58, .3], [11, .35, .5], [12, .65, .5], [23, .4, .8], [24, .6, .8]]) Object.assign(landmarks[index], { x, y });
  const world = landmarks.map(point => ({ ...point }));
  Object.assign(world[11], { y: .4 }); Object.assign(world[12], { y: .4 });
  return { landmarks, world };
}
const reference = geoFrom(pose(), "right");
const rules = EXERCISES.ex_h2m.compensations;
const lean = rules.find(rule => rule.id === "trunk_forward")!;
const hike = rules.find(rule => rule.id === "shoulder_hike")!;
const head = rules.find(rule => rule.id === "head_drop")!;

describe("mouth target anatomy and affected hand", () => {
  it.each(["left", "right"] as Side[])("accepts a fingertip at the mouth with the wrist below it (%s)", side => {
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
  it("does not turn shoulder depth noise into trunk lean, and permits modest shoulder motion", () => {
    const input = pose(); Object.assign(input.world[12], { y: .35, z: -.4 });
    const values = poseFrameValues(input, "right", reference).comps;
    expect(values.trunk_lean_delta).toBeGreaterThan(10);
    expect(compensationStatus(values, lean).over).toBe(false);
    expect(compensationStatus(values, hike).over).toBe(false);
  });
  it("detects camera approach independently of a shoulder hike or head drop", () => {
    const input = pose(); input.landmarks.forEach(point => { point.x = .5 + (point.x - .5) * 1.1; point.y = .5 + (point.y - .5) * 1.1; });
    const values = poseFrameValues(input, "right", reference).comps;
    expect(compensationStatus(values, lean).over).toBe(true);
    expect(compensationStatus(values, hike).over).toBe(false);
    expect(compensationStatus(values, head).over).toBe(false);
  });
  it("detects head lowering independently of shoulder lift, and leaves hidden ears unmeasured", () => {
    const input = pose(); input.world[0].y += .05;
    const values = mouthCompensations(input, "right", reference, poseFrameValues(input, "right", reference).comps);
    expect(compensationStatus(values, head).over).toBe(true);
    expect(compensationStatus(values, hike).over).toBe(false);
    expect(compensationStatus(values, lean).over).toBe(false);
    input.landmarks[8].visibility = .1;
    expect(mouthCompensations(input, "right", reference, values).head_drop_deg).toBeUndefined();
  });
  it.each(["left", "right"] as Side[])("identifies affected shoulder lift without trunk/head flags (%s)", side => {
    const baseline = pose(); const input = pose(); input.world[poseJoints(side).shoulder].y -= .09;
    const values = poseFrameValues(input, side, geoFrom(baseline, side)).comps;
    expect(compensationStatus(values, hike).over).toBe(true);
    expect(compensationStatus(values, lean).over).toBe(false);
    expect(compensationStatus(values, head).over).toBe(false);
  });
});

function patient(side: Side = "right", suppliedVoice?: Voice, reps = 1) {
  const said: string[] = [];
  const session = new ExerciseSession({ exerciseId: "ex_h2m", rung: 1, side, repsOverride: reps, reviewBetweenReps: true }, suppliedVoice ?? { say: text => said.push(text), busy: () => false, stop() {} });
  let t = 0; session.start(t);
  const push = (options: { level?: number; contact?: boolean; comps?: Frame["comps"]; visible?: boolean; geo?: Geo } = {}) => {
    const snap = session.snapshot();
    const level = options.level ?? (snap.phase === "setup" || session.currentStep?.kind === "return" ? 0 : 1);
    const frame = simFrame(t += 50, session.cfg, session.targets(), { level, compensations: [], visible: options.visible });
    frame.geo = options.geo ?? reference;
    if (snap.phase === "warm" || snap.phase === "reps") frame.targetContact = options.contact ?? true;
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
  it.each(["left", "right"] as Side[])("keeps seated references and learns target-hold angles without an increment (%s)", side => {
    const p = patient(side); p.until(() => p.session.snapshot().phase === "demo");
    expect(p.session.lapPoint).toEqual({ x: .6, y: .8, bodyScale: .4 });
    expect(p.session.mouthPoint).toEqual({ x: .5, y: .3 });
    p.session.skipAhead(3000);
    const compensated = { ...reference, nosePitch: 30, shoulderTilt: 20 };
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
    p.push({ contact: false, level: 0 });
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
  it.each([["trunk_forward"], ["head_drop"], ["shoulder_hike"], ["trunk_forward", "head_drop"], ["head_drop", "shoulder_hike"]])("confirms sustained %j and gives fixed compensation points", (...expected) => {
    const p = scored();
    const values = Object.fromEntries(rules.map(rule => [rule.metric, expected.includes(rule.id) ? rule.thresholdDeg + 3 : 0]));
    p.until(() => p.session.currentStep?.kind === "return", { comps: values });
    p.until(() => p.session.snapshot().review === "complete");
    const result = p.session.snapshot().reps[0];
    expect(result.compensations.sort()).toEqual([...expected].sort());
    expect(result.score).toBe(expected.length === 1 ? 30 : 15);
    expect(p.session.snapshot().reviewAdvice.length).toBe(expected.length);
  });
  it("rejects brief compensation spikes and never labels wholly unmeasured posture as a good rep", () => {
    const p = scored();
    for (let n = 0; n < 3; n++) p.push({ comps: { face_approach_pct: 10, shoulder_hike_delta: 15, head_drop_deg: 20 } });
    p.until(() => p.session.snapshot().review === "complete");
    expect(p.session.snapshot().reps[0].compensations).toEqual([]);
    const unknown = scored(); unknown.until(() => unknown.session.currentStep?.kind === "return", { comps: {} });
    unknown.until(() => unknown.session.snapshot().review === "complete");
    expect(unknown.session.snapshot().reps[0].unmeasured).toEqual(["trunk_forward", "head_drop", "shoulder_hike"]);
    expect(unknown.session.snapshot().reps[0].good).toBe(false);
  });
  it("shows feedback for all six reps, separate countdowns, then the summary", () => {
    const p = scored("right", 6); let completionCount = 0, countdownCount = 0, previous = "";
    for (let n = 0; n < 2500 && p.session.snapshot().phase !== "done"; n++) {
      const snap = p.push(); const state = `${snap.review}:${snap.reps.length}`;
      if (state !== previous) { if (snap.review === "complete") completionCount++; if (snap.review === "countdown") countdownCount++; previous = state; }
    }
    expect(completionCount).toBe(6); expect(countdownCount).toBe(5);
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

it.each([false, true])("mouth demonstration waits for contact, holds for 1.5s and completes before returning (%s)", returning => {
  let contactAt = 0;
  for (; contactAt < 1200; contactAt++) if (mouthDemoState(contactAt, returning).contact) break;
  const atContact = mouthDemoState(contactAt, returning);
  const hand = mouthGhostPose(atContact.pose).wrist, target = mouthGhostPose(returning ? 0 : 1).wrist;
  expect(Math.hypot(hand[0] - target[0], hand[1] - target[1])).toBeLessThanOrEqual(16);
  expect(mouthDemoState(contactAt + 750, returning).progress).toBeCloseTo(.5, 2);
  expect(mouthDemoState(mouthDemoDuration(returning), returning).phase).toBe("complete");
  expect(mouthDemoState(10000, returning, false).progress).toBe(0);
});
