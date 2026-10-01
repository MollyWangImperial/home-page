import { poseJoints, type Frame, type PoseInput, type Pt, type Geo } from "./metrics";
import type { Side } from "./config";

export type MouthPoint = { x: number; y: number };
const visible = (point: Pt | undefined): point is Pt => !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 1) >= 0.5 && point.x > 0.01 && point.x < 0.99 && point.y > 0.01 && point.y < 0.99;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export function observedMouth(pose: PoseInput | null): MouthPoint | undefined {
  const left = pose?.landmarks[9], right = pose?.landmarks[10];
  return visible(left) && visible(right) ? { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 } : undefined;
}

/** The affected pose's index, pinky and thumb are available without starting another model. */
export function mouthContactPoints(pose: PoseInput | null, side: Side): Pt[] {
  if (!pose || !visible(pose.landmarks[poseJoints(side).wrist])) return [];
  return (side === "left" ? [19, 17, 21] : [20, 18, 22]).map(index => pose.landmarks[index]).filter(visible);
}

/** Raw camera coordinates; the overlay alone mirrors them when drawing. */
export function mouthContact(pose: PoseInput | null, side: Side, target: MouthPoint, radius: number, aspect: number) {
  return mouthContactPoints(pose, side).some(point => Math.hypot((point.x - target.x) * aspect, point.y - target.y) <= radius);
}

export function mouthCompensations(pose: PoseInput, side: Side, reference: Geo | null, values: Frame["comps"]): Frame["comps"] {
  const comps = { ...values };
  const indices = [0, poseJoints(side).ear];
  if (!reference || !Number.isFinite(reference.nosePitch) || indices.some(index => !visible(pose.landmarks[index]) || !pose.world[index] || ![pose.world[index].x, pose.world[index].y, pose.world[index].z].every(Number.isFinite))) {
    comps.head_drop_deg = undefined;
  }
  return comps;
}

/** Median of a stable visible-face cluster, learned only while the hand rests on the lap. */
export class MouthCalibration {
  private frames: Frame[] = [];
  observe(frame: Frame): MouthPoint | null {
    this.frames.push(frame);
    this.frames = this.frames.filter(sample => sample.t >= frame.t - 800);
    const valid = this.frames.filter(sample => sample.visible && sample.lapRest && sample.mouthPoint && Number.isFinite(sample.mouthPoint.x) && Number.isFinite(sample.mouthPoint.y));
    if (valid.length < 8) return null;
    const point = { x: median(valid.map(sample => sample.mouthPoint!.x)), y: median(valid.map(sample => sample.mouthPoint!.y)) };
    const stable = valid.filter(sample => Math.hypot(sample.mouthPoint!.x - point.x, sample.mouthPoint!.y - point.y) <= sample.lapRest!.bodyScale * 0.06);
    return stable.length >= 8 && stable.length / this.frames.length >= 0.8 && stable.at(-1) === frame && frame.t - stable[0].t >= 400 ? point : null;
  }
}
