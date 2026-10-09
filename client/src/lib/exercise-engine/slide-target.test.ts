import { describe, expect, it } from "vitest";
import { EXERCISES, usesSeatedTargets, usesTargetFlow, type Side } from "./config";
import { poseJoints, type PoseInput, type Pt } from "./metrics";
import { reachDemoState } from "./reach-demo";
import { ExerciseSession, simFrame, type Snapshot } from "./session";
import { exerciseScreenPreview } from "./screen-preview";
import {
  dialHand, DIAL_GOAL_DEG, slideDemoDuration, slideDemoState, slideDial, slideFrame, slideGhostContact, slideGhostPose, slideGhostTarget,
  slidePracticeGoal, slideRestCheck, SlideTarget, SLIDE_EASE_MS, type SlideGeo,
} from "./slide-target";

const ASPECT = 4 / 3;
const SIDES: Side[] = ["left", "right"];

// ---------- a seated patient beside a table, forearm on a towel, seen by a front camera ----------

type P3 = [number, number, number];
export type Slide = {
  /** The affected shoulder's elevation (degrees from hanging down), the forearm resting on the table. */
  shoulderDeg?: number;
  /** The hand lifted off the table, metres. */
  liftM?: number;
  /** Trunk leaning forward about the hips (negative: back), degrees. */
  leanDeg?: number;
  /** Trunk leaning toward the affected side, degrees. */
  sideDeg?: number;
  /** The affected shoulder hiked, metres. */
  hikeM?: number;
  /** The other hand moved from its thigh, metres (x toward the affected side, y up, z forward). */
  otherHand?: P3;
  /** Front camera height above the hips and distance from them, metres. */
  camera?: { y: number; z: number };
};

const TABLE_Y = 0.21, UPPER = 0.29, FORE = 0.26;

/** MediaPipe-style landmarks of the seated patient: x to the patient's left, y up, z toward the camera, hips at the origin. */
export function slideBody(side: Side, s: Slide = {}): PoseInput {
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
  // The affected arm: the shoulder (hiked), the elbow out in front as the shoulder elevates, the hand on the table.
  const shoulder: P3 = [a * 0.18, 0.5 + (s.hikeM ?? 0), 0];
  const angle = ((s.shoulderDeg ?? 0) * Math.PI) / 180;
  const elbow: P3 = [a * 0.2, shoulder[1] - UPPER * Math.cos(angle), UPPER * Math.sin(angle)];
  const handY = TABLE_Y + (s.liftM ?? 0);
  const wrist: P3 = [a * 0.2, handY, elbow[2] + Math.sqrt(Math.max(0, FORE * FORE - (elbow[1] - handY) ** 2))];
  set(j.shoulder, shoulder); set(j.shoulderOther, [-a * 0.18, 0.5, 0]);
  set(j.elbow, elbow); set(j.wrist, wrist);
  // The other arm, its hand resting on its thigh (or moved).
  const move = s.otherHand ?? [0, 0, 0];
  set(poseJoints(side === "right" ? "left" : "right").elbow, [-a * 0.2, 0.25, 0.05]);
  set(j.wristOther, [-a * 0.15 + a * move[0], 0.07 + move[1], 0.3 + move[2]]);
  // Hand points beside each wrist (pinky, index, thumb: 17-22, odd left and even right).
  const hands = (wristIndex: number, w: P3) => { const off = wristIndex % 2 ? 0 : 1; [17, 19, 21].forEach((base, k) => set(base + off, [w[0] + 0.01 * (k - 1), w[1] - 0.01, w[2] + 0.06])); };
  hands(j.wrist, wrist); hands(j.wristOther, p[j.wristOther]);
  // Trunk lean forward and sideways about the hips (the whole upper body with both arms).
  const lean = ((s.leanDeg ?? 0) * Math.PI) / 180, sideways = ((s.sideDeg ?? 0) * Math.PI) / 180;
  for (let i = 0; i <= 22; i++) {
    let [x, y, z] = p[i];
    [y, z] = [y * Math.cos(lean) - z * Math.sin(lean), y * Math.sin(lean) + z * Math.cos(lean)];
    [x, y] = [x * Math.cos(sideways) + a * y * Math.sin(sideways), -a * x * Math.sin(sideways) + y * Math.cos(sideways)];
    p[i] = [x, y, z];
  }
  const landmarks: Pt[] = [], world: Pt[] = [];
  for (const [x, y, z] of p) {
    const depth = camera.z - z;
    landmarks.push({ x: 0.5 + 0.75 * x / depth, y: 0.5 - (y - camera.y) / depth, z: -0.75 * z / camera.z, visibility: 1 });
    world.push({ x, y: -y, z: -z, visibility: 1 });
  }
  return { landmarks, world };
}

/** A frame against the set-up reference taken from the resting posture. */
function measured(side: Side, s: Slide = {}) {
  const rest = slideFrame({ pose: slideBody(side) }, side, 0, ASPECT, null);
  return slideFrame({ pose: slideBody(side, s) }, side, 50, ASPECT, rest.geo as SlideGeo);
}

describe("Supported Arm Elevation (table slide) set-up and measures", () => {
  it.each(SIDES)("learns the resting hand on the table from a camera above it, and says what to fix (%s side)", side => {
    const pose = slideBody(side);
    const rest = slideRestCheck(pose, side, ASPECT);
    expect(rest.lapMissing).toBeUndefined();
    expect(rest.lapRest).toMatchObject({ x: pose.landmarks[poseJoints(side).wrist].x, y: pose.landmarks[poseJoints(side).wrist].y });
    // A camera well below the table (it sees the forearm from underneath).
    expect(slideRestCheck(slideBody(side, { camera: { y: 0.05, z: 1.6 } }), side, ASPECT).lapMissing).toBe("Raise the camera to chest height, above the table.");
    // The forearm not on the table (the hand down by the lap).
    expect(slideRestCheck(slideBody(side, { liftM: -0.2 }), side, ASPECT).lapMissing).toMatch(/forearm on a towel on the table/);
    // The other hand off its thigh.
    expect(slideRestCheck(slideBody(side, { otherHand: [0, 0.3, 0] }), side, ASPECT).lapMissing).toBe("Rest your other hand on your thigh.");
    // Too close: the head is cut off.
    expect(slideRestCheck(slideBody(side, { camera: { y: 0.35, z: 0.55 } }), side, ASPECT).lapMissing).toBeDefined();
  });
  it.each(SIDES)("places the slide dial beside the affected shoulder, outside the body and inside the picture (%s side)", side => {
    const pose = slideBody(side), j = poseJoints(side);
    const dial = slideDial(pose, side, ASPECT)!;
    const shoulder = pose.landmarks[j.shoulder], other = pose.landmarks[j.shoulderOther];
    expect(dial.out).toBe(Math.sign(shoulder.x - other.x));
    expect((dial.pivot.x - shoulder.x) * dial.out).toBeGreaterThan(0);
    const far = dial.pivot.x + dial.out * (dialHand(90).hand[0] + 0.34) * dial.radius / ASPECT;
    expect(far).toBeGreaterThan(0); expect(far).toBeLessThan(1);
    expect(dial.pivot.y + 1.34 * dial.radius).toBeLessThan(1);
  });
  it("draws the dial's hand sliding along its table, further as the shoulder elevates", () => {
    const rest = dialHand(0), goal = dialHand(DIAL_GOAL_DEG), past = dialHand(90);
    expect(rest.hand[1]).toBe(1); expect(goal.hand[1]).toBe(1);
    expect(goal.hand[0] - rest.hand[0]).toBeGreaterThan(0.5);
    // The arm straightens: the hand can go no further.
    expect(past.hand[0]).toBeGreaterThan(goal.hand[0]);
    expect(Math.hypot(past.hand[0], past.hand[1])).toBeCloseTo(1.9, 1);
  });
  it.each(SIDES)("measures the shoulder rising and the elbow straightening as the hand slides forward (%s side)", side => {
    const values = [0, 20, 40, 55].map(shoulderDeg => slideFrame({ pose: slideBody(side, { shoulderDeg }) }, side, 0, ASPECT, null).values);
    for (let i = 1; i < values.length; i++) {
      expect(values[i].shoulder_flexion!).toBeGreaterThan(values[i - 1].shoulder_flexion! + 10);
      expect(values[i].elbow_extension!).toBeGreaterThan(values[i - 1].elbow_extension!);
    }
  });
  it.each(SIDES)("a clean slide trips none of the checks (%s side)", side => {
    for (const shoulderDeg of [20, 40, 55]) {
      const comps = measured(side, { shoulderDeg }).comps;
      expect(comps.trunk_approach_pct ?? 0).toBeLessThan(1);
      expect(comps.trunk_side_lean_delta ?? 0).toBeLessThan(1);
      expect(comps.shoulder_hike_rel_delta ?? 0).toBeLessThan(1);
      expect(comps.hand_lift_pct).toBe(0);
      expect(comps.other_hand_pct!).toBeLessThan(60);
    }
  });
  it.each(SIDES)("measures each compensation (%s side)", side => {
    expect(measured(side, { shoulderDeg: 30, leanDeg: 12 }).comps.trunk_approach_pct!).toBeGreaterThan(6);
    expect(measured(side, { shoulderDeg: 30, sideDeg: 10 }).comps.trunk_side_lean_delta!).toBeGreaterThan(8);
    expect(measured(side, { shoulderDeg: 30, hikeM: 0.06 }).comps.shoulder_hike_rel_delta!).toBeGreaterThan(7);
    expect(measured(side, { shoulderDeg: 30, liftM: 0.06 }).comps.hand_lift_pct!).toBeGreaterThan(13);
    // The other hand reaching over to the affected forearm, or just off its thigh.
    expect(measured(side, { shoulderDeg: 30, otherHand: [0.3, 0.14, 0.1] }).comps.other_hand_pct!).toBeGreaterThan(100);
    expect(measured(side, { otherHand: [0, 0.2, 0] }).comps.other_hand_pct!).toBeGreaterThan(100);
  });
  it("keeps the hand's checks unmeasured when the hand is out of view", () => {
    const rest = slideFrame({ pose: slideBody("right") }, "right", 0, ASPECT, null);
    const pose = slideBody("right");
    pose.landmarks[poseJoints("right").wrist] = { ...pose.landmarks[poseJoints("right").wrist], visibility: 0.1 };
    const frame = slideFrame({ pose }, "right", 50, ASPECT, rest.geo as SlideGeo);
    expect(frame.visible).toBe(false);
    expect(frame.comps.hand_lift_pct).toBeUndefined();
    expect(frame.values.shoulder_flexion).toBeUndefined();
  });
});

describe("Supported Arm Elevation targets", () => {
  const base = { rest: 13, goal: 40, returning: false, aspect: ASPECT, armed: true, practice: false, t: 0 };
  it("is on the slide's target at the goal and stays on it until the shoulder sags a few degrees", () => {
    const target = new SlideTarget();
    const at = (value: number) => target.update("reps:1:0", { ...base, value }).contact;
    expect(at(38)).toBe(false);
    expect(at(40)).toBe(true);
    expect(at(37)).toBe(true);
    expect(at(35)).toBe(false);
    expect(at(39)).toBe(false);
    expect(target.update("reps:1:0", { ...base, value: 26.5 }).progress).toBeCloseTo(0.5);
  });
  it("is back once the shoulder is most of the way back with the hand down on the table, never on the hand's place alone", () => {
    const target = new SlideTarget();
    const restHand = { x: 0.4, y: 0.6, bodyScale: 0.28 };
    const back = (value: number, hand: { x: number; y: number }, t = 0) => target.update("reps:1:1", { ...base, returning: true, value, hand, restHand, t }).contact;
    // Still slid forward: not back, even with the hand where it rested in the picture.
    expect(back(40, { x: 0.4, y: 0.6 })).toBe(false);
    expect(back(30, { x: 0.39, y: 0.61 })).toBe(false);
    // Most of the way back with the hand down (it may have stopped a little forward of where it rested).
    expect(back(20, { x: 0.36, y: 0.63 })).toBe(true);
    target.reset();
    // Back where it rested with the 3D angle reading a little high, and after a long while at any angle.
    expect(back(23, { x: 0.4, y: 0.6 })).toBe(true);
    target.reset();
    expect(back(30, { x: 0.4, y: 0.6 }, 0)).toBe(false);
    expect(back(30, { x: 0.4, y: 0.6 }, 10_001)).toBe(true);
    target.reset();
    // Lifted off the table: not back, however low the shoulder reads.
    expect(back(14, { x: 0.3, y: 0.5 })).toBe(false);
  });
  it.each(SIDES)("a hand slid forward to the goal is not back on its resting place in the picture (%s side)", side => {
    const restHand = slideRestCheck(slideBody(side), side, ASPECT).lapRest!;
    const rest = slideFrame({ pose: slideBody(side) }, side, 0, ASPECT, null).values.shoulder_flexion!;
    const at = (shoulderDeg: number, t = 0) => {
      const pose = slideBody(side, { shoulderDeg });
      const value = slideFrame({ pose }, side, 0, ASPECT, null).values.shoulder_flexion;
      return new SlideTarget().update("reps:1:1", { ...base, rest, goal: rest + 30, returning: true, value, hand: pose.landmarks[poseJoints(side).wrist], restHand, t }).contact;
    };
    for (const shoulderDeg of [30, 40, 50]) expect(at(shoulderDeg), `${shoulderDeg}`).toBe(false);
    for (const shoulderDeg of [0, 5]) expect(at(shoulderDeg), `${shoulderDeg}`).toBe(true);
  });
  it("eases a practice slide that touched its goal once and then sagged", () => {
    const target = new SlideTarget();
    const practice = (t: number, value: number) => target.update("warm:0:0", { ...base, practice: true, goal: slidePracticeGoal(13), value, t });
    expect(practice(0, 30).contact).toBe(true);
    expect(practice(100, 24).contact).toBe(false);
    // Timed from the last contact (t = 0).
    expect(practice(SLIDE_EASE_MS - 1, 24).contact).toBe(false);
    expect(practice(SLIDE_EASE_MS + 1, 24)).toMatchObject({ contact: true, eased: true, goal: 23 });
  });
  it("eases a practice slide that is not reached for a while", () => {
    const target = new SlideTarget();
    const practice = (t: number, value: number) => target.update("warm:0:0", { ...base, practice: true, goal: slidePracticeGoal(13), value, t });
    expect(practice(0, 25).contact).toBe(false);
    expect(practice(SLIDE_EASE_MS - 1, 25).contact).toBe(false);
    expect(practice(SLIDE_EASE_MS + 1, 25)).toMatchObject({ contact: true, eased: true, goal: 23 });
    expect(slidePracticeGoal(13)).toBeGreaterThan(13 + 15 - 0.01);
    expect(slidePracticeGoal(50)).toBe(65);
  });
});

// ---------- a whole session from simulated camera landmarks, as the page drives it ----------

const ID = "ex_wallslide";
const rule = (id: string) => EXERCISES[ID].compensations.find(item => item.id === id)!;

/**
 * A patient who slides once each circle is active, at `speed` degrees per second of shoulder elevation, from simulated
 * pose landmarks. `scored` adds a posture during the scored slides; `between` moves the other hand between repetitions.
 */
function cameraPatient(side: Side, options: { scored?: Slide; reps?: number; speed?: number; slideTo?: number; backTo?: number; between?: P3; frames?: number } = {}) {
  const said: string[] = [];
  const session = new ExerciseSession({ exerciseId: ID, rung: 1, side, repsOverride: options.reps ?? 2, reviewBetweenReps: true }, { say: text => said.push(text), busy: () => false, stop() {} });
  const target = new SlideTarget();
  let t = 0, shoulderDeg = 0;
  session.start(t);
  for (let n = 0; n < (options.frames ?? 20000) && session.snapshot().phase !== "done"; n++) {
    t += 50;
    const snap: Snapshot = session.snapshot();
    const live = (snap.phase === "warm" || snap.phase === "reps") && !snap.review;
    const want = live && snap.targetArmed ? (snap.kind === "return" ? options.backTo ?? 0 : options.slideTo ?? 40) : live ? shoulderDeg : snap.review ? shoulderDeg : 0;
    shoulderDeg += Math.sign(want - shoulderDeg) * Math.min(Math.abs(want - shoulderDeg), (options.speed ?? 25) * 0.05);
    const scored = snap.phase === "reps" && snap.kind === "reach" && live ? options.scored ?? {} : {};
    const otherHand = snap.phase === "reps" && snap.repIndex >= 2 ? options.between : undefined;
    const pose = slideBody(side, { shoulderDeg, otherHand, ...scored });
    const frame = slideFrame({ pose }, side, t, ASPECT, session.reference);
    if (live) {
      const rest = session.restValues().shoulder_flexion;
      const learned = session.learnedValue("shoulder_flexion");
      const returning = snap.kind === "return";
      const goal = snap.phase === "reps" ? session.targets().shoulder_flexion : returning && learned !== undefined ? learned : slidePracticeGoal(rest);
      const out = target.update(`${snap.phase}:${snap.repIndex}:${snap.stepIndex}`, { value: frame.values.shoulder_flexion, rest, goal, returning, hand: pose.landmarks[poseJoints(side).wrist], restHand: session.lapPoint, aspect: ASPECT, armed: snap.targetArmed, practice: snap.phase === "warm", t });
      frame.targetContact = frame.visible && out.contact;
      frame.targetProgress = frame.targetContact ? 1 : Math.max(0, Math.min(0.98, returning ? 1 - out.progress : out.progress));
    }
    session.push(frame);
  }
  return { session, said };
}

describe("Supported Arm Elevation session from camera landmarks", () => {
  it("runs on the shared target flow, keeping Alira's level planning as it is", () => {
    expect(usesTargetFlow(ID)).toBe(true);
    expect(usesSeatedTargets(ID)).toBe(false);
    expect(EXERCISES[ID].compensations.map(item => item.id)).toEqual(["trunk_forward", "shoulder_hike", "side_lean", "hand_lift", "other_hand"]);
    expect(EXERCISES[ID].cycle.map(step => step.kind)).toEqual(["reach", "return"]);
  });
  it.each(SIDES)("a clean slide scores 100 with every check measured, and learns its goal just inside the practice hold (%s side)", side => {
    const { session, said } = cameraPatient(side);
    const snap = session.snapshot();
    expect(snap.phase).toBe("done");
    expect(snap.record?.repetition_scores).toEqual([100, 100]);
    expect(snap.reps.every(rep => !rep.compensations.length && !rep.unmeasured?.length)).toBe(true);
    const rest = session.restValues().shoulder_flexion, goal = session.targets().shoulder_flexion;
    expect(goal).toBeGreaterThan(rest + 15);
    expect(goal).toBeLessThan(slideFrame({ pose: slideBody(side, { shoulderDeg: 40 }) }, side, 0, ASPECT, null).values.shoulder_flexion!);
    // The full instructions are said once in practice; each scored repetition says only the short cues; no "slowly".
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
    ["other_hand", { otherHand: [0.3, 0.14, 0.1] as P3 }],
  ] as const)("flags %s", (id, scored) => {
    for (const side of SIDES) {
      const reps = cameraPatient(side, { scored }).session.snapshot().reps;
      for (const rep of reps) expect(rep.compensations, side).toContain(id);
    }
  });
  it("judges the other hand from where it rests as each slide starts, not from set-up", () => {
    const moved: P3 = [0.1, 0.2, 0.05];
    // Against the set-up position this would count as the other hand helping...
    expect(measured("right", { otherHand: moved }).comps.other_hand_pct!).toBeGreaterThan(100);
    // ...but it was moved between repetitions and kept still during the slides.
    const reps = cameraPatient("right", { reps: 3, between: moved }).session.snapshot().reps;
    expect(reps.map(rep => rep.compensations)).toEqual([[], [], []]);
  });
  it("does not count the slide back while the hand stays slid forward", () => {
    // The patient slides forward and then keeps the arm there for a minute.
    const { session } = cameraPatient("right", { backTo: 40, frames: 1200 + 2400 });
    expect(session.snapshot()).toMatchObject({ phase: "warm", kind: "return", targetArmed: true, inZone: false });
    expect(session.snapshot().reps).toHaveLength(0);
  });
  it("takes the other hand's baseline where each slide starts, even with the shoulder not quite back", () => {
    // Each slide back stops a little forward of where the arm rested at set-up, and the other hand moves between repetitions.
    const reps = cameraPatient("right", { reps: 3, backTo: 6, between: [0.1, 0.2, 0.05] }).session.snapshot().reps;
    expect(reps.map(rep => rep.compensations)).toEqual([[], [], []]);
  });
  it("reminds a patient who flings the hand forward to slide slowly, without lowering the score", () => {
    const { session, said } = cameraPatient("left", { speed: 160 });
    expect(said).toContain(EXERCISES[ID].speedCue!.lift);
    expect(said).toContain(EXERCISES[ID].speedCue!.lower);
    expect(session.snapshot().record?.repetition_scores).toEqual([100, 100]);
  });
  it("previews its screens with its own checks and wording", () => {
    const setup = exerciseScreenPreview("setup", 1, "right", ID);
    expect(setup.bodyChecks.map(check => check.label)).toContain("Forearm on the table, space around you");
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
      level += Math.sign(want - level) * Math.min(Math.abs(want - level), 0.08);
      const frame = simFrame(t, session.cfg, session.targets(), { level, compensations: [] });
      if (live) frame.targetContact = slideGhostContact(level, snap.kind === "return");
      session.push(frame);
    }
    expect(session.snapshot().record?.repetition_scores).toEqual([100]);
  });
});

describe("Supported Arm Elevation demonstration and simulator", () => {
  it.each([false, true])("has the reach demonstration's states and fields (returning=%s)", returning => {
    expect(Object.keys(slideDemoState(0, returning, false)).sort()).toEqual(Object.keys(reachDemoState(0, returning, false)).sort());
    expect(slideDemoState(0, returning, false).instruction).toBe(reachDemoState(0, returning, false).instruction);
    expect(slideDemoState(0, returning).phase).toBe("move");
    expect(slideDemoState(slideDemoDuration(returning) - 1, returning).phase).toBe("complete");
    expect(slideGhostContact(1, false)).toBe(true); expect(slideGhostContact(0, true)).toBe(true);
    expect(slideGhostContact(0.5, false)).toBe(false); expect(slideGhostContact(0.5, true)).toBe(false);
  });
  it("waits for the ghost's hand to enter its circle, holds for 1.5 s, and its circles are apart", () => {
    let contactAt = 0;
    for (; contactAt < 1400; contactAt++) if (slideDemoState(contactAt, false).contact) break;
    const state = slideDemoState(contactAt, false);
    const hand = slideGhostPose(state.pose).hand, target = slideGhostPose(1).hand;
    expect(Math.hypot(hand[0] - target[0], hand[1] - target[1])).toBeLessThanOrEqual(state.radius);
    expect(slideDemoState(contactAt + 750, false).progress).toBeCloseTo(0.5, 2);
    const forward = slideGhostTarget(300, 270, false), back = slideGhostTarget(300, 270, true);
    expect(forward.x - back.x).toBeGreaterThan(2 * forward.radius);
    expect(forward.y).toBeCloseTo(back.y);
  });
});
