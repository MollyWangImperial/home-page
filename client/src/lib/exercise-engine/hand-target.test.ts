import { describe, expect, it } from "vitest";
import { EXERCISES, usesSeatedTargets, usesTargetFlow, type Side } from "./config";
import { compensationStatus, type Geo, type PoseInput } from "./metrics";
import { seatedPose, type SeatedPosture } from "./mouth-target";
import { reachDemoState } from "./reach-demo";
import { exerciseScreenPreview } from "./screen-preview";
import { ExerciseSession, simFrame, type Snapshot } from "./session";
import {
  affectedHand, ghostRings, handCovers, handDemoDuration, handDemoState, handGhostContact, handGhostTarget, handNearShoulder, handOpenFrame, handOpenness,
  handReady, handRest, handRingTarget, handTurnComps, handZone, inHandZone, openRing, palmFacing, palmGeo, palmRing, relaxRing,
  REST_OPEN_MAX, simulatedHand, startLimit, waiveLimit, type SimulatedHand,
} from "./hand-target";

const ASPECT = 4 / 3;
const SIDES: Side[] = ["left", "right"];
const rules = EXERCISES.ex_handopen.compensations;
const rule = (id: string) => rules.find(item => item.id === id)!;
const relaxedRef = (side: Side) => palmGeo(simulatedHand({ side })) as Geo;

// Where to hold the simulated hand: simulatedHand projects x = 0.5 + 0.75 X / Z and y = 0.5 + Y / Z (a 4:3
// front camera), and its wrist sits 0.065 m below the palm's centre.
const placeAt = (x: number, y: number, z = 0.9): [number, number, number] => [(x - 0.5) * z / 0.75, (y - 0.5) * z + 0.065, z];
const zoneFor = (side: Side) => handZone(seatedPose(side), side, ASPECT)!;
const inZone = (side: Side) => { const zone = zoneFor(side); return placeAt((zone.x0 + zone.x1) / 2, (zone.y0 + zone.y1) / 2); };
const onLap = (side: Side) => { const zone = zoneFor(side); return placeAt((zone.x0 + zone.x1) / 2, 0.85); };
/** A palm-up hand resting on the lap, fingers pointing away from the camera. */
const lapHand = (side: Side, open = 0) => simulatedHand({ side, open, at: onLap(side), wristFlexDeg: -90 });

describe("Active Hand Opening measures", () => {
  it("runs on the shared target flow, without the seated lap and level planning", () => {
    expect(usesTargetFlow("ex_handopen")).toBe(true);
    expect(usesSeatedTargets("ex_handopen")).toBe(false);
    expect(rules.map(item => item.id)).toEqual(["wrist_bend", "forearm_turn", "trunk_forward", "shoulder_hike"]);
  });
  it.each(SIDES)("openness grows as the fingers open, in palm lengths (%s hand)", side => {
    const values = [0, 0.25, 0.5, 1].map(open => handOpenness(simulatedHand({ side, open }))!);
    values.slice(1).forEach((value, index) => expect(value).toBeGreaterThan(values[index]));
    expect(values[0]).toBeCloseTo(0.45, 1);
    expect(values[3]).toBeCloseTo(1.2, 1);
    expect(handOpenness(simulatedHand({ side, fist: true }))!).toBeLessThan(0.3);
  });
  it.each(SIDES)("openness is the same however the hand is tilted or turned, so a hand on the lap cannot look open (%s hand)", side => {
    for (const open of [0, 1]) {
      const straight = handOpenness(simulatedHand({ side, open }))!;
      for (const wristFlexDeg of [-90, -60, -30, 30, 60]) expect(handOpenness(simulatedHand({ side, open, wristFlexDeg }))!).toBeCloseTo(straight, 2);
      for (const forearmTurnDeg of [-60, 60]) expect(handOpenness(simulatedHand({ side, open, forearmTurnDeg }))!).toBeCloseTo(straight, 2);
    }
    expect(handOpenness(lapHand(side))!).toBeLessThan(REST_OPEN_MAX);
  });
  it.each(SIDES)("opening the fingers alone is neither a wrist bend nor a palm turn (%s hand)", side => {
    for (const open of [0, 0.5, 1]) {
      const comps = handTurnComps(simulatedHand({ side, open }), relaxedRef(side));
      expect(comps.wrist_flexion_deg).toBeLessThan(1);
      expect(comps.forearm_turn_deg).toBeLessThan(1);
    }
  });
  it.each(SIDES)("measures the wrist bending toward the palm, not back (%s hand)", side => {
    const at = (wristFlexDeg: number) => handTurnComps(simulatedHand({ side, open: 1, wristFlexDeg }), relaxedRef(side));
    expect(at(30).wrist_flexion_deg).toBeCloseTo(30, 0);
    expect(compensationStatus(at(30), rule("wrist_bend")).over).toBe(true);
    expect(compensationStatus(at(10), rule("wrist_bend")).over).toBe(false);
    expect(at(-30).wrist_flexion_deg).toBe(0);
  });
  it.each(SIDES)("measures the palm turning away from the camera either way (%s hand)", side => {
    for (const turn of [-40, 40]) {
      const comps = handTurnComps(simulatedHand({ side, open: 1, forearmTurnDeg: turn }), relaxedRef(side));
      expect(comps.forearm_turn_deg).toBeCloseTo(40, 0);
      expect(compensationStatus(comps, rule("forearm_turn")).over).toBe(true);
      expect(compensationStatus(comps, rule("wrist_bend")).over).toBe(false);
    }
    expect(compensationStatus(handTurnComps(simulatedHand({ side, open: 1, forearmTurnDeg: 20 }), relaxedRef(side)), rule("forearm_turn")).over).toBe(false);
  });
  it("measures no turn before the relaxed hand is learned", () => {
    expect(handTurnComps(simulatedHand({ open: 1, wristFlexDeg: 30 }), null)).toEqual({});
  });
  it.each(SIDES)("tells the palm from the back of the hand and from the other hand (%s side)", side => {
    const other: Side = side === "right" ? "left" : "right";
    expect(palmFacing(simulatedHand({ side }), side)).toBeCloseTo(1, 2);
    expect(palmFacing(simulatedHand({ side, forearmTurnDeg: 180 }), side)).toBeCloseTo(-1, 2);
    expect(palmFacing(simulatedHand({ side: other }), side)).toBeCloseTo(-1, 2);
    // Without a side it is how squarely either face of the hand is toward the camera.
    expect(palmFacing(simulatedHand({ side, forearmTurnDeg: 180 }))).toBeCloseTo(1, 2);
  });
  it("keeps the drawn palm size when the palm tilts", () => {
    const flat = palmRing(simulatedHand({}), ASPECT)!.scale;
    expect(palmRing(simulatedHand({ wristFlexDeg: 50 }), ASPECT)!.scale).toBeGreaterThan(flat * 0.9);
  });
});

describe("Active Hand Opening shaded area", () => {
  it.each(SIDES)("sits out beside the body on the affected side at chest height, in the frame and clear of both shoulders (%s side)", side => {
    const pose = seatedPose(side);
    const zone = zoneFor(side);
    const shoulder = pose.landmarks[side === "right" ? 12 : 11], other = pose.landmarks[side === "right" ? 11 : 12];
    const outward = Math.sign(shoulder.x - other.x);
    const width = Math.abs(shoulder.x - other.x);
    expect(zone.tight).toBe(false);
    // The whole palm-centre area is out beyond the affected shoulder, on its side of the body.
    for (const x of [zone.x0, zone.x1]) expect((x - shoulder.x) * outward).toBeGreaterThan(0.4 * width);
    expect(zone.x0).toBeGreaterThan(0); expect(zone.x1).toBeLessThan(1);
    // At chest height: from just below the shoulder line down, so the open fingers stay below the shoulder.
    expect(zone.y0).toBeGreaterThan(shoulder.y); expect(zone.y1).toBeGreaterThan(shoulder.y + 0.5 * width * ASPECT);
    // A relaxed hand there is ready; it hides neither a shoulder nor the face.
    const hand = simulatedHand({ side, at: inZone(side) });
    expect(handCovers(hand, pose, side, ASPECT)).toBeNull();
    expect(handReady(hand, zone, ASPECT, side, { startLimit: 0.7 })).toEqual({ ready: true, placed: true });
  });
  it("is on the side of the affected shoulder for each side", () => {
    const right = zoneFor("right"), left = zoneFor("left");
    expect(Math.sign(right.x0 - 0.5)).toBe(-Math.sign(left.x0 - 0.5));
  });
  it.each(SIDES)("moves in front of the chest when there is no room beside the shoulder (%s side)", side => {
    const pose = seatedPose(side);
    const shoulder = pose.landmarks[side === "right" ? 12 : 11], other = pose.landmarks[side === "right" ? 11 : 12];
    const outward = Math.sign(shoulder.x - other.x);
    // Slide the whole body toward the affected side until its shoulder is near the frame edge.
    const shift = (outward > 0 ? 0.9 : 0.1) - shoulder.x;
    const near: PoseInput = { landmarks: pose.landmarks.map(p => ({ ...p, x: p.x + shift })), world: pose.world };
    const zone = handZone(near, side, ASPECT)!;
    const width = Math.abs(shoulder.x - other.x) * ASPECT;
    expect(zone.tight).toBe(false);
    expect(zone.y0).toBeGreaterThan(shoulder.y + 0.5 * width);
  });
  it.each(SIDES)("stays on screen and says to sit back when the patient is too close (%s side)", side => {
    const zone = handZone(seatedPose(side, { camera: { y: 0.35, z: 0.58 } }), side, ASPECT)!;
    expect(zone.x0).toBeGreaterThanOrEqual(0); expect(zone.x1).toBeLessThanOrEqual(1);
    expect(zone.y0).toBeGreaterThanOrEqual(0); expect(zone.y1).toBeLessThanOrEqual(1);
    if (zone.tight) expect(zone.hint).toBe("Sit back a little, or move the camera back, so the shaded area fits.");
  });  it("asks for the camera to be tilted down when the shoulders sit too low in the picture", () => {
    const pose = seatedPose("right");
    const low: PoseInput = { landmarks: pose.landmarks.map(p => ({ ...p, y: p.y + (0.8 - pose.landmarks[12].y) })), world: pose.world };
    const zone = handZone(low, "right", ASPECT)!;
    expect(zone.tight).toBe(true);
    expect(zone.hint).toBe("Tilt the camera down a little, or lower it, so your chest is in view.");
  });  it("allows a little slack around the area", () => {
    const zone = { x0: 0.2, x1: 0.3, y0: 0.4, y1: 0.5, palm: 0.1, tight: false };
    expect(inHandZone({ x: 0.25, y: 0.45 }, zone, ASPECT)).toBe(true);
    expect(inHandZone({ x: 0.2 - 0.03 / ASPECT, y: 0.45 }, zone, ASPECT)).toBe(true);
    expect(inHandZone({ x: 0.2 - 0.07 / ASPECT, y: 0.45 }, zone, ASPECT)).toBe(false);
    expect(inHandZone({ x: 0.2 - 0.07 / ASPECT, y: 0.45 }, zone, ASPECT, 1)).toBe(true);
    expect(inHandZone(null, zone, ASPECT)).toBe(false);
  });
  it.each(SIDES)("knows when the hand hides a shoulder or the face (%s side)", side => {
    const pose = seatedPose(side);
    const at = (point: { x: number; y: number }) => simulatedHand({ side, at: placeAt(point.x, point.y + 0.05) });
    expect(handCovers(at(pose.landmarks[side === "right" ? 12 : 11]), pose, side, ASPECT)).toBe("shoulder");
    expect(handCovers(at(pose.landmarks[0]), pose, side, ASPECT)).not.toBeNull();
  });
  it.each(SIDES)("uses the affected hand, never the other hand on the other side of the body (%s side)", side => {
    const other: Side = side === "right" ? "left" : "right";
    const mine = simulatedHand({ side, at: inZone(side) }), theirs = simulatedHand({ side: other, at: inZone(other) });
    expect(affectedHand({ pose: seatedPose(side), hands: [theirs, mine] }, side)).toBe(mine);
    expect(affectedHand({ pose: seatedPose(side), hands: [theirs] }, side)).toBeNull();
  });
});

describe("Active Hand Opening set-up and rings", () => {
  it.each(SIDES)("learns a relaxed hand only, in the shaded area, palm to the camera, with the face and shoulders in view (%s hand)", side => {
    const zone = zoneFor(side);
    const relaxed = simulatedHand({ side, at: inZone(side) });
    expect(handRest(null, ASPECT, side, true, zone).lapMissing).toBe(`Hold your ${side} hand up in the shaded area with your palm facing the camera.`);
    expect(handRest(simulatedHand({ side, at: [0.4, 0.06, 0.55] }), ASPECT, side, true, zone).lapMissing).toBe("Move your hand back a little so I can see every fingertip.");
    expect(handRest(relaxed, ASPECT, side, false, zone).lapMissing).toBe("Keep your face and both shoulders in view.");
    expect(handRest(lapHand(side), ASPECT, side, true, zone).lapMissing).toBe("Bring your hand into the shaded area.");
    expect(handRest(simulatedHand({ side, at: inZone(side), forearmTurnDeg: 180 }), ASPECT, side, true, zone).lapMissing).toBe("Turn your palm to face the camera.");
    // An open "stop" palm is not a relaxed hand: learning it made opening impossible to detect.
    expect(handRest(simulatedHand({ side, at: inZone(side), open: 1 }), ASPECT, side, true, zone).lapMissing).toBe("Let your fingers relax and curl gently. Don't open your hand yet.");
    expect(handRest(relaxed, ASPECT, side, true, zone).lapRest!.bodyScale).toBeGreaterThan(0.05);
  });
  it("puts the practice ring a little beyond the relaxed hand and the scored ring just inside the opening held there", () => {
    expect(openRing(0.5)).toBeCloseTo(0.5 + 0.3 * 0.55);
    // A hand that rests nearly open still gets a quarter of a palm length of room.
    expect(openRing(1.1)).toBeCloseTo(1.1 + 0.3 * 0.25);
    expect(openRing(0.5, 1.2)).toBeCloseTo(1.14);
    // Never on top of the relaxed hand.
    expect(openRing(0.5, 0.5)).toBeCloseTo(0.55);
    expect(relaxRing(0.5, 1.14)).toBeCloseTo(0.5 + 0.35 * 0.64);
    // Each repetition starts from a hand no more open than the close circle.
    expect(startLimit(0.5, 1.2)).toBeCloseTo(relaxRing(0.5, 1.14));
    // Always well inside the ring, however little room there is.
    expect(startLimit(0.5, 0.5)).toBeCloseTo(0.53);
    for (const [rest, learned] of [[0.7, undefined], [0.75, undefined], [0.6, 0.745], [0.45, 0.5]] as const) {
      expect(startLimit(rest, learned)).toBeLessThan(openRing(rest, learned));
      expect(waiveLimit(rest, learned)).toBeLessThan(openRing(rest, learned));
    }
  });
  it("is on target out at the ring while opening, and back inside the close circle while closing", () => {
    expect(handRingTarget(1.15, 0.5, 1.2, false)).toMatchObject({ contact: true, progress: 1 });
    expect(handRingTarget(0.9, 0.5, 1.2, false)).toMatchObject({ contact: false });
    expect(handRingTarget(0.9, 0.5, 1.2, false).progress).toBeCloseTo(0.4 / 0.64);
    expect(handRingTarget(0.6, 0.5, 1.2, true).contact).toBe(true);
    expect(handRingTarget(0.9, 0.5, 1.2, true).contact).toBe(false);
  });
  it("is ready to start only with the palm to the camera, the fingers relaxed and the hand in the area, and says what to fix", () => {
    const zone = zoneFor("right");
    const ready = (hand: ReturnType<typeof simulatedHand> | null) => handReady(hand, zone, ASPECT, "right", { startLimit: 0.7 });
    expect(ready(simulatedHand({ side: "right", at: inZone("right") }))).toEqual({ ready: true, placed: true });
    expect(ready(simulatedHand({ side: "right", at: inZone("right"), open: 1 }))).toEqual({ ready: false, placed: true, almost: true, hint: "Let your fingers relax first." });
    expect(ready(simulatedHand({ side: "right", at: inZone("right"), forearmTurnDeg: 70 }))).toEqual({ ready: false, placed: false, hint: "Turn your palm to face the camera." });
    // Opening with the palm turned a little away stays placed, so the movement is not interrupted.
    expect(ready(simulatedHand({ side: "right", at: inZone("right"), forearmTurnDeg: 55, open: 1 })).placed).toBe(true);
    expect(ready(lapHand("right", 1))).toMatchObject({ ready: false, placed: false, hint: "Bring your hand into the shaded area." });
    expect(ready(null)).toMatchObject({ ready: false, placed: false });
  });
  it("starts a step only with the wrist and palm close to the set-up hand", () => {
    const zone = zoneFor("right"), ref = palmGeo(simulatedHand({ side: "right" })) as Geo;
    const ready = (hand: SimulatedHand) => handReady(simulatedHand({ side: "right", at: inZone("right"), ...hand }), zone, ASPECT, "right", { startLimit: 0.7, ref });
    expect(ready({ forearmTurnDeg: 15 })).toEqual({ ready: true, placed: true });
    expect(ready({ forearmTurnDeg: 40 })).toMatchObject({ ready: false, hint: "Turn your palm to face the camera." });
    expect(ready({ wristFlexDeg: 30 })).toMatchObject({ ready: false, almost: true, hint: "Hold your wrist as you did at the start." });
    // Squarer to the camera than at set-up is fine.
    expect(handReady(simulatedHand({ side: "right", at: inZone("right") }), zone, ASPECT, "right", { startLimit: 0.7, ref: palmGeo(simulatedHand({ side: "right", forearmTurnDeg: 40 })) as Geo })).toEqual({ ready: true, placed: true });
  });
  it("keeps the hand far enough from a shoulder that the opening fingers will not reach it", () => {
    const body = seatedPose("right");
    const shoulder = body.landmarks[12], other = body.landmarks[11];
    const out = Math.sign(shoulder.x - other.x), width = Math.abs(shoulder.x - other.x);
    expect(handNearShoulder(simulatedHand({ side: "right", at: placeAt(shoulder.x + out * 0.25 * width, shoulder.y + 0.05) }), body, "right", ASPECT)).toBe(true);
    expect(handNearShoulder(simulatedHand({ side: "right", at: inZone("right") }), body, "right", ASPECT)).toBe(false);
  });
  it("does not count a palm turned more squarely to the camera than at set-up as turning away", () => {
    const turnedRef = palmGeo(simulatedHand({ side: "right", forearmTurnDeg: 40 })) as Geo;
    expect(handTurnComps(simulatedHand({ side: "right" }), turnedRef).forearm_turn_deg).toBe(0);
    expect(handTurnComps(simulatedHand({ side: "right", forearmTurnDeg: 80 }), turnedRef).forearm_turn_deg).toBeGreaterThan(25);
  });  it("does not learn the resting hand while the hand hides a shoulder", () => {
    const body = seatedPose("right");
    const covering = simulatedHand({ side: "right", at: placeAt(body.landmarks[12].x, body.landmarks[12].y + 0.05) });
    const frame = handOpenFrame({ pose: body, hands: [covering] }, "right", 0, ASPECT, null, { zone: zoneFor("right") });
    expect(frame.lapRest).toBeUndefined();
    expect(frame.lapMissing).toBe("Move your hand a little further out, away from your shoulder.");
  });  it("builds a camera frame from the hand, with the body only for the trunk and shoulder checks", () => {
    const zone = zoneFor("right");
    const hand = simulatedHand({ side: "right", at: inZone("right") });
    const alone = handOpenFrame({ pose: null, hands: [hand] }, "right", 0, ASPECT, null, { zone });
    expect(alone).toMatchObject({ visible: true, lapMissing: "Keep your face and both shoulders in view." });
    expect(alone.values.hand_openness).toBeCloseTo(handOpenness(hand)!);
    expect(alone.values.finger_extension).toBeGreaterThan(120);
    const body = seatedPose("right");
    const seen = handOpenFrame({ pose: body, hands: [hand] }, "right", 0, ASPECT, null, { zone, startLimit: 0.7 });
    expect(seen).toMatchObject({ ready: true, placed: true });
    expect(seen.lapRest).toBeDefined();
    expect(seen.geo?.palmAx).toBeDefined();
    const later = handOpenFrame({ pose: body, hands: [hand] }, "right", 0, ASPECT, seen.geo!, { zone });
    expect(later.comps).toMatchObject({ wrist_flexion_deg: 0, forearm_turn_deg: 0, trunk_approach_pct: 0, shoulder_hike_rel_delta: 0 });
    // A hand hiding the shoulder leaves the trunk and shoulder checks unmeasured rather than misread.
    const covering = simulatedHand({ side: "right", at: placeAt(body.landmarks[12].x, body.landmarks[12].y + 0.05) });
    const hidden = handOpenFrame({ pose: body, hands: [covering] }, "right", 0, ASPECT, seen.geo!, { zone });
    expect(hidden.comps.shoulder_hike_rel_delta).toBeUndefined();
    expect(hidden.comps.trunk_approach_pct).toBeUndefined();
    expect(handOpenFrame({ pose: body, hands: [] }, "right", 0, ASPECT, null, { zone })).toMatchObject({ visible: false, values: {}, ready: false });
  });
});

describe("Active Hand Opening demonstration, simulator and previews", () => {
  it.each([false, true])("has the reach demonstration's states, fields and listening wording (returning=%s)", returning => {
    const [hand, reach] = [handDemoState(0, returning, false), reachDemoState(0, returning, false)];
    expect(Object.keys(hand).sort()).toEqual(Object.keys(reach).sort());
    expect(hand.phase).toBe("waiting"); expect(hand.instruction).toBe(reach.instruction);
    expect(handDemoState(0, returning).phase).toBe("move");
    expect(handDemoState(handDemoDuration(returning) - 1, returning).phase).toBe("complete");
    expect(handDemoState(0, returning).label).toBe(returning ? "Close target" : "Open target");
  });
  it.each([false, true])("waits for the fingers to reach the ring, holds for 1.5 s and completes (returning=%s)", returning => {
    let contactAt = 0;
    for (; contactAt < 1200; contactAt++) if (handDemoState(contactAt, returning).contact) break;
    expect(handGhostContact(handDemoState(contactAt, returning).pose, returning)).toBe(true);
    expect(handDemoState(contactAt - 1, returning).contact).toBe(false);
    expect(handDemoState(contactAt + 750, returning).progress).toBeCloseTo(0.5, 2);
    expect(handDemoState(10000, returning, false).progress).toBe(0);
  });
  it("the simulated hand touches the ring when open and the close circle when closed", () => {
    expect(handGhostContact(1, false)).toBe(true);
    expect(handGhostContact(0, false)).toBe(false);
    expect(handGhostContact(0, true)).toBe(true);
    expect(handGhostContact(1, true)).toBe(false);
    const rings = ghostRings();
    expect(rings.rest).toBeLessThan(rings.relax);
    expect(rings.relax).toBeLessThan(rings.open);
    expect(handGhostTarget(300, 270, true).radius).toBeLessThan(handGhostTarget(300, 270, false).radius);
  });
  it("previews show the open step, the wait for the palm and the hand set-up checks", () => {
    expect(exerciseScreenPreview("warm-reach", 1, "right", "ex_handopen").snapshot.kind).toBe("open");
    expect(exerciseScreenPreview("warm-waiting", 1, "right", "ex_handopen").snapshot.awaitingReady).toBe(true);
    expect(exerciseScreenPreview("warm-waiting", 1, "right", "ex_reach").snapshot.awaitingReady).toBe(false);
    expect(exerciseScreenPreview("setup", 1, "left", "ex_handopen").bodyChecks.map(check => check.label)).toEqual(["Face", "Left shoulder", "Other shoulder", "Left hand in the shaded area", "Palm to camera, fingers relaxed", "Lighting", "Clothes stand out from the background"]);
    expect(exerciseScreenPreview("results", 1, "right", "ex_handopen").snapshot.record?.best_label).toBe("finger opening");
  });
});

// ---------- a whole session from simulated camera landmarks, as the page drives it ----------

type Act = { open: number; where?: "zone" | "lap" | "gone"; hand?: SimulatedHand; body?: SeatedPosture };
type Plan = (snap: Snapshot, kind: string | undefined) => Act;
type Scored = { hand?: SimulatedHand; body?: SeatedPosture };

/** Opens once the ring is active, and otherwise holds a relaxed hand in the shaded area. */
const naturally: Plan = (snap, kind) => ({ open: (snap.phase === "warm" || snap.phase === "reps") && !snap.review && kind === "open" && snap.targetArmed ? 1 : 0 });
/** The same, with the scored openings done differently. */
const scoredWith = (scored: Scored): Plan => (snap, kind) => {
  const act = naturally(snap, kind);
  return act.open && snap.phase === "reps" ? { ...act, ...scored } : act;
};

function cameraPatient(side: Side, plan: Plan = naturally, reps = 2, options: { tremorM?: number; frames?: number } = {}) {
  const said: string[] = [];
  const session = new ExerciseSession({ exerciseId: "ex_handopen", rung: 1, side, repsOverride: reps, reviewBetweenReps: true }, { say: text => said.push(text), busy: () => false, stop() {} });
  const zone = zoneFor(side);
  let t = 0, n = 0;
  session.start(t);
  const step = () => {
    t += 50; n += 1;
    const snap = session.snapshot();
    const act = plan(snap, session.currentStep?.kind);
    const spot = act.where === "lap" ? onLap(side) : inZone(side);
    const tremor = options.tremorM ?? 0;
    const hand = simulatedHand({ side, open: act.open, at: [spot[0] + (n % 2 ? tremor : -tremor), spot[1], spot[2]], ...(act.where === "lap" ? { wristFlexDeg: -90 } : {}), ...act.hand });
    const rest = session.restValues().hand_openness;
    const learned = session.learnedValue("hand_openness");
    const frame = handOpenFrame({ pose: seatedPose(side, act.body), hands: act.where === "gone" ? [] : [hand] }, side, t, ASPECT, session.reference, Number.isFinite(rest) ? { zone, startLimit: startLimit(rest, learned), waiveLimit: waiveLimit(rest, learned) } : { zone });
    const live = (snap.phase === "warm" || snap.phase === "reps") && !snap.review;
    if (live && frame.values.hand_openness !== undefined) {
      const target = handRingTarget(frame.values.hand_openness, rest, snap.phase === "reps" ? session.learnedValue("hand_openness") : undefined, session.currentStep?.kind === "return");
      frame.targetContact = frame.visible && target.contact && (session.currentStep?.kind === "return" || frame.placed !== false);
      frame.targetProgress = frame.targetContact ? 1 : Math.min(0.98, target.progress);
    }
    session.push(frame);
    return session.snapshot();
  };
  const run = (until: (snap: Snapshot) => boolean = snap => snap.phase === "done", limit = options.frames ?? 8000) => {
    let snap = session.snapshot();
    for (let i = 0; i < limit && !until(snap); i++) snap = step();
    return snap;
  };
  return { session, said, step, run };
}

describe("Active Hand Opening session from camera landmarks", () => {
  it.each(SIDES)("clean opening scores 100 with every check measured (%s hand)", side => {
    const patient = cameraPatient(side);
    const snap = patient.run();
    expect(snap.phase).toBe("done");
    expect(snap.record?.repetition_scores).toEqual([100, 100]);
    expect(snap.reps.every(rep => !rep.compensations.length && !rep.unmeasured?.length)).toBe(true);
    // The scored ring sits just inside the opening held at the practice ring.
    expect(patient.session.learnedValue("hand_openness")).toBeCloseTo(1.2, 1);
    // Each step's full instruction is said in practice only; each scored repetition says just "open", then "close".
    const [open, close] = EXERCISES.ex_handopen.cycle;
    expect(patient.said.filter(line => line === open.voice)).toHaveLength(1);
    expect(patient.said.filter(line => line === open.cue)).toHaveLength(2);
    expect(patient.said.filter(line => line === close.cue)).toHaveLength(2);
  });
  it.each([
    ["wrist_bend", { hand: { wristFlexDeg: 30 } }],
    ["forearm_turn", { hand: { forearmTurnDeg: 40 } }],
    ["trunk_forward", { body: { trunkLeanDeg: 12 } }],
    ["shoulder_hike", { body: { shoulderHikeM: 0.055 } }],
  ] as const)("flags %s only", (id, scored) => {
    for (const side of SIDES) {
      const reps = cameraPatient(side, scoredWith(scored)).run().reps;
      expect(reps.map(rep => rep.compensations), side).toEqual([[id], [id]]);
      expect(reps.map(rep => rep.score), side).toEqual([30, 30]);
    }
  });
  it("learns the relaxed hand despite a small tremor (a palm length is far smaller than a torso)", () => {
    expect(cameraPatient("right", naturally, 1, { tremorM: 0.006 }).run().record?.repetition_scores).toEqual([100]);
  });
  it("refuses to learn an open palm at set-up, and learns once the fingers relax", () => {
    let relaxed = false;
    const patient = cameraPatient("right", snap => ({ open: snap.phase === "setup" && !relaxed ? 1 : naturally(snap, undefined).open }), 1);
    let snap = patient.run(() => false, 200);
    expect(snap.phase).toBe("setup");
    expect(snap.prompt).toBe("Let your fingers relax and curl gently. Don't open your hand yet.");
    relaxed = true;
    snap = patient.run(snap => snap.phase !== "setup", 400);
    expect(snap.phase).toBe("demo");
    expect(patient.session.restValues().hand_openness).toBeLessThan(REST_OPEN_MAX);
  });
  it("waits for the palm in the shaded area before each opening; a hand on the lap never starts or activates it", () => {
    let raised = false;
    const patient = cameraPatient("right", (snap, kind) => {
      if (snap.phase === "reps" && !raised) return { open: 1, where: "lap" };
      return naturally(snap, kind);
    }, 1);
    let snap = patient.run(snap => snap.phase === "reps" && snap.review === null);
    // Ten seconds with an open hand on the lap: the repetition waits, says what to do, and counts nothing.
    for (let i = 0; i < 200; i++) snap = patient.step();
    expect(snap).toMatchObject({ awaitingReady: true, targetArmed: false, holdProgress: 0, reps: [] });
    expect(snap.prompt).toBe("Bring your hand into the shaded area.");
    expect(patient.said.filter(line => line === "Open your hand.")).toHaveLength(0);
    raised = true;
    snap = patient.run(snap => snap.targetArmed);
    expect(snap).toMatchObject({ awaitingReady: false, kind: "open" });
    expect(patient.said.at(-1)).toBe("Open your hand.");
    expect(patient.run().record?.repetition_scores).toEqual([100]);
  });
  it("while waiting for the palm, a hand out of view gets the gentle hint, not the lost-hand nag", () => {
    let gone = true;
    const patient = cameraPatient("right", (snap, kind) => snap.phase === "reps" && gone ? { open: 0, where: "gone" } : naturally(snap, kind), 1);
    let snap = patient.run(snap => snap.phase === "reps" && snap.review === null);
    for (let i = 0; i < 60; i++) snap = patient.step();
    expect(snap).toMatchObject({ awaitingReady: true, paused: false, prompt: "Hold your right hand up in the shaded area with your palm facing the camera." });
    expect(patient.said).not.toContain("Bring your affected hand back into view.");
    gone = false;
    expect(patient.run().record?.repetition_scores).toEqual([100]);
  });
  it("an already open hand is asked to relax before the repetition starts", () => {
    let open = true;
    const patient = cameraPatient("right", (snap, kind) => snap.phase === "reps" && open ? { open: 1 } : naturally(snap, kind), 1);
    let snap = patient.run(snap => snap.phase === "reps" && snap.review === null);
    for (let i = 0; i < 40; i++) snap = patient.step();
    expect(snap).toMatchObject({ awaitingReady: true, prompt: "Let your fingers relax first." });
    open = false;
    expect(patient.run().record?.repetition_scores).toEqual([100]);
  });
  it.each([
    ["turned away at once", (frames: number) => ({ forearmTurnDeg: 80 + 0 * frames })],
    ["turned away gradually", (frames: number) => ({ forearmTurnDeg: Math.min(90, frames * 2) })],
    ["tipped forward toward the lap", (frames: number) => ({ wristFlexDeg: Math.min(90, frames * 3) })],
  ] as const)("an attempt abandoned with the hand %s leaves no compensation on the redone repetition", (_name, hand) => {
    let frames = 0, left = false, done = false;
    const patient = cameraPatient("right", (snap, kind) => {
      if (snap.phase === "reps" && kind === "open" && snap.targetArmed && !done) { left = true; return { open: 0, hand: hand(frames++) }; }
      return naturally(snap, kind);
    }, 1);
    patient.run(snap => left && snap.awaitingReady);
    done = true;
    expect(patient.run().reps[0]).toMatchObject({ score: 100, compensations: [], hold: "full" });
  });
  it("a hand that goes out of view, or keeps flickering out on the lap, goes back to waiting instead of a miss", () => {
    for (const flicker of [false, true]) {
      let n = 0, left = false, done = false;
      const patient = cameraPatient("right", (snap, kind) => {
        if (snap.phase === "reps" && (snap.targetArmed || left) && !done) {
          left = true;
          return flicker ? { open: 0, where: n++ % 10 ? "lap" : "gone" } : { open: 0, where: "gone" };
        }
        return naturally(snap, kind);
      }, 1);
      let snap = patient.run(snap => left && snap.awaitingReady);
      for (let i = 0; i < 800; i++) snap = patient.step(); // 40 s away: no miss while waiting
      expect(snap).toMatchObject({ awaitingReady: true, reps: [] });
      done = true;
      expect(patient.run().record?.repetition_scores, String(flicker)).toEqual([100]);
    }
  });
  it("the practice instruction is said once even if the hand dips out of the area while learning", () => {
    let stage: "before" | "dipping" | "back" = "before";
    const patient = cameraPatient("right", (snap, kind) => {
      if (snap.phase === "warm" && kind === "open") {
        if (stage === "before" && snap.targetArmed) stage = "dipping";
        if (stage === "dipping" && snap.awaitingReady) stage = "back";
        if (stage === "dipping") return { open: 0, where: "lap" };
      }
      return naturally(snap, kind);
    }, 1);
    patient.run();
    expect(stage).toBe("back");
    expect(patient.said.filter(line => line === EXERCISES.ex_handopen.cycle[0].voice)).toHaveLength(1);
    expect(patient.session.snapshot().record?.repetition_scores).toEqual([100]);
  });
  it("a forearm that cannot turn the palm fully to the camera still completes, judged against its own set-up", () => {
    const patient = cameraPatient("right", (snap, kind) => ({ ...naturally(snap, kind), hand: { forearmTurnDeg: 57 } }), 1);
    expect(patient.run().reps[0]).toMatchObject({ score: 100, compensations: [] });
  });
  it("a hand that will not relax further starts the repetition after 8 s, with the hint shown meanwhile", () => {
    let started = -1, i = 0;
    const patient = cameraPatient("right", (snap, kind) => (snap.phase === "reps" && snap.awaitingReady ? { open: 0.4 } : naturally(snap, kind)), 1);
    let snap = patient.run(snap => snap.phase === "reps" && snap.review === null);
    for (; i < 400 && snap.awaitingReady !== false; i++) {
      snap = patient.step();
      if (i === 100) expect(snap.prompt).toBe("Let your fingers relax first.");
    }
    started = i;
    expect(started * 50).toBeGreaterThanOrEqual(8000);
    expect(patient.run().record?.repetition_scores).toEqual([100]);
  });
  it("never waives the start for a hand already open at the ring, so it cannot score without moving", () => {
    const patient = cameraPatient("right", (snap, kind) => (snap.phase === "reps" ? { open: 1 } : naturally(snap, kind)), 1);
    let snap = patient.run(snap => snap.phase === "reps" && snap.review === null);
    for (let i = 0; i < 600; i++) snap = patient.step(); // 30 s held wide open
    expect(snap).toMatchObject({ awaitingReady: true, reps: [], prompt: "Let your fingers relax first." });
  });  it("an open hand laid on the lap while the ring is active is not on the ring: the repetition waits again and scores normally", () => {
    for (const side of SIDES) {
      let left = false, done = false;
      const patient = cameraPatient(side, (snap, kind) => {
        if (snap.phase === "reps" && kind === "open" && snap.targetArmed && !done) { left = true; return { open: 1, where: "lap" }; }
        return naturally(snap, kind);
      }, 1);
      patient.run(snap => left && snap.awaitingReady);
      done = true;
      expect(patient.run().reps[0], side).toMatchObject({ score: 100, hold: "full", compensations: [] });
    }
  });
  it("a palm flicked away during the hold restarts the hold rather than counting it", () => {
    let flicks = 0, holding = 0;
    const patient = cameraPatient("right", (snap, kind) => {
      const act = naturally(snap, kind);
      if (snap.phase === "reps" && kind === "open" && snap.holdProgress > 0.3 && flicks < 8) { flicks++; return { ...act, hand: { forearmTurnDeg: 75 } }; }
      return act;
    }, 1);
    patient.run(snap => { if (flicks > 0 && flicks < 8) holding = Math.max(holding, snap.holdProgress); return flicks >= 8; });
    expect(patient.session.snapshot().holdProgress).toBeLessThan(0.3);
    expect(patient.run().reps[0]).toMatchObject({ score: 100, hold: "full" });
  });  it("the simulator, which has no shaded area, never waits for the palm", () => {
    const session = new ExerciseSession({ exerciseId: "ex_handopen", rung: 1, side: "right", repsOverride: 1, reviewBetweenReps: true }, { say() {}, busy: () => false, stop() {} });
    session.start(0);
    let waiting = 0;
    for (let t = 50; t < 120000 && session.snapshot().phase !== "done"; t += 50) {
      const opening = session.currentStep?.kind === "open" && session.snapshot().targetArmed;
      const live = session.snapshot().phase === "warm" || session.snapshot().phase === "reps";
      session.push({ ...simFrame(t, session.cfg, session.targets(), { level: opening ? 1 : 0, compensations: [] }), ...(live ? { targetContact: session.currentStep?.kind === "return" || opening } : {}) });
      if (session.snapshot().awaitingReady) waiting++;
    }
    expect(session.snapshot().phase).toBe("done");
    expect(waiting).toBe(0);
  });  it("a hand dropped to the lap before reaching the ring goes back to waiting for the palm, with no miss", () => {
    let dropped = false, back = false;
    const patient = cameraPatient("right", (snap, kind) => {
      if (snap.phase === "reps" && snap.targetArmed && kind === "open" && !back) { dropped = true; return { open: 0, where: "lap" }; }
      return naturally(snap, kind);
    }, 1);
    let snap = patient.run(snap => dropped && snap.awaitingReady);
    expect(snap).toMatchObject({ phase: "reps", awaitingReady: true, reps: [] });
    back = true;
    snap = patient.run();
    expect(snap.record?.repetition_scores).toEqual([100]);
    // Back within a few seconds: "Open your hand." is not said a second time.
    expect(patient.said.filter(line => line === "Open your hand.")).toHaveLength(1);
  });
});
