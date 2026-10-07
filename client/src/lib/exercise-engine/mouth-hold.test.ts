import { describe, expect, it } from "vitest";
import type { Side } from "./config";
import { poseJoints, type PoseInput } from "./metrics";
import { MOUTH_HOLD, MouthHold, type MouthHoldResult } from "./mouth-hold";
import { mouthContactPoints, observedMouth, seatedPose } from "./mouth-target";

const SIDES: Side[] = ["left", "right"];
const ASPECT = 4 / 3;
const FRAME = 33;

function scene(side: Side) {
  const rest = seatedPose(side);
  const j = poseJoints(side);
  const torso = Math.abs(rest.landmarks[j.hip].y - rest.landmarks[j.shoulder].y);
  const target = { mouth: observedMouth(rest)!, radius: Math.max(0.045, Math.min(0.08, torso * 0.18)), aspect: ASPECT, torso };
  const hold = new MouthHold();
  let t = 0;
  /** One camera frame of the hand `hand` of the way from the lap (0) to the lips (1). */
  const at = (hand: number, extra: Parameters<typeof seatedPose>[1] = {}) => hold.update(t += FRAME, seatedPose(side, { hand, ...extra }), side, target);
  const run = (frames: number, hand: number) => Array.from({ length: frames }, () => at(hand));
  const raise = () => { for (let step = 0; step <= 20; step++) at(step / 20); };
  return { hold, target, at, run, raise, now: () => t, side };
}
const hand = (result: MouthHoldResult, side: Side) => mouthContactPoints(result.pose, side)[0];

describe("hand-to-mouth: the cup stays at the lips while the tracker loses the forearm", () => {
  it.each(SIDES)("keeps the hold through a forearm flipped down for one frame or a second (%s)", side => {
    const s = scene(side);
    s.raise();
    const lips = hand(s.at(1), side);
    expect(s.at(1)).toMatchObject({ atMouth: true, contact: true, held: false });
    // One frame of the arm hanging down, as the pose model guesses with a hand in front of the face.
    expect(s.at(0)).toMatchObject({ atMouth: true, contact: true, unsure: false, held: true, seen: true });
    expect(s.at(1)).toMatchObject({ contact: true, held: false });
    // A second of it: the hold keeps counting briefly, then pauses; nothing resets and the cup stays put.
    const flipped = s.run(30, 0);
    expect(flipped.every(result => result.atMouth && result.held && result.seen)).toBe(true);
    expect(flipped.filter(result => result.contact).length).toBe(Math.floor(MOUTH_HOLD.contactGapMs / FRAME));
    expect(flipped.at(-1)).toMatchObject({ contact: false, unsure: true });
    for (const result of flipped) expect(hand(result, side)).toEqual(lips);
    expect(s.at(1)).toMatchObject({ atMouth: true, contact: true, unsure: false });
  });

  it.each(SIDES)("holds only the affected arm: the face and shoulders stay live for the posture checks (%s)", side => {
    const s = scene(side);
    s.raise();
    const held = s.at(0, { headFlexDeg: 20, shoulderHikeM: 0.05 });
    const live = seatedPose(side, { hand: 0, headFlexDeg: 20, shoulderHikeM: 0.05 });
    const j = poseJoints(side);
    expect(held.held).toBe(true);
    for (const index of [0, 2, 5, 9, 10, 11, 12, 23, 24]) expect(held.pose!.landmarks[index]).toEqual(live.landmarks[index]);
    const atLips = seatedPose(side, { hand: 1 });
    for (const index of [j.elbow, j.wrist]) {
      expect(held.pose!.landmarks[index]).toEqual(atLips.landmarks[index]);
      expect(held.pose!.world[index]).toEqual(atLips.world[index]);
    }
  });

  it.each(SIDES)("lets the hand go as soon as it is lowered in one smooth movement (%s)", side => {
    const s = scene(side);
    s.raise();
    s.run(10, 1);
    const lowering = Array.from({ length: 20 }, (_, step) => s.at(1 - (step + 1) / 20));
    const left = lowering.findIndex(result => !result.atMouth);
    expect(left).toBeGreaterThan(0);
    // Gone well before the hand reaches the lap, and never drawn at the lips once it has gone.
    expect(left * FRAME).toBeLessThan(500);
    expect(lowering.slice(left).every(result => !result.held && !result.contact)).toBe(true);
  });

  it.each(SIDES)("lets the hand go after 1.5 seconds without seeing it near the mouth (%s)", side => {
    const s = scene(side);
    s.raise();
    const away = s.run(Math.ceil(MOUTH_HOLD.exitMs / FRAME) + 2, 0);
    expect(away.at(-1)).toMatchObject({ atMouth: false, held: false, contact: false });
    // The tracker losing the hand altogether counts the same way.
    const t = s.now();
    const target = s.target;
    s.raise();
    expect(s.hold.update(t + 2000, null, side, target)).toMatchObject({ atMouth: true, unsure: true, seen: true });
    expect(s.hold.update(t + 4000, null, side, target)).toMatchObject({ atMouth: false, seen: false });
  });

  it.each(SIDES)("never holds a hand that has not reached the mouth circle (%s)", side => {
    const s = scene(side);
    for (let step = 0; step <= 10; step++) expect(s.at(step / 20)).toMatchObject({ atMouth: false, held: false, contact: false });
    expect(s.at(0)).toMatchObject({ atMouth: false, held: false });
  });

  it("starts again with nothing held after a reset", () => {
    const s = scene("right");
    s.raise();
    s.hold.reset();
    expect(s.at(0)).toMatchObject({ atMouth: false, held: false, contact: false });
  });

  it("keeps the tracker's own pose when nothing is held", () => {
    const s = scene("right");
    const pose: PoseInput = seatedPose("right", { hand: 0.2 });
    expect(s.hold.update(s.now() + FRAME, pose, "right", s.target).pose).toBe(pose);
  });
});
