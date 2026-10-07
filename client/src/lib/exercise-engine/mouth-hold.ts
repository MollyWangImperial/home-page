import { poseJoints, type PoseInput } from "./metrics";
import { mouthContactPoints, type MouthPoint } from "./mouth-target";
import type { Side } from "./config";

/**
 * Keeps the hand at the mouth once it has arrived there.
 *
 * With the hand in front of the face, the pose model often loses the forearm (more so with a dark sleeve
 * against a dark top) and, for a frame or for up to a second, guesses the arm hanging down: the hand point
 * jumps from the lips to the lap and back. A real arm cannot do that. It lowers through the positions in
 * between. So once the hand has touched the mouth circle it stays there until the camera sees it leave in
 * one continuous movement, or has not seen it near the mouth for EXIT_MS. Meanwhile the arm is held where
 * it was last seen by the mouth, so the cup, the skeleton and the arm angles stay still. The face and
 * shoulders are never held: head and trunk lean are still measured live.
 */
export const MOUTH_HOLD = {
  /** A reading within this many target radii of the mouth means the hand is still at the mouth. */
  nearFactor: 2,
  /** For this long after the last reading near the mouth, the hold keeps counting. */
  contactGapMs: 400,
  /** After this long without a reading near the mouth, the hand has left. Until then the hold pauses. */
  exitMs: 1500,
  /** A continuous movement away: each step at most this fast (torso lengths per second) plus slack. */
  speed: 6,
  slack: 0.06,
  /** Steps after a gap in tracking are judged as if only this much time had passed. */
  maxStepGapMs: 100,
  /** A continuous movement counts as leaving once it is this far from the mouth (torso lengths). */
  leaveDistance: 0.6,
};

export type MouthHoldTarget = { mouth: MouthPoint; radius: number; aspect: number; torso: number };

export type MouthHoldResult = {
  /** The pose to measure and draw: the tracker's own, or with the affected arm held by the mouth. */
  pose: PoseInput | null;
  /** The hand is (still) taken to be at the mouth. */
  atMouth: boolean;
  /** The hand counts as at the target this frame: its hold keeps counting. */
  contact: boolean;
  /** The hand was at the mouth moments ago and the tracker has lost it: the hold pauses, nothing resets. */
  unsure: boolean;
  /** The affected hand is in view, or taken to be at the mouth. */
  seen: boolean;
  /** This frame shows the arm held where it was last seen by the mouth. */
  held: boolean;
};

type Point = { x: number; y: number };

export class MouthHold {
  private atMouth = false;
  private lastNear: { t: number; pose: PoseInput } | null = null;
  /** The newest reading of a continuous movement away from the last reading near the mouth. */
  private track: (Point & { t: number }) | null = null;

  reset() {
    this.atMouth = false;
    this.lastNear = null;
    this.track = null;
  }

  update(t: number, pose: PoseInput | null, side: Side, target: MouthHoldTarget): MouthHoldResult {
    const points = mouthContactPoints(pose, side);
    const distance = points.length ? Math.min(...points.map(point => Math.hypot((point.x - target.mouth.x) * target.aspect, point.y - target.mouth.y))) : Infinity;
    const centre = points.length ? { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length } : null;
    const live = (contact: boolean): MouthHoldResult => ({ pose, atMouth: this.atMouth, contact, unsure: false, seen: points.length > 0, held: false });

    if (!this.atMouth) {
      if (distance > target.radius) return live(false);
      this.atMouth = true;
    }
    if (distance <= target.radius * MOUTH_HOLD.nearFactor) {
      this.lastNear = { t, pose: pose! };
      this.track = centre && { t, ...centre };
      return live(true);
    }

    // Away from the mouth, or not seen: the hand leaving, or the tracker flipping the forearm down?
    if (centre && this.track) {
      const step = Math.hypot((centre.x - this.track.x) * target.aspect, centre.y - this.track.y);
      const allowed = (MOUTH_HOLD.speed * Math.min(t - this.track.t, MOUTH_HOLD.maxStepGapMs) / 1000 + MOUTH_HOLD.slack) * target.torso;
      this.track = step <= allowed ? { t, ...centre } : null;
    }
    const leftSmoothly = this.track !== null && centre !== null && distance >= Math.max(target.radius * MOUTH_HOLD.nearFactor * 2, MOUTH_HOLD.leaveDistance * target.torso);
    const since = t - (this.lastNear?.t ?? -Infinity);
    if (leftSmoothly || since > MOUTH_HOLD.exitMs || !this.lastNear) {
      this.reset();
      return live(false);
    }
    return { pose: holdArm(pose, this.lastNear.pose, side), atMouth: true, contact: since <= MOUTH_HOLD.contactGapMs, unsure: since > MOUTH_HOLD.contactGapMs, seen: true, held: true };
  }
}

/** The live pose with the affected elbow, wrist and hand taken from the last reading by the mouth. */
export function holdArm(pose: PoseInput | null, near: PoseInput, side: Side): PoseInput {
  if (!pose) return near;
  const joints = poseJoints(side);
  const arm = [joints.elbow, joints.wrist, ...(side === "left" ? [17, 19, 21] : [18, 20, 22])];
  const landmarks = [...pose.landmarks];
  const world = [...pose.world];
  for (const index of arm) {
    if (near.landmarks[index]) landmarks[index] = near.landmarks[index];
    if (near.world[index]) world[index] = near.world[index];
  }
  return { landmarks, world };
}
