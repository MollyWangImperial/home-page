import { describe, expect, it } from "vitest";
import { EXERCISES, usesSeatedTargets, usesTargetFlow, type Side } from "./config";
import { compensationStatus, type Geo } from "./metrics";
import { seatedPose, type SeatedPosture } from "./mouth-target";
import { reachDemoState } from "./reach-demo";
import { exerciseScreenPreview } from "./screen-preview";
import { ExerciseSession } from "./session";
import {
  ghostRings, handDemoDuration, handDemoState, handGhostContact, handGhostTarget, handOpenFrame, handOpenness, handRest, handRingTarget,
  handTurnComps, openRing, palmGeo, relaxRing, simulatedHand, type SimulatedHand,
} from "./hand-target";

const ASPECT = 4 / 3;
const SIDES: Side[] = ["left", "right"];
const rules = EXERCISES.ex_handopen.compensations;
const rule = (id: string) => rules.find(item => item.id === id)!;
const relaxedRef = (side: Side) => palmGeo(simulatedHand({ side })) as Geo;

describe("Active Hand Opening measures", () => {
  it("runs on the shared target flow, without the seated lap and level planning", () => {
    expect(usesTargetFlow("ex_handopen")).toBe(true);
    expect(usesSeatedTargets("ex_handopen")).toBe(false);
    expect(rules.map(item => item.id)).toEqual(["wrist_bend", "forearm_turn", "trunk_forward", "shoulder_hike"]);
  });
  it.each(SIDES)("openness grows as the fingers open, in palm lengths (%s hand)", side => {
    const values = [0, 0.25, 0.5, 1].map(open => handOpenness(simulatedHand({ side, open }), ASPECT)!);
    values.slice(1).forEach((value, index) => expect(value).toBeGreaterThan(values[index]));
    expect(values[0]).toBeCloseTo(0.5, 1);
    expect(values[3]).toBeCloseTo(1.2, 1);
    expect(handOpenness(simulatedHand({ side, fist: true }), ASPECT)!).toBeLessThan(values[0]);
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
    // Why it is checked: a bent wrist tips the fingers toward the camera and makes the hand look more open.
    expect(handOpenness(simulatedHand({ side, open: 1, wristFlexDeg: 30 }), ASPECT)!).toBeGreaterThan(handOpenness(simulatedHand({ side, open: 1 }), ASPECT)! + 0.1);
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
});

describe("Active Hand Opening set-up and rings", () => {
  it.each(SIDES)("learns the relaxed hand only with the palm to the camera and the face and shoulders in view (%s hand)", side => {
    expect(handRest(null, ASPECT, side, true).lapMissing).toBe(`Hold your ${side} hand up beside your shoulder with your palm facing the camera.`);
    expect(handRest(simulatedHand({ side, at: [0.3, 0.06, 0.55] }), ASPECT, side, true).lapMissing).toBe("Move your hand back a little so I can see every fingertip.");
    expect(handRest(simulatedHand({ side, forearmTurnDeg: 80 }), ASPECT, side, true).lapMissing).toBe("Turn your palm to face the camera.");
    expect(handRest(simulatedHand({ side }), ASPECT, side, false).lapMissing).toBe("Keep your face and both shoulders in view.");
    const rest = handRest(simulatedHand({ side }), ASPECT, side, true).lapRest!;
    expect(rest.bodyScale).toBeGreaterThan(0.1);
  });
  it("puts the practice ring a little beyond the relaxed hand and the scored ring just inside the opening held there", () => {
    expect(openRing(0.5)).toBeCloseTo(0.5 + 0.3 * 0.65);
    // A hand that rests nearly open still gets a quarter of a palm length of room.
    expect(openRing(1.1)).toBeCloseTo(1.1 + 0.3 * 0.25);
    expect(openRing(0.5, 1.2)).toBeCloseTo(1.14);
    // Never on top of the relaxed hand.
    expect(openRing(0.5, 0.5)).toBeCloseTo(0.55);
    expect(relaxRing(0.5, 1.14)).toBeCloseTo(0.5 + 0.35 * 0.64);
  });
  it("is on target out at the ring while opening, and back inside the relax circle while relaxing", () => {
    expect(handRingTarget(1.15, 0.5, 1.2, false)).toMatchObject({ contact: true, progress: 1 });
    expect(handRingTarget(0.9, 0.5, 1.2, false)).toMatchObject({ contact: false });
    expect(handRingTarget(0.9, 0.5, 1.2, false).progress).toBeCloseTo(0.4 / 0.64);
    expect(handRingTarget(0.6, 0.5, 1.2, true).contact).toBe(true);
    expect(handRingTarget(0.9, 0.5, 1.2, true).contact).toBe(false);
  });
  it("builds a camera frame from the hand, with the body only for the trunk and shoulder checks", () => {
    const hand = simulatedHand({ open: 0.5 });
    const alone = handOpenFrame({ pose: null, hands: [hand] }, "right", 0, ASPECT, null);
    expect(alone).toMatchObject({ visible: true, lapMissing: "Keep your face and both shoulders in view." });
    expect(alone.values.hand_openness).toBeCloseTo(handOpenness(hand, ASPECT)!);
    expect(alone.values.finger_extension).toBeGreaterThan(120);
    const body = seatedPose("right");
    const seen = handOpenFrame({ pose: body, hands: [hand] }, "right", 0, ASPECT, null);
    expect(seen.lapRest).toBeDefined();
    expect(seen.geo?.palmAx).toBeDefined();
    const later = handOpenFrame({ pose: body, hands: [hand] }, "right", 0, ASPECT, seen.geo!);
    expect(later.comps).toMatchObject({ wrist_flexion_deg: 0, forearm_turn_deg: 0, trunk_approach_pct: 0, shoulder_hike_rel_delta: 0 });
    expect(handOpenFrame({ pose: body, hands: [] }, "right", 0, ASPECT, null)).toMatchObject({ visible: false, values: {} });
  });
});

describe("Active Hand Opening demonstration, simulator and previews", () => {
  it.each([false, true])("has the reach demonstration's states, fields and listening wording (returning=%s)", returning => {
    const [hand, reach] = [handDemoState(0, returning, false), reachDemoState(0, returning, false)];
    expect(Object.keys(hand).sort()).toEqual(Object.keys(reach).sort());
    expect(hand.phase).toBe("waiting"); expect(hand.instruction).toBe(reach.instruction);
    expect(handDemoState(0, returning).phase).toBe("move");
    expect(handDemoState(handDemoDuration(returning) - 1, returning).phase).toBe("complete");
    expect(handDemoState(0, returning).label).toBe(returning ? "Relax target" : "Open target");
  });
  it.each([false, true])("waits for the fingers to reach the ring, holds for 1.5 s and completes (returning=%s)", returning => {
    let contactAt = 0;
    for (; contactAt < 1200; contactAt++) if (handDemoState(contactAt, returning).contact) break;
    expect(handGhostContact(handDemoState(contactAt, returning).pose, returning)).toBe(true);
    expect(handDemoState(contactAt - 1, returning).contact).toBe(false);
    expect(handDemoState(contactAt + 750, returning).progress).toBeCloseTo(0.5, 2);
    expect(handDemoState(10000, returning, false).progress).toBe(0);
  });
  it("the simulated hand touches the ring when open and the relax circle when relaxed", () => {
    expect(handGhostContact(1, false)).toBe(true);
    expect(handGhostContact(0, false)).toBe(false);
    expect(handGhostContact(0, true)).toBe(true);
    expect(handGhostContact(1, true)).toBe(false);
    const rings = ghostRings();
    expect(rings.rest).toBeLessThan(rings.relax);
    expect(rings.relax).toBeLessThan(rings.open);
    expect(handGhostTarget(300, 270, true).radius).toBeLessThan(handGhostTarget(300, 270, false).radius);
  });
  it("previews show the open step and the hand set-up checks", () => {
    expect(exerciseScreenPreview("warm-reach", 1, "right", "ex_handopen").snapshot.kind).toBe("open");
    expect(exerciseScreenPreview("setup", 1, "left", "ex_handopen").bodyChecks.map(check => check.label)).toEqual(["Face", "Left shoulder", "Other shoulder", "Left hand, palm to camera"]);
    expect(exerciseScreenPreview("results", 1, "right", "ex_handopen").snapshot.record?.best_label).toBe("finger opening");
  });
});

// ---------- a whole session from simulated camera landmarks, as the page drives it ----------

type Scored = { hand?: SimulatedHand; body?: SeatedPosture };

/** A patient whose hand opens fully for every target; `scored` changes the scored repetitions' opening. */
function cameraPatient(side: Side, scored: Scored = {}, reps = 2, tremorM = 0) {
  const said: string[] = [];
  const session = new ExerciseSession({ exerciseId: "ex_handopen", rung: 1, side, repsOverride: reps, reviewBetweenReps: true }, { say: text => said.push(text), busy: () => false, stop() {} });
  let t = 0;
  session.start(t);
  for (let n = 0; n < 8000 && session.snapshot().phase !== "done"; n++) {
    t += 50;
    const snap = session.snapshot();
    const live = (snap.phase === "warm" || snap.phase === "reps") && !snap.review;
    const opening = live && session.currentStep?.kind === "open";
    const extra = opening && snap.phase === "reps" ? scored : {};
    const at: [number, number, number] = [0.04 + (n % 2 ? tremorM : -tremorM), 0.06, 0.55];
    const hand = simulatedHand({ side, at, open: opening ? 1 : 0, ...extra.hand });
    const frame = handOpenFrame({ pose: seatedPose(side, extra.body), hands: [hand] }, side, t, ASPECT, session.reference);
    if (live && frame.values.hand_openness !== undefined) {
      const target = handRingTarget(frame.values.hand_openness, session.restValues().hand_openness, snap.phase === "reps" ? session.learnedValue("hand_openness") : undefined, session.currentStep?.kind === "return");
      frame.targetContact = frame.visible && target.contact;
      frame.targetProgress = frame.targetContact ? 1 : Math.min(0.98, target.progress);
    }
    session.push(frame);
  }
  return { session, said };
}

describe("Active Hand Opening session from camera landmarks", () => {
  it.each(SIDES)("clean opening scores 100 with every check measured (%s hand)", side => {
    const { session, said } = cameraPatient(side);
    const snap = session.snapshot();
    expect(snap.phase).toBe("done");
    expect(snap.record?.repetition_scores).toEqual([100, 100]);
    expect(snap.reps.every(rep => !rep.compensations.length && !rep.unmeasured?.length)).toBe(true);
    // The scored ring sits just inside the opening held at the practice ring.
    expect(session.learnedValue("hand_openness")).toBeCloseTo(1.2, 1);
    // Each step is instructed in practice only; the scored repetitions start from the countdown.
    expect(said.filter(line => line === EXERCISES.ex_handopen.cycle[0].voice)).toHaveLength(1);
  });
  it.each([
    ["wrist_bend", { hand: { wristFlexDeg: 30 } }],
    ["forearm_turn", { hand: { forearmTurnDeg: 40 } }],
    ["trunk_forward", { body: { trunkLeanDeg: 12 } }],
    ["shoulder_hike", { body: { shoulderHikeM: 0.055 } }],
  ] as const)("flags %s only", (id, scored) => {
    for (const side of SIDES) {
      const { session } = cameraPatient(side, scored);
      const reps = session.snapshot().reps;
      expect(reps.map(rep => rep.compensations), side).toEqual([[id], [id]]);
      expect(reps.map(rep => rep.score), side).toEqual([30, 30]);
    }
  });
  it("learns the relaxed hand despite a small tremor (a palm length is far smaller than a torso)", () => {
    const { session } = cameraPatient("right", {}, 1, 0.006);
    expect(session.snapshot().record?.repetition_scores).toEqual([100]);
  });
});
