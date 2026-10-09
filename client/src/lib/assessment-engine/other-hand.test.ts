import { describe, expect, it } from "vitest";
import type { PoseInput, Pt } from "../exercise-engine/metrics";
import { OTHER_HAND_LIFT, OTHER_HAND_REACH, otherHandArm } from "./other-hand";

const ASPECT = 16 / 9;
// MediaPipe indices: shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24 (left odd, right even).
const at = (x: number, y: number, visibility = 1): Pt => ({ x, y, z: 0, visibility });

/** A seated patient, affected side right: the right forearm raised (elbow below the wrist), the left hand on the lap. */
function pose(overrides: Record<number, Pt | undefined> = {}): PoseInput {
  const landmarks: Pt[] = Array.from({ length: 33 }, () => at(0.5, 0.5));
  landmarks[12] = at(0.30, 0.35); // right shoulder
  landmarks[11] = at(0.50, 0.35); // left shoulder
  landmarks[24] = at(0.32, 0.75); // right hip
  landmarks[23] = at(0.48, 0.75); // left hip: torso 0.4 on the other side
  landmarks[14] = at(0.40, 0.60); // right elbow
  landmarks[16] = at(0.40, 0.45); // right wrist: the forearm is vertical at x 0.40
  landmarks[15] = at(0.47, 0.72); // left wrist resting on the lap
  for (const [index, point] of Object.entries(overrides)) landmarks[Number(index)] = point as Pt;
  return { landmarks, world: [] };
}

describe("other hand helping (other_hand_arm)", () => {
  it("is 0 while the other hand rests on the lap", () => {
    expect(otherHandArm(pose(), "right", ASPECT)).toBe(0);
    // Just below the lift line still counts as resting.
    const line = 0.75 - OTHER_HAND_LIFT * 0.4;
    expect(otherHandArm(pose({ 15: at(0.47, line + 0.005) }), "right", ASPECT)).toBe(0);
  });

  it("stays below 1 when the other hand is lifted but far from the affected forearm", () => {
    const value = otherHandArm(pose({ 15: at(0.85, 0.50) }), "right", ASPECT)!;
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });

  it("is 1 at OTHER_HAND_REACH shoulder spans from the forearm, with x scaled by the aspect", () => {
    // Shoulder span 0.2 frame widths = 0.2·aspect frame heights; the other wrist sits that share of it to the side.
    const offset = (OTHER_HAND_REACH * 0.2 * ASPECT) / ASPECT;
    expect(otherHandArm(pose({ 15: at(0.40 + offset, 0.52) }), "right", ASPECT)).toBeCloseTo(1, 6);
    // Closer than that is above 1.
    expect(otherHandArm(pose({ 15: at(0.40 + offset / 2, 0.52) }), "right", ASPECT)).toBeCloseTo(2, 6);
  });

  it("is at least 1, capped at 10, with the other hand on the affected forearm", () => {
    expect(otherHandArm(pose({ 15: at(0.40, 0.52) }), "right", ASPECT)).toBe(10);
    expect(otherHandArm(pose({ 15: at(0.42, 0.50) }), "right", ASPECT)).toBeGreaterThanOrEqual(1);
  });

  it("measures the distance to the forearm segment, not to the hand alone", () => {
    // Beside the elbow end of the forearm, far from the wrist: still near the forearm.
    expect(otherHandArm(pose({ 15: at(0.43, 0.60) }), "right", ASPECT)).toBeGreaterThanOrEqual(1);
  });

  it("works for the left side with the joints mirrored", () => {
    const left = pose({
      11: at(0.70, 0.35), 12: at(0.50, 0.35), 23: at(0.68, 0.75), 24: at(0.52, 0.75),
      13: at(0.60, 0.60), 15: at(0.60, 0.45), 16: at(0.53, 0.72),
    });
    expect(otherHandArm(left, "left", ASPECT)).toBe(0);
    left.landmarks[16] = at(0.60, 0.52);
    expect(otherHandArm(left, "left", ASPECT)).toBe(10);
  });

  it("is undefined when the needed landmarks are not in view", () => {
    expect(otherHandArm(null, "right", ASPECT)).toBeUndefined();
    expect(otherHandArm({ landmarks: undefined as unknown as Pt[], world: [] }, "right", ASPECT)).toBeUndefined();
    expect(otherHandArm(pose({ 15: at(0.47, 0.72, 0.3) }), "right", ASPECT)).toBeUndefined();
    expect(otherHandArm(pose({ 15: undefined }), "right", ASPECT)).toBeUndefined();
    expect(otherHandArm(pose({ 14: at(0.40, 1.2) }), "right", ASPECT)).toBeUndefined();
    expect(otherHandArm(pose({ 16: at(0.40, 0.45, 0.1) }), "right", ASPECT)).toBeUndefined();
    expect(otherHandArm(pose({ 11: at(1.05, 0.35) }), "right", ASPECT)).toBeUndefined();
    expect(otherHandArm(pose({ 23: at(0.48, 0.75, 0.2) }), "right", ASPECT)).toBeUndefined();
  });

  it("is undefined when the body is too small to judge (shoulders together, no torso)", () => {
    expect(otherHandArm(pose({ 11: at(0.305, 0.35) }), "right", ASPECT)).toBeUndefined();
    expect(otherHandArm(pose({ 23: at(0.48, 0.37) }), "right", ASPECT)).toBeUndefined();
  });
});
