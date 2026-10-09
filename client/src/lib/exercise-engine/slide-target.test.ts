import { describe, expect, it } from "vitest";
import { EXERCISES, resolveExercise, usesSeatedTargets, usesTargetFlow, type Side } from "./config";
import { poseJoints, type LapRest, type PoseInput, type Pt } from "./metrics";
import { reachDemoState } from "./reach-demo";
import { ExerciseSession, simFrame, type Snapshot } from "./session";
import { exerciseScreenPreview } from "./screen-preview";
import {
  restCircle, slideCircle, slideDemoDuration, slideDemoState, slideFrame, slideGhostContact, slideGhostPose, slideGhostTarget,
  slideOutward, slideRestCheck, SlideTarget, SLIDE_EASE_MS, SLIDE_EASED_SPANS, SLIDE_PRACTICE_SPANS, SLIDE_RISE, type SlideGeo,
} from "./slide-target";

const ASPECT = 4 / 3;
const SIDES: Side[] = ["left", "right"];
const ID = "ex_wallslide";

// ---------- a seated patient, forearm resting beside the body, seen by a front camera ----------

type P3 = [number, number, number];
type Slide = {
  /** How far the hand has moved out along the slide (out to the side and 30 degrees forward), metres. */
  outM?: number;
  /** The hand lifted from its support, metres. */
  liftM?: number;
  /** Trunk leaning forward about the hips (negative: back), degrees. */
  leanDeg?: number;
  /** Trunk leaning toward the affected side, degrees. */
  sideDeg?: number;
  /** The affected shoulder hiked, metres. */
  hikeM?: number;
  /** The other hand moved from its thigh, metres (x toward the affected side, y up, z forward). */
  otherHand?: P3;
  /** The whole patient shifted sideways toward the affected side, metres. */
  shiftM?: number;
  /** Front camera height above the hips and distance from them, metres. */
  camera?: { y: number; z: number };
};

const SUPPORT_Y = 0.21, UPPER = 0.29, FORE = 0.26, SLIDE_FORWARD = Math.PI / 6;
const add = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: P3, k: number): P3 => [a[0] * k, a[1] * k, a[2] * k];
const length = (a: P3) => Math.hypot(a[0], a[1], a[2]);

/** The elbow between shoulder and hand (two-link arm), bending down and back: at rest it sits on the support under the shoulder. */
function elbowFor(shoulder: P3, hand: P3): P3 {
  const toHand = sub(hand, shoulder), d = Math.min(length(toHand), UPPER + FORE - 1e-6);
  const axis = scale(toHand, 1 / (length(toHand) || 1));
  const a = (UPPER * UPPER - FORE * FORE + d * d) / (2 * d), h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));
  const bend: P3 = [0, -1, -1];
  const dot = bend[0] * axis[0] + bend[1] * axis[1] + bend[2] * axis[2];
  const pole = sub(bend, scale(axis, dot));
  return add(add(shoulder, scale(axis, a)), scale(pole, h / (length(pole) || 1)));
}

/** MediaPipe-style landmarks: x to the patient's left, y up, z toward the camera, hips at the origin. */
function slideBody(side: Side, s: Slide = {}): PoseInput {
  const camera = s.camera ?? { y: 0.35, z: 1.3 };
  const a = side === "right" ? -1 : 1; // the affected side's x sign
  const j = poseJoints(side);
  const p: P3[] = Array.from({ length: 33 }, () => [0, 0, 0] as P3);
  const set = (index: number, point: P3) => { p[index] = point; };
  set(0, [0, 0.62, 0.1]);
  [[1, 0.015, 0.085], [2, 0.03, 0.08], [3, 0.045, 0.075]].forEach(([i, x, z]) => { set(i, [x, 0.655, z]); set(i + 3, [-x, 0.655, z]); });
  set(7, [0.075, 0.64, 0]); set(8, [-0.075, 0.64, 0]); set(9, [0.025, 0.585, 0.09]); set(10, [-0.025, 0.585, 0.09]);
  set(23, [0.1, 0, 0]); set(24, [-0.1, 0, 0]); set(25, [0.1, 0.02, 0.45]); set(26, [-0.1, 0.02, 0.45]);
  set(27, [0.1, -0.4, 0.45]); set(28, [-0.1, -0.4, 0.45]); set(29, [0.1, -0.45, 0.4]); set(30, [-0.1, -0.45, 0.4]); set(31, [0.1, -0.45, 0.55]); set(32, [-0.1, -0.45, 0.55]);
  // The affected arm: the hand resting forward of the elbow on its support, moving out and a little forward.
  const shoulder: P3 = [a * 0.18, 0.5 + (s.hikeM ?? 0), 0];
  const out = s.outM ?? 0;
  const hand: P3 = [a * (0.2 + out * Math.cos(SLIDE_FORWARD)), SUPPORT_Y + (s.liftM ?? 0), 0.26 + out * Math.sin(SLIDE_FORWARD)];
  set(j.shoulder, shoulder); set(j.shoulderOther, [-a * 0.18, 0.5, 0]);
  set(j.elbow, elbowFor(shoulder, hand)); set(j.wrist, hand);
  // The other arm, its hand resting on its thigh (or moved).
  const move = s.otherHand ?? [0, 0, 0];
  set(poseJoints(side === "right" ? "left" : "right").elbow, [-a * 0.2, 0.25, 0.05]);
  set(j.wristOther, [-a * 0.15 + a * move[0], 0.07 + move[1], 0.3 + move[2]]);
  const hands = (wristIndex: number, w: P3) => { const off = wristIndex % 2 ? 0 : 1; [17, 19, 21].forEach((base, k) => set(base + off, [w[0] + 0.01 * (k - 1), w[1] - 0.01, w[2] + 0.06])); };
  hands(j.wrist, hand); hands(j.wristOther, p[j.wristOther]);
  // Trunk lean forward and sideways about the hips (the whole upper body with both arms).
  const lean = ((s.leanDeg ?? 0) * Math.PI) / 180, sideways = ((s.sideDeg ?? 0) * Math.PI) / 180;
  for (let i = 0; i <= 22; i++) {
    let [x, y, z] = p[i];
    [y, z] = [y * Math.cos(lean) - z * Math.sin(lean), y * Math.sin(lean) + z * Math.cos(lean)];
    [x, y] = [x * Math.cos(sideways) + a * y * Math.sin(sideways), -a * x * Math.sin(sideways) + y * Math.cos(sideways)];
    p[i] = [x, y, z];
  }
  const shift = a * (s.shiftM ?? 0);
  const landmarks: Pt[] = [], world: Pt[] = [];
  for (const [x, y, z] of p) {
    const depth = camera.z - z;
    landmarks.push({ x: 0.5 + 0.75 * (x + shift) / depth, y: 0.5 - (y - camera.y) / depth, z: -0.75 * z / camera.z, visibility: 1 });
    world.push({ x, y: -y, z: -z, visibility: 1 });
  }
  return { landmarks, world };
}

/** A frame against the set-up reference taken from the resting posture. */
function measured(side: Side, s: Slide = {}) {
  const rest = slideFrame({ pose: slideBody(side) }, side, 0, ASPECT, null);
  return slideFrame({ pose: slideBody(side, s) }, side, 50, ASPECT, rest.geo as SlideGeo);
}
const restOf = (side: Side): LapRest => slideRestCheck(slideBody(side), side, ASPECT).lapRest!;
const wristOf = (side: Side, s: Slide = {}) => { const w = slideBody(side, s).landmarks[poseJoints(side).wrist]; return { x: w.x, y: w.y }; };

describe("Supported Arm Elevation set-up and measures", () => {
  it("runs on the shared target flow, keeping Alira's level planning as it is; the armrest drops the hand-lift check", () => {
    expect(usesTargetFlow(ID)).toBe(true);
    expect(usesSeatedTargets(ID)).toBe(false);
    expect(EXERCISES[ID].compensations.map(item => item.id)).toEqual(["trunk_forward", "shoulder_hike", "side_lean", "hand_lift", "other_hand"]);
    expect(EXERCISES[ID].cycle.map(step => step.kind)).toEqual(["reach", "return"]);
    const armrest = resolveExercise(ID, false, true);
    expect(armrest.compensations.map(item => item.id)).toEqual(["trunk_forward", "shoulder_hike", "side_lean", "other_hand"]);
    expect(armrest.feedback.some(rule => rule.comp === "hand_lift")).toBe(false);
    expect(resolveExercise(ID, false, false).compensations).toHaveLength(5);
  });
  it.each(SIDES)("learns the resting hand from a camera above it, and says what to fix (%s side)", side => {
    const pose = slideBody(side);
    const rest = slideRestCheck(pose, side, ASPECT);
    expect(rest.lapMissing).toBeUndefined();
    expect(rest.lapRest).toMatchObject(wristOf(side));
    // A camera well below the support (it sees the forearm from underneath).
    expect(slideRestCheck(slideBody(side, { camera: { y: 0.05, z: 1.6 } }), side, ASPECT).lapMissing).toBe("Raise the camera to chest height, above your forearm.");
    // The forearm not resting beside the body (the hand down by the lap).
    expect(slideRestCheck(slideBody(side, { liftM: -0.2 }), side, ASPECT).lapMissing).toMatch(/table beside you or on the armrest/);
    // The other hand off its thigh.
    expect(slideRestCheck(slideBody(side, { otherHand: [0, 0.3, 0] }), side, ASPECT).lapMissing).toBe("Rest your other hand on your thigh.");
    // Sitting too far toward the affected side: no room beside the arm for the cup.
    expect(slideRestCheck(slideBody(side, { shiftM: 0.22 }), side, ASPECT).lapMissing).toMatch(/room beside your arm for the cup/);
  });
  it.each(SIDES)("measures the hand moving out across the picture, in shoulder widths (%s side)", side => {
    expect(measured(side).values.slide_out!).toBeCloseTo(0, 5);
    const values = [0.05, 0.12, 0.2, 0.28].map(outM => measured(side, { outM }).values.slide_out!);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1] + 0.15);
    expect(values[2]).toBeGreaterThan(SLIDE_PRACTICE_SPANS);
    // The shoulder elevates too.
    expect(measured(side, { outM: 0.2 }).values.shoulder_flexion!).toBeGreaterThan(measured(side).values.shoulder_flexion! + 10);
    expect(slideOutward(slideBody(side), side)).toBe(side === "right" ? -1 : 1);
  });
  it.each(SIDES)("a clean movement out to the cup trips none of the checks (%s side)", side => {
    for (const outM of [0.08, 0.16, 0.24]) {
      const comps = measured(side, { outM }).comps;
      expect(comps.trunk_approach_pct ?? 0).toBeLessThan(1);
      expect(comps.trunk_side_lean_delta ?? 0).toBeLessThan(1);
      expect(comps.shoulder_hike_rel_delta ?? 0).toBeLessThan(1);
      expect(comps.hand_lift_pct).toBe(0);
      expect(comps.other_hand_pct!).toBeLessThan(60);
    }
  });
  it.each(SIDES)("measures each compensation (%s side)", side => {
    expect(measured(side, { outM: 0.15, leanDeg: 12 }).comps.trunk_approach_pct!).toBeGreaterThan(6);
    expect(measured(side, { outM: 0.15, sideDeg: 10 }).comps.trunk_side_lean_delta!).toBeGreaterThan(8);
    expect(measured(side, { outM: 0.15, hikeM: 0.06 }).comps.shoulder_hike_rel_delta!).toBeGreaterThan(7);
    expect(measured(side, { outM: 0.15, liftM: 0.06 }).comps.hand_lift_pct!).toBeGreaterThan(13);
    expect(measured(side, { outM: 0.12, otherHand: [0.32, 0.14, 0.1] }).comps.other_hand_pct!).toBeGreaterThan(100);
    expect(measured(side, { otherHand: [0, 0.2, 0] }).comps.other_hand_pct!).toBeGreaterThan(100);
  });
  it("keeps the measures unmeasured when the hand is out of view", () => {
    const rest = slideFrame({ pose: slideBody("right") }, "right", 0, ASPECT, null);
    const pose = slideBody("right");
    pose.landmarks[poseJoints("right").wrist] = { ...pose.landmarks[poseJoints("right").wrist], visibility: 0.1 };
    const frame = slideFrame({ pose }, "right", 50, ASPECT, rest.geo as SlideGeo);
    expect(frame.visible).toBe(false);
    expect(frame.comps.hand_lift_pct).toBeUndefined();
    expect(frame.values.slide_out).toBeUndefined();
  });
});

describe("Supported Arm Elevation targets", () => {
  it.each(SIDES)("puts the cup out from the resting hand, away from the body, and its resting circle apart from it (%s side)", side => {
    const rest = restOf(side), out = slideOutward(slideBody(side), side)!;
    const cup = slideCircle(rest, out, SLIDE_PRACTICE_SPANS, ASPECT), home = restCircle(rest, SLIDE_PRACTICE_SPANS);
    expect((cup.x - rest.x) * out).toBeGreaterThan(0);
    expect(cup.y).toBe(rest.y);
    expect(Math.hypot((cup.x - home.x) * ASPECT, cup.y - home.y)).toBeGreaterThan(cup.radius + home.radius);
  });
  it.each([SLIDE_PRACTICE_SPANS, SLIDE_EASED_SPANS, 0.15])("keeps the cup's circle apart from the resting circle %s shoulder widths out, level or raised", spans => {
    const rest = restOf("right");
    for (const rise of [SLIDE_RISE.table, SLIDE_RISE.armrest]) {
      const cup = slideCircle(rest, -1, spans, ASPECT, rise), home = restCircle(rest, spans, rise);
      expect(Math.hypot((cup.x - home.x) * ASPECT, cup.y - home.y), `rise ${rise}`).toBeGreaterThan(cup.radius + home.radius);
    }
  });
  it.each(SIDES)("is on the cup only with the hand out at it, and holds through a small wobble (%s side)", side => {
    const rest = restOf(side), out = slideOutward(slideBody(side), side)!;
    const target = new SlideTarget();
    const at = (outM: number, t = 0) => target.update("reps:1:0", { hand: wristOf(side, { outM }), rest, out, aspect: ASPECT, spans: SLIDE_PRACTICE_SPANS, returning: false, armed: true, practice: false, t });
    expect(at(0).contact).toBe(false);
    expect(at(0.06).contact).toBe(false);
    const reaching = [0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2].map(outM => at(outM));
    expect(reaching.some(result => result.contact)).toBe(true);
    expect(reaching[0].progress).toBeLessThan(reaching[4].progress);
    // A hand that went well past the cup is not on it.
    expect(at(0.4).contact).toBe(false);
  });
  it.each(SIDES)("is back once the hand is in its resting circle, never while it is still out (%s side)", side => {
    const rest = restOf(side), out = slideOutward(slideBody(side), side)!;
    const back = (outM: number) => new SlideTarget().update("reps:1:1", { hand: wristOf(side, { outM }), rest, out, aspect: ASPECT, spans: SLIDE_PRACTICE_SPANS, returning: true, armed: true, practice: false, t: 0 }).contact;
    for (const outM of [0.1, 0.16, 0.24]) expect(back(outM), `${outM}`).toBe(false);
    for (const outM of [0, 0.01]) expect(back(outM), `${outM}`).toBe(true);
  });
  it("brings a practice cup closer when it is not reached for a while, or after the hand last left it", () => {
    const rest = restOf("right"), out = -1;
    const target = new SlideTarget();
    const practice = (t: number, outM: number) => target.update("warm:0:0", { hand: wristOf("right", { outM }), rest, out, aspect: ASPECT, spans: SLIDE_PRACTICE_SPANS, returning: false, armed: true, practice: true, t });
    expect(practice(0, 0.03)).toMatchObject({ contact: false, spans: SLIDE_PRACTICE_SPANS });
    expect(practice(SLIDE_EASE_MS - 1, 0.03).eased).toBe(false);
    expect(practice(SLIDE_EASE_MS + 1, 0.03)).toMatchObject({ eased: true, spans: SLIDE_EASED_SPANS });
    // Touched once, then the hand dropped back: eased 12 s after that touch.
    const again = new SlideTarget();
    const step = (t: number, outM: number) => again.update("warm:0:0", { hand: wristOf("right", { outM }), rest, out, aspect: ASPECT, spans: SLIDE_PRACTICE_SPANS, returning: false, armed: true, practice: true, t });
    const touched = [0.1, 0.12, 0.14, 0.16].map((outM, i) => step(i * 50, outM)).some(result => result.contact);
    expect(touched).toBe(true);
    expect(step(1000, 0.03).eased).toBe(false);
    expect(step(1000 + SLIDE_EASE_MS, 0.03).eased).toBe(true);
  });
});

// ---------- a whole session from simulated camera landmarks, as the page drives it ----------

const rule = (id: string) => EXERCISES[ID].compensations.find(item => item.id === id)!;

/**
 * A patient who moves the hand out once the cup's circle is active, at `speed` metres per second, and stops on
 * reaching it (as people do at a cup); then brings it back to rest. `scored` adds a posture during the scored
 * movements out; `between` moves the other hand between repetitions; `backTo` is where the hand comes back to.
 */
function cameraPatient(side: Side, options: { scored?: Slide; reps?: number; speed?: number; backTo?: number; between?: P3; frames?: number; armrest?: boolean } = {}) {
  const said: string[] = [];
  const session = new ExerciseSession({ exerciseId: ID, rung: 1, side, repsOverride: options.reps ?? 2, reviewBetweenReps: true, armrest: options.armrest }, { say: text => said.push(text), busy: () => false, stop() {} });
  const target = new SlideTarget();
  let t = 0, outM = 0, practiceSpans: number | null = null, onTarget = false;
  session.start(t);
  for (let n = 0; n < (options.frames ?? 20000) && session.snapshot().phase !== "done"; n++) {
    t += 50;
    const snap: Snapshot = session.snapshot();
    const live = (snap.phase === "warm" || snap.phase === "reps") && !snap.review;
    const returning = snap.kind === "return";
    const want = !live || !snap.targetArmed ? outM : returning ? options.backTo ?? 0 : onTarget ? outM : 0.35;
    outM += Math.sign(want - outM) * Math.min(Math.abs(want - outM), (options.speed ?? 0.15) * 0.05);
    const scored = snap.phase === "reps" && !returning && live ? options.scored ?? {} : {};
    const otherHand = snap.phase === "reps" && snap.repIndex >= 2 ? options.between : undefined;
    // From the armrest the arm lifts as it moves out (toward the cup, which sits out and a little up).
    const pose = slideBody(side, { outM, otherHand, ...(options.armrest ? { liftM: 0.5 * outM } : {}), ...scored });
    const frame = slideFrame({ pose }, side, t, ASPECT, session.reference);
    onTarget = false;
    if (live && session.lapPoint) {
      const spans = snap.phase === "reps" ? practiceSpans ?? SLIDE_PRACTICE_SPANS : SLIDE_PRACTICE_SPANS;
      const out = slideOutward(slideBody(side), side)!;
      const wrist = pose.landmarks[poseJoints(side).wrist];
      const rise = options.armrest ? SLIDE_RISE.armrest : SLIDE_RISE.table;
      const result = target.update(`${snap.phase}:${snap.repIndex}:${snap.stepIndex}`, { hand: { x: wrist.x, y: wrist.y }, rest: session.lapPoint, out, aspect: ASPECT, spans, rise, returning, armed: snap.targetArmed, practice: snap.phase === "warm", t });
      if (snap.phase === "warm" && !returning) practiceSpans = result.spans;
      frame.targetContact = frame.visible && result.contact;
      frame.targetProgress = frame.targetContact ? 1 : Math.max(0, Math.min(0.98, result.progress));
      onTarget = result.contact && !returning;
    }
    session.push(frame);
  }
  return { session, said };
}

describe("Supported Arm Elevation session from camera landmarks", () => {
  it.each(SIDES)("a clean movement out to the cup scores 100 with every check measured (%s side)", side => {
    const { session, said } = cameraPatient(side);
    const snap = session.snapshot();
    expect(snap.phase).toBe("done");
    expect(snap.record?.repetition_scores).toEqual([100, 100]);
    expect(snap.reps.every(rep => !rep.compensations.length && !rep.unmeasured?.length)).toBe(true);
    expect(session.learnedValue("slide_out")).toBeGreaterThan(0.25);
    const [slide, back] = EXERCISES[ID].cycle;
    expect(said.filter(line => line === slide.voice)).toHaveLength(1);
    for (const step of [slide, back]) expect(said.filter(line => line === step.cue)).toHaveLength(2);
    expect(said).not.toContain(EXERCISES[ID].speedCue!.lift);
  });
  it.each([
    ["trunk_forward", { leanDeg: 12 }],
    ["shoulder_hike", { hikeM: 0.06 }],
    ["side_lean", { sideDeg: 11 }],
    ["hand_lift", { liftM: 0.06 }],
    ["other_hand", { otherHand: [0.32, 0.14, 0.1] as P3 }],
  ] as const)("flags %s", (id, scored) => {
    for (const side of SIDES) {
      const reps = cameraPatient(side, { scored }).session.snapshot().reps;
      for (const rep of reps) expect(rep.compensations, side).toContain(id);
    }
  });
  it.each(SIDES)("from the armrest the arm lifts out to a cup a little higher, and lifting is the movement, not a compensation (%s side)", side => {
    const { session, said } = cameraPatient(side, { armrest: true });
    expect(session.cfg.compensations.map(comp => comp.id)).not.toContain("hand_lift");
    expect(session.snapshot().record?.repetition_scores).toEqual([100, 100]);
    // Spoken for the armrest: lift from it, never slide along a table.
    const [lift] = resolveExercise(ID, false, true).cycle;
    expect(said).toContain(lift.voice);
    expect(said).not.toContain(EXERCISES[ID].cycle[0].voice);
    expect(said.filter(line => /\btable\b/.test(line))).toEqual([]);
    // The same lift along a table is flagged.
    const table = cameraPatient(side, { scored: { liftM: 0.08 } }).session.snapshot().reps;
    for (const rep of table) expect(rep.compensations).toContain("hand_lift");
  });
  it("puts the armrest's cup out and a little up, the table's level", () => {
    const rest = restOf("right");
    const level = slideCircle(rest, -1, SLIDE_PRACTICE_SPANS, ASPECT, SLIDE_RISE.table), raised = slideCircle(rest, -1, SLIDE_PRACTICE_SPANS, ASPECT, SLIDE_RISE.armrest);
    expect(level.y).toBe(rest.y);
    expect(raised.y).toBeLessThan(rest.y - 0.2 * SLIDE_PRACTICE_SPANS * rest.bodyScale);
    expect(raised.x).toBe(level.x);
  });
  it("does not count the way back while the hand stays out at the cup", () => {
    const { session } = cameraPatient("right", { backTo: 0.2, frames: 1200 + 2400 });
    expect(session.snapshot()).toMatchObject({ phase: "warm", kind: "return", targetArmed: true, inZone: false });
    expect(session.snapshot().reps).toHaveLength(0);
  });
  it("judges the other hand from where it rests as each movement starts, even with the hand not quite back", () => {
    const moved: P3 = [0.1, 0.2, 0.05];
    expect(measured("right", { otherHand: moved }).comps.other_hand_pct!).toBeGreaterThan(100);
    const reps = cameraPatient("right", { reps: 3, backTo: 0.01, between: moved }).session.snapshot().reps;
    expect(reps.map(rep => rep.compensations)).toEqual([[], [], []]);
  });
  it("reminds a patient who flings the hand out to move slowly, without lowering the score", () => {
    const { session, said } = cameraPatient("left", { speed: 0.7 });
    expect(said).toContain(EXERCISES[ID].speedCue!.lift);
    expect(session.snapshot().record?.repetition_scores).toEqual([100, 100]);
  });
  it("previews its screens with its own checks and wording", () => {
    const setup = exerciseScreenPreview("setup", 1, "right", ID);
    expect(setup.bodyChecks.map(check => check.label)).toContain("Forearm resting, room for the cup");
    expect(setup.snapshot.prompt).toMatch(/\btable\b/);
    expect(exerciseScreenPreview("setup", 1, "right", ID, true).snapshot.prompt).toMatch(/armrest/);
    expect(exerciseScreenPreview("setup", 1, "right", ID, true).snapshot.prompt).not.toMatch(/\btable\b/);
    expect(exerciseScreenPreview("results", 1, "right", ID).snapshot.record?.compensation_counts).toEqual({ trunk_forward: 2, shoulder_hike: 1 });
    expect(exerciseScreenPreview("reps-return", 1, "right", ID).snapshot).toMatchObject({ kind: "return", stepIndex: 1, stepCount: 2 });
  });
  it("the no-camera simulator completes every step", () => {
    const session = new ExerciseSession({ exerciseId: ID, rung: 1, side: "right", repsOverride: 1, reviewBetweenReps: true }, { say() {}, busy: () => false, stop() {} });
    session.start(0);
    let level = 0;
    for (let t = 50; t < 200000 && session.snapshot().phase !== "done"; t += 50) {
      const snap = session.snapshot(), live = snap.phase === "warm" || snap.phase === "reps";
      const want = live && snap.targetArmed && snap.kind === "reach" && snap.holdProgress < 1 ? 1 : 0;
      level += Math.sign(want - level) * Math.min(Math.abs(want - level), 0.04);
      const frame = simFrame(t, session.cfg, session.targets(), { level, compensations: [] });
      if (live) frame.targetContact = slideGhostContact(level, snap.kind === "return");
      session.push(frame);
    }
    expect(session.snapshot().record?.repetition_scores).toEqual([100]);
  });
  it("names its threshold units as the other checks do", () => {
    expect(rule("hand_lift").unit).toBe("%");
    expect(rule("other_hand").thresholdDeg).toBe(100);
  });
});

describe("Supported Arm Elevation demonstration", () => {
  it.each([false, true])("has the reach demonstration's states and fields (returning=%s)", returning => {
    expect(Object.keys(slideDemoState(0, returning, false)).sort()).toEqual(Object.keys(reachDemoState(0, returning, false)).sort());
    expect(slideDemoState(0, returning, false).instruction).toBe(reachDemoState(0, returning, false).instruction);
    expect(slideDemoState(0, returning).phase).toBe("move");
    expect(slideDemoState(slideDemoDuration(returning) - 1, returning).phase).toBe("complete");
    expect(slideGhostContact(1, false)).toBe(true); expect(slideGhostContact(0, true)).toBe(true);
    expect(slideGhostContact(0.5, false)).toBe(false); expect(slideGhostContact(0.5, true)).toBe(false);
  });
  it("waits for the ghost's hand to reach the cup, holds for 1.5 s, and its circles are apart", () => {
    let contactAt = 0;
    for (; contactAt < 1400; contactAt++) if (slideDemoState(contactAt, false).contact) break;
    const state = slideDemoState(contactAt, false);
    const hand = slideGhostPose(state.pose).hand, cup = slideGhostPose(1).hand;
    expect(Math.hypot(hand[0] - cup[0], hand[1] - cup[1])).toBeLessThanOrEqual(state.radius);
    expect(slideDemoState(contactAt + 750, false).progress).toBeCloseTo(0.5, 2);
    const out = slideGhostTarget(300, 270, false), home = slideGhostTarget(300, 270, true);
    expect(out.x - home.x).toBeGreaterThan(2 * out.radius);
  });
  it("shows the arm on the patient's own side of the mirrored picture", () => {
    for (const returning of [false, true]) {
      const right = slideGhostTarget(300, 270, returning, { side: "right" }), left = slideGhostTarget(300, 270, returning, { side: "left" });
      expect(right.x).toBeGreaterThan(150);
      expect(left.x).toBeLessThan(150);
      expect(left.x + right.x).toBeCloseTo(300, 6);
      expect(left.y).toBe(right.y);
    }
    // The cup is further out than the resting place on either side.
    const leftCup = slideGhostTarget(300, 270, false, { side: "left" }), leftRest = slideGhostTarget(300, 270, true, { side: "left" });
    expect(leftRest.x - leftCup.x).toBeGreaterThan(2 * leftCup.radius);
  });
  it("slides the ghost's hand level along a table, and lifts it a little from the armrest", () => {
    const rest = slideGhostTarget(300, 270, true), table = slideGhostTarget(300, 270, false), armrest = slideGhostTarget(300, 270, false, { armrest: true });
    expect(table.y).toBe(rest.y);
    expect(armrest.y).toBeLessThan(rest.y);
    expect(armrest.x).toBe(table.x);
    expect(slideDemoState(0, false, true, true).instruction).toMatch(/lift/);
    expect(slideDemoState(0, false, true, false).instruction).toMatch(/slide/);
    expect(slideDemoState(slideDemoDuration(false, true) - 1, false, true, true).phase).toBe("complete");
  });
});
