import { describe, expect, it } from "vitest";
import { EXERCISES, usesSeatedTargets, usesTargetFlow, type Side } from "./config";
import { compensationStatus, reachLapRest, type HandInput, type PoseInput, type Pt } from "./metrics";
import { seatedPose, type SeatedPosture } from "./mouth-target";
import { reachDemoState } from "./reach-demo";
import { exerciseScreenPreview } from "./screen-preview";
import { ExerciseSession, simFrame, type Snapshot } from "./session";
import { handOpenness, simulatedHand } from "./hand-target";
import {
  carryAcross, CupCarry, cupAxis, cupTipping, elbowOutDeg, graspDemoDuration, graspDemoState, graspFrame, graspGhostContact, graspGhostTarget,
  graspLayout, graspRings, GRASP_STEP, graspTarget, wristBendDeg, type GraspLayout,
} from "./grasp-target";
import { faceBox, judgeLighting, LightingProbe } from "./lighting";
import { metricUnit, reachAngleProgress } from "./calibration";

const ASPECT = 4 / 3;
const SIDES: Side[] = ["left", "right"];
const rule = (id: string) => EXERCISES.ex_grasp.compensations.find(item => item.id === id)!;
const joint = (side: Side) => ({ shoulder: side === "right" ? 12 : 11, other: side === "right" ? 11 : 12, elbow: side === "right" ? 14 : 13, wrist: side === "right" ? 16 : 15 });

// ---------- simulated landmarks ----------

/** A hand rolled about the camera's axis (degrees), around its wrist: -90 turns the default upright palm into a thumb-up grip. */
function rollHand(hand: HandInput, deg: number): HandInput {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const w0 = hand.landmarks[0];
  const landmarks = hand.landmarks.map(p => {
    const x = (p.x - w0.x) * ASPECT, y = p.y - w0.y;
    return { ...p, x: w0.x + (x * c - y * s) / ASPECT, y: w0.y + x * s + y * c };
  });
  const world = hand.world.map(p => ({ ...p, x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
  return { landmarks, world };
}

/** A hand whose palm centre sits at an image point (simulatedHand projects x = 0.5 + 0.75 X / Z, y = 0.5 + Y / Z). */
function handAt(side: Side, point: { x: number; y: number }, options: { open?: number; fist?: boolean; roll?: number } = {}): HandInput {
  const z = 0.9;
  const base = simulatedHand({ side, open: options.open ?? 0, fist: options.fist, at: [(point.x - 0.5) * z / 0.75, (point.y - 0.5) * z, z] });
  const rolled = rollHand(base, options.roll ?? -90);
  // Move it so its palm centre lands exactly on the point.
  const centre = [0, 5, 9, 13, 17].reduce((sum, i) => ({ x: sum.x + rolled.landmarks[i].x / 5, y: sum.y + rolled.landmarks[i].y / 5 }), { x: 0, y: 0 });
  return { landmarks: rolled.landmarks.map(p => ({ ...p, x: p.x + point.x - centre.x, y: p.y + point.y - centre.y })), world: rolled.world };
}

/** The seated body with the affected wrist on the hand's wrist and the forearm in line with the palm (or bent by wristBend degrees). */
function bodyWith(side: Side, posture: SeatedPosture, hand: HandInput | null, options: { wristBend?: number; elbowOut?: number } = {}): PoseInput {
  const pose = seatedPose(side, posture);
  if (!hand) return pose;
  const j = joint(side);
  const landmarks = pose.landmarks.map(p => ({ ...p }));
  const width = Math.abs(landmarks[j.shoulder].x - landmarks[j.other].x) * ASPECT;
  const w0 = hand.landmarks[0], m9 = hand.landmarks[9];
  let dx = (m9.x - w0.x) * ASPECT, dy = m9.y - w0.y;
  const n = Math.hypot(dx, dy) || 1;
  const bend = ((options.wristBend ?? 0) * Math.PI) / 180;
  [dx, dy] = [(dx * Math.cos(bend) - dy * Math.sin(bend)) / n, (dx * Math.sin(bend) + dy * Math.cos(bend)) / n];
  const forearm = 0.7 * width;
  landmarks[j.wrist] = { ...landmarks[j.wrist], x: w0.x, y: w0.y, z: 0 };
  landmarks[j.elbow] = { ...landmarks[j.elbow], x: w0.x - (dx * forearm) / ASPECT, y: w0.y - dy * forearm, z: 0 };
  if (options.elbowOut !== undefined) {
    // The elbow out to the side by this angle from straight down, a forearm's length from the shoulder.
    const s = landmarks[j.shoulder], out = Math.sign(s.x - landmarks[j.other].x), a = (options.elbowOut * Math.PI) / 180;
    landmarks[j.elbow] = { ...landmarks[j.elbow], x: s.x + (out * Math.sin(a) * 0.8 * width) / ASPECT, y: s.y + Math.cos(a) * 0.8 * width };
  }
  return { landmarks, world: pose.world };
}

const layoutFor = (side: Side) => graspLayout(seatedPose(side), side, ASPECT, 1)!;
const lapFor = (side: Side) => reachLapRest(seatedPose(side), side).lapRest!;

describe("Cylindrical Grasp and Transport layout and measures", () => {
  it("runs on the shared target flow, keeping Alira's level planning as it is", () => {
    expect(usesTargetFlow("ex_grasp")).toBe(true);
    expect(usesSeatedTargets("ex_grasp")).toBe(false);
    expect(EXERCISES.ex_grasp.compensations.map(item => item.id)).toEqual(["trunk_forward", "trunk_side_lean", "shoulder_hike", "elbow_out", "wrist_bend", "cup_tipping"]);
    expect(EXERCISES.ex_grasp.cycle.map(step => step.kind)).toEqual(["reach", "close", "reach", "open", "return"]);
  });
  it.each(SIDES)("puts the cup in front of the affected shoulder and the put-down circle across the midline (%s side)", side => {
    const pose = seatedPose(side), j = joint(side), layout = layoutFor(side);
    const s = pose.landmarks[j.shoulder], o = pose.landmarks[j.other];
    const out = Math.sign(s.x - o.x), mid = (s.x + o.x) / 2;
    expect((layout.pick.x - s.x) * out).toBeGreaterThan(0);
    expect((mid - layout.put.x) * out).toBeGreaterThan(0.25 * layout.width / ASPECT);
    expect(layout.pick.y).toBeGreaterThan(s.y);
    expect(layout.put.y).toBeCloseTo(layout.pick.y);
    // Level 3 puts it further across.
    expect((mid - graspLayout(pose, side, ASPECT, 3)!.put.x) * out).toBeGreaterThan((mid - layout.put.x) * out);
  });
  it.each(SIDES)("measures the carry across the body: 0 at the affected shoulder, 0.5 at the midline (%s side)", side => {
    const pose = seatedPose(side), j = joint(side), layout = layoutFor(side);
    const s = pose.landmarks[j.shoulder], o = pose.landmarks[j.other];
    expect(carryAcross({ x: s.x, y: 0.5 }, pose, side, ASPECT)).toBeCloseTo(0);
    expect(carryAcross({ x: (s.x + o.x) / 2, y: 0.5 }, pose, side, ASPECT)).toBeCloseTo(0.5);
    expect(carryAcross(layout.put, pose, side, ASPECT)!).toBeGreaterThan(0.75);
    expect(carryAcross(layout.pick, pose, side, ASPECT)!).toBeLessThan(0);
    // The whole body shifted sideways: a hand moving with it has not carried anything.
    const shift = 0.05, moved: PoseInput = { landmarks: pose.landmarks.map(p => ({ ...p, x: p.x + shift })), world: pose.world };
    expect(carryAcross({ x: layout.pick.x + shift, y: layout.pick.y }, moved, side, ASPECT)).toBeCloseTo(carryAcross(layout.pick, pose, side, ASPECT)!);
  });
  it.each(SIDES)("measures the elbow swinging out, not an arm hanging or carrying across (%s side)", side => {
    const hand = handAt(side, layoutFor(side).put, { fist: true });
    expect(elbowOutDeg(bodyWith(side, {}, hand, { elbowOut: 5 }), side, ASPECT)!).toBeLessThan(10);
    expect(elbowOutDeg(bodyWith(side, {}, hand, { elbowOut: 55 }), side, ASPECT)!).toBeGreaterThan(rule("elbow_out").thresholdDeg);
    expect(elbowOutDeg(bodyWith(side, {}, hand, { elbowOut: -30 }), side, ASPECT)!).toBeLessThan(0);
    // An upper arm pointing at the camera (short in the image) gives no value.
    expect(elbowOutDeg(bodyWith(side, {}, hand, { elbowOut: 55 }), side, ASPECT, 2)).toBeUndefined();
  });
  it.each(SIDES)("measures the wrist bending out of line with the forearm, not the grip itself (%s side)", side => {
    const point = layoutFor(side).put;
    for (const grip of [{ fist: true }, { open: 1 }]) {
      const hand = handAt(side, point, grip);
      expect(wristBendDeg(bodyWith(side, {}, hand), hand, side, ASPECT)!).toBeLessThan(3);
      expect(wristBendDeg(bodyWith(side, {}, hand, { wristBend: 35 }), hand, side, ASPECT)!).toBeCloseTo(35, 0);
    }
    // A hand away from the affected wrist is not measured against it.
    const hand = handAt(side, point, { fist: true });
    const body = bodyWith(side, {}, hand);
    const elsewhere = handAt(side, { x: point.x, y: point.y - 0.25 }, { fist: true });
    expect(wristBendDeg(body, elsewhere, side, ASPECT)).toBeUndefined();
  });
  it("measures the cup tipping from the grip, either way, whatever the hand's opening", () => {
    const point = layoutFor("right").pick;
    const grip = cupAxis(handAt("right", point, { fist: true }));
    expect(cupTipping(handAt("right", point, { fist: true }), grip)!).toBeLessThan(1);
    // A 30 degree tip either way is past the limit.
    for (const roll of [-60, -120]) expect(cupTipping(handAt("right", point, { fist: true, roll }), grip)!).toBeGreaterThan(rule("cup_tipping").thresholdDeg);
    // Moved across the body upright, it has not tipped.
    expect(cupTipping(handAt("right", layoutFor("right").put, { fist: true }), grip)!).toBeLessThan(3);
    // The hand turning about the vertical as it carries the cup across (yaw) is not tipping.
    const turned = (hand: HandInput, deg: number): HandInput => {
      const r = (deg * Math.PI) / 180;
      return { ...hand, world: hand.world.map(p => ({ ...p, x: p.x * Math.cos(r) + p.z * Math.sin(r), z: -p.x * Math.sin(r) + p.z * Math.cos(r) })) };
    };
    for (const yaw of [30, 60]) expect(cupTipping(turned(handAt("right", point, { fist: true }), yaw), grip)!).toBeLessThan(1);
    expect(cupTipping(handAt("right", point, { fist: true }), undefined)).toBeUndefined();
  });
  it("keeps the hand's thresholds in order: closed, then let go, then open", () => {
    const rings = graspRings(0.45, 1.1);
    expect(rings.close).toBeLessThan(rings.release);
    expect(rings.release).toBeLessThan(rings.open);
    expect(graspRings(undefined).rest).toBe(0.5);
    // A hand resting flat on the thigh (nearly open) anchors as a relaxed hand, and still closed is never as open as letting go.
    const flat = graspRings(1.0);
    expect(flat.rest).toBeLessThan(1.0);
    expect(flat.close).toBeLessThan(flat.release);
    const layout = layoutFor("right");
    for (const rings of [flat, graspRings(1.0, 1.05), graspRings(0.45, 1.1)]) {
      expect(graspTarget(GRASP_STEP.carry, layout.put, rings.release + 0.01, layout, rings, ASPECT).contact).toBe(false);
      expect(graspTarget(GRASP_STEP.carry, layout.put, rings.close, layout, rings, ASPECT).contact).toBe(true);
    }
  });
  it("scores a part of the carry across the body as a part, in shoulder widths", () => {
    const unit = metricUnit("carry_across");
    expect(reachAngleProgress(0.5, 1.0, 0.2, unit)).toBeCloseTo(0.375);
    expect(reachAngleProgress(1.0, 1.0, 0.2, unit)).toBe(1);
    expect(reachAngleProgress(0.2, 1.0, 0.2, unit)).toBe(0);
    // Angles are unchanged.
    expect(metricUnit("elbow_extension")).toBe(1);
  });
  it.each(SIDES)("is on each step's target only in the right place with the right hand (%s side)", side => {
    const layout = layoutFor(side), rings = graspRings(0.45, 1.1);
    const at = (step: number, point: { x: number; y: number }, hand: HandInput) => graspTarget(step, point, handOpenness(hand), layout, rings, ASPECT).contact;
    const open = (p: { x: number; y: number }) => handAt(side, p, { open: 1 }), closed = (p: { x: number; y: number }) => handAt(side, p, { fist: true });
    expect(at(GRASP_STEP.reach, layout.pick, open(layout.pick))).toBe(true);
    expect(at(GRASP_STEP.reach, layout.pick, closed(layout.pick))).toBe(false);
    expect(at(GRASP_STEP.reach, layout.put, open(layout.put))).toBe(false);
    expect(at(GRASP_STEP.grasp, layout.pick, closed(layout.pick))).toBe(true);
    expect(at(GRASP_STEP.grasp, layout.pick, open(layout.pick))).toBe(false);
    expect(at(GRASP_STEP.carry, layout.put, closed(layout.put))).toBe(true);
    // Opened before the put-down circle: the cup was dropped, not carried.
    expect(at(GRASP_STEP.carry, layout.put, open(layout.put))).toBe(false);
    expect(at(GRASP_STEP.release, layout.put, open(layout.put))).toBe(true);
    expect(at(GRASP_STEP.release, layout.put, closed(layout.put))).toBe(false);
  });
  it("draws the cup at the pick-up circle, in the hand while carried, and left at the put-down circle", () => {
    const layout = layoutFor("right"), cup = new CupCarry();
    const hand = handAt("right", layout.pick, { fist: true });
    expect(cup.update("reps:1", GRASP_STEP.reach, false, hand, layout.pick, layout).at).toEqual(layout.pick);
    cup.update("reps:1", GRASP_STEP.grasp, true, hand, layout.pick, layout);
    expect(cup.grip).toBeDefined();
    const moving = { x: (layout.pick.x + layout.put.x) / 2, y: layout.pick.y };
    expect(cup.update("reps:1", GRASP_STEP.carry, false, handAt("right", moving, { fist: true }), moving, layout)).toMatchObject({ at: moving, inHand: true });
    cup.update("reps:1", GRASP_STEP.release, true, handAt("right", layout.put, { open: 1 }), layout.put, layout);
    expect(cup.update("reps:1", GRASP_STEP.back, false, null, null, layout).at).toEqual(layout.put);
    // A new repetition starts with the cup back at the pick-up circle.
    expect(cup.update("reps:2", GRASP_STEP.reach, false, null, null, layout).at).toEqual(layout.pick);
  });
});

describe("Cylindrical Grasp and Transport demonstration and simulator", () => {
  it.each([0, 1, 2, 3, 4])("has the reach demonstration's states and fields (step %i)", step => {
    expect(Object.keys(graspDemoState(0, step, false)).sort()).toEqual(Object.keys(reachDemoState(0, false, false)).sort());
    expect(graspDemoState(0, step, false).instruction).toBe(reachDemoState(0, false, false).instruction);
    expect(graspDemoState(0, step).phase).toBe("move");
    expect(graspDemoState(graspDemoDuration(step) - 1, step).phase).toBe("complete");
    expect(graspGhostTarget(300, 270, step).radius).toBeGreaterThan(0);
    expect(graspGhostContact(1, step)).toBe(true);
    expect(graspGhostContact(0.2, step)).toBe(false);
  });
  it("previews the five steps' first and last, and the set-up checks with the lighting", () => {
    expect(exerciseScreenPreview("warm-reach", 1, "right", "ex_grasp").snapshot).toMatchObject({ kind: "reach", stepIndex: 0, stepCount: 5 });
    expect(exerciseScreenPreview("reps-return", 1, "right", "ex_grasp").snapshot).toMatchObject({ kind: "return", stepIndex: 4 });
    expect(exerciseScreenPreview("setup", 1, "right", "ex_grasp").bodyChecks.map(check => check.label)).toContain("Lighting");
  });
});

describe("lighting check", () => {
  const frame = (fill: (x: number, y: number) => number, width = 32, height = 24) => {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const v = fill(x, y), i = (y * width + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = v; pixels[i + 3] = 255; }
    return pixels;
  };
  const face = { x0: 0.4, y0: 0.2, x1: 0.6, y1: 0.5 };
  const textured = (base: number) => (x: number, y: number) => Math.max(0, Math.min(255, base + ((x * 7 + y * 13) % 9 - 4) * 12));
  it("passes an evenly lit room", () => {
    expect(judgeLighting(frame(textured(130)), 32, 24, face)).toMatchObject({ ok: true });
  });
  it("names what to fix: too dark, too bright, light from behind, washed out", () => {
    expect(judgeLighting(frame(textured(30)), 32, 24, face)).toMatchObject({ ok: false, issue: "dark" });
    expect(judgeLighting(frame(() => 252), 32, 24, null)).toMatchObject({ ok: false, issue: "bright" });
    const backlit = frame((x, y) => { const u = (x + 0.5) / 32, v = (y + 0.5) / 24; return u >= face.x0 && u <= face.x1 && v >= face.y0 && v <= face.y1 ? 70 : 235; });
    expect(judgeLighting(backlit, 32, 24, face)).toMatchObject({ ok: false, issue: "backlit" });
    expect(judgeLighting(frame(() => 128), 32, 24, face)).toMatchObject({ ok: false, issue: "flat" });
    expect(judgeLighting(frame(textured(30)), 32, 24, face).hint).toBe("It's a little dark. Turn on a light in front of you.");
  });
  it("holds its verdict through a tie, and carries on after enough poor light in all, even when it flickers", () => {
    const probe = new LightingProbe();
    const ok = judgeLighting(frame(textured(130)), 32, 24, face), dark = judgeLighting(frame(textured(30)), 32, 24, face);
    probe.add(dark); probe.add(dark);
    expect(probe.tick(0)?.issue).toBe("dark");
    probe.add(ok); probe.add(ok);
    // Two each way: still the verdict shown.
    expect(probe.tick(500)?.issue).toBe("dark");
    // Poor, good, poor... every second for a while: the poor stretches add up to the waiver.
    const flicker = new LightingProbe();
    let t = 0;
    for (let n = 0; n < 60 && !flicker.waived(); n++) {
      for (let k = 0; k < 4; k++) flicker.add(n % 2 ? ok : dark);
      for (let k = 0; k < 10; k++) { t += 100; flicker.tick(t); }
    }
    expect(flicker.waived()).toBe(true);
    expect(t).toBeLessThan(30000);
    flicker.reset();
    expect(flicker.waived()).toBe(false);
  });
  it("finds the face from the pose", () => {
    const box = faceBox(seatedPose("right"))!;
    expect(box.x1).toBeGreaterThan(box.x0);
    expect(box.y1).toBeGreaterThan(box.y0);
    expect(faceBox(null)).toBeNull();
  });
});

// ---------- a whole session from simulated camera landmarks, as the page drives it ----------

type Scored = { posture?: SeatedPosture; roll?: number; wristBend?: number; elbowOut?: number };
/** Per frame, during practice and repetitions: the hand model loses the hand, or the hand is open instead. */
type Tweak = (at: { phase: Snapshot["phase"]; step: number }) => { dropHand?: boolean; open?: boolean };

/** A patient who does each step once its circle is active, from simulated pose and hand landmarks. */
function cameraPatient(side: Side, scored: (step: number) => Scored = () => ({}), reps = 2, tweak?: Tweak) {
  const said: string[] = [];
  const session = new ExerciseSession({ exerciseId: "ex_grasp", rung: 1, side, repsOverride: reps, reviewBetweenReps: true }, { say: text => said.push(text), busy: () => false, stop() {} });
  const layout: GraspLayout = layoutFor(side);
  const lap = lapFor(side);
  const cup = new CupCarry();
  let t = 0;
  let last = { step: -1, done: GRASP_STEP.back };
  session.start(t);
  for (let n = 0; n < 12000 && session.snapshot().phase !== "done"; n++) {
    t += 50;
    const snap: Snapshot = session.snapshot();
    const live = (snap.phase === "warm" || snap.phase === "reps") && !snap.review;
    // Each step is done once its circle is active; until then the hand stays where the last step left it.
    if (live && snap.targetArmed) last = { step: snap.stepIndex, done: snap.stepIndex };
    const step = live ? last.done : GRASP_STEP.back;
    const extra = live && snap.phase === "reps" ? scored(step) : {};
    const point = step === GRASP_STEP.reach || step === GRASP_STEP.grasp ? layout.pick : step === GRASP_STEP.back ? { x: lap.x, y: lap.y - 0.03 } : layout.put;
    const change = live && tweak ? tweak({ phase: snap.phase, step }) : {};
    const open = change.open ?? (step === GRASP_STEP.reach || step === GRASP_STEP.release);
    const hand = handAt(side, point, open ? { open: 1, roll: extra.roll } : step === GRASP_STEP.back ? { open: 0 } : { fist: true, roll: extra.roll });
    const seen = change.dropHand ? null : hand;
    const pose = step === GRASP_STEP.back ? seatedPose(side, extra.posture) : bodyWith(side, extra.posture ?? {}, hand, { wristBend: extra.wristBend, elbowOut: extra.elbowOut });
    const frame = graspFrame({ pose, hands: seen ? [seen] : [] }, side, t, ASPECT, session.reference, { gripAxis: cup.grip });
    if (live) {
      if (snap.stepIndex === GRASP_STEP.back) {
        const wrist = pose.landmarks[joint(side).wrist];
        frame.targetContact = Math.hypot((wrist.x - lap.x) * ASPECT, wrist.y - lap.y) <= 0.12;
      } else {
        const rings = graspRings(session.restValues().hand_openness, snap.phase === "reps" ? session.learnedValue("hand_openness") : undefined);
        const target = graspTarget(snap.stepIndex, point, handOpenness(seen), layout, rings, ASPECT);
        frame.targetContact = target.contact;
        frame.targetProgress = target.progress;
      }
      cup.update(`${snap.phase}:${snap.repIndex}`, snap.stepIndex, frame.targetContact === true, seen, point, layout);
    }
    session.push(frame);
  }
  return { session, said };
}

describe("Cylindrical Grasp and Transport session from camera landmarks", () => {
  it.each(SIDES)("a clean repetition scores 100 with every check measured (%s side)", side => {
    const { session, said } = cameraPatient(side);
    const snap = session.snapshot();
    expect(snap.phase).toBe("done");
    expect(snap.record?.repetition_scores).toEqual([100, 100]);
    expect(snap.reps.every(rep => !rep.compensations.length && !rep.unmeasured?.length)).toBe(true);
    // Practice learned the reach, the opening and the carry.
    expect(session.learnedValue("hand_openness")).toBeGreaterThan(1);
    expect(session.learnedValue("carry_across")).toBeGreaterThan(0.7);
    // The full instructions are said once in practice; each scored repetition says only the short cues.
    const [reach, grasp, carry, release, back] = EXERCISES.ex_grasp.cycle;
    expect(said.filter(line => line === reach.voice)).toHaveLength(1);
    for (const step of [reach, grasp, carry, release, back]) expect(said.filter(line => line === step.cue)).toHaveLength(2);
  });
  it.each([
    ["trunk_forward", () => ({ posture: { trunkLeanDeg: 12 } })],
    ["shoulder_hike", () => ({ posture: { shoulderHikeM: 0.055 } })],
    ["cup_tipping", (step: number) => (step === GRASP_STEP.carry ? { roll: -55 } : {})],
    ["wrist_bend", (step: number) => (step === GRASP_STEP.carry ? { wristBend: 35 } : {})],
    ["elbow_out", (step: number) => (step === GRASP_STEP.carry ? { elbowOut: 60 } : {})],
  ] as const)("flags %s", (id, scored) => {
    for (const side of SIDES) {
      const reps = cameraPatient(side, scored).session.snapshot().reps;
      for (const rep of reps) expect(rep.compensations, side).toContain(id);
    }
  });
  it("keeps the grasp's hold through a closed hand the tracker loses for a moment", () => {
    let n = 0;
    const { session } = cameraPatient("right", () => ({}), 2, ({ phase, step }) => ({ dropHand: phase === "reps" && (step === GRASP_STEP.grasp || step === GRASP_STEP.release) && ++n % 5 === 0 }));
    const reps = session.snapshot().reps;
    expect(reps.map(rep => rep.hold)).toEqual(["full", "full"]);
    expect(session.snapshot().record?.repetition_scores).toEqual([100, 100]);
  });
  it("moves on from a practice grasp touched once but never held", () => {
    let closed = 0;
    const { session } = cameraPatient("right", () => ({}), 1, ({ phase, step }) => (phase === "warm" && step === GRASP_STEP.grasp ? { open: ++closed > 3 } : {}));
    expect(closed).toBeGreaterThan(3);
    expect(session.snapshot().phase).toBe("done");
    expect(session.snapshot().record?.repetition_scores).toEqual([100]);
  });
  it("judges the side lean on the whole trunk tilting sideways", () => {
    const rule0 = rule("trunk_side_lean");
    const upright = graspFrame({ pose: seatedPose("right"), hands: [] }, "right", 0, ASPECT, null);
    const lean = (degrees: number) => {
      const pose = seatedPose("right"), a = (degrees * Math.PI) / 180;
      pose.world = pose.world.map((p: Pt) => ({ ...p, x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) }));
      return graspFrame({ pose, hands: [] }, "right", 0, ASPECT, upright.geo!).comps;
    };
    expect(compensationStatus(lean(3), rule0).over).toBe(false);
    expect(compensationStatus(lean(12), rule0).over).toBe(true);
  });
  it("the no-camera simulator completes every step", () => {
    const session = new ExerciseSession({ exerciseId: "ex_grasp", rung: 1, side: "right", repsOverride: 1, reviewBetweenReps: true }, { say() {}, busy: () => false, stop() {} });
    session.start(0);
    for (let t = 50; t < 200000 && session.snapshot().phase !== "done"; t += 50) {
      const snap = session.snapshot(), live = snap.phase === "warm" || snap.phase === "reps";
      session.push({ ...simFrame(t, session.cfg, session.targets(), { level: live && snap.targetArmed ? 1 : 0, compensations: [] }), ...(live ? { targetContact: snap.targetArmed } : {}) });
    }
    expect(session.snapshot().record?.repetition_scores).toEqual([100]);
  });
});
