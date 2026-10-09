// "Other hand helping" for the seated arm tasks (reach, hand to mouth), from the body model alone: the other hand
// lifted off the lap and brought to the affected forearm (holding or lifting it). Engineering default, to be reviewed.

import type { Side } from "../exercise-engine/config";
import { inView, poseJoints, type PoseInput, type Pt } from "../exercise-engine/metrics";

/** The other wrist counts as lifted off the lap this far above its hip, in torso lengths. */
export const OTHER_HAND_LIFT = 0.15;
/** Near the affected forearm: within this many shoulder spans of the elbow-to-wrist segment (the measure is 1 there). */
export const OTHER_HAND_REACH = 0.45;

/** Distance from p to the segment a-b, in frame heights (x scaled by the aspect). */
function toSegment(p: Pt, a: Pt, b: Pt, aspect: number): number {
  const px = p.x * aspect, ax = a.x * aspect, bx = b.x * aspect;
  const dx = bx - ax, dy = b.y - a.y, length = dx * dx + dy * dy;
  const k = length > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(px - (ax + k * dx), p.y - (a.y + k * dy));
}

/**
 * other_hand_arm: 0 while the other hand rests (not lifted off the lap); once lifted, OTHER_HAND_REACH shoulder spans
 * over its distance from the affected forearm, so 1 at that distance and more when closer (capped at 10). Undefined
 * when the other wrist, both shoulders, the other hip or the affected forearm are out of view.
 */
export function otherHandArm(pose: PoseInput | null, side: Side, aspect: number): number | undefined {
  const lm = pose?.landmarks, j = poseJoints(side);
  if (!lm) return undefined;
  const wrist = lm[j.wrist], elbow = lm[j.elbow], other = lm[j.wristOther];
  const shoulder = lm[j.shoulder], shoulderOther = lm[j.shoulderOther], hipOther = lm[j.hipOther];
  if (![wrist, elbow, other, shoulder, shoulderOther, hipOther].every(point => inView(point))) return undefined;
  const span = Math.hypot((shoulder.x - shoulderOther.x) * aspect, shoulder.y - shoulderOther.y);
  const torso = Math.abs(hipOther.y - shoulderOther.y);
  if (span < 0.02 || torso < 0.05) return undefined;
  if (other.y > hipOther.y - OTHER_HAND_LIFT * torso) return 0;
  return Math.min(10, (OTHER_HAND_REACH * span) / Math.max(1e-3, toSegment(other, elbow, wrist, aspect)));
}
