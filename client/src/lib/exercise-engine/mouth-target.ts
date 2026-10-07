import { geoFrom, poseFrameValues, poseJoints, type Frame, type PoseInput, type Pt, type Geo } from "./metrics";
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

/**
 * Hand-to-mouth's final pass over a frame's measures. The checks themselves (head_forward_pct,
 * trunk_approach_pct, shoulder_hike_delta) come from poseFrameValues; the world-landmark head pitch is kept
 * only as a diagnostic, and is left unmeasured when the nose or affected-side ear cannot be trusted.
 */
export function mouthCompensations(pose: PoseInput, side: Side, reference: Geo | null, values: Frame["comps"]): Frame["comps"] {
  const comps = { ...values };
  const indices = [0, poseJoints(side).ear];
  if (!reference || !Number.isFinite(reference.nosePitch) || indices.some(index => !visible(pose.landmarks[index]) || !pose.world[index] || ![pose.world[index].x, pose.world[index].y, pose.world[index].z].every(Number.isFinite))) {
    comps.head_drop_deg = undefined;
  }
  return comps;
}

// ---------- simulated seated patient (no-camera simulation and tests) ----------

type P3 = [number, number, number];
/**
 * A seated adult in metres, facing the camera: X toward the image right (the patient's left), Y up from the
 * hip centre, Z toward the camera. Indices are MediaPipe pose landmarks; the hands rest on the lap.
 */
const SEATED_BODY: Record<number, P3> = {
  0: [0, 0.64, 0.1],
  1: [0.015, 0.67, 0.085], 2: [0.032, 0.67, 0.08], 3: [0.047, 0.67, 0.072],
  4: [-0.015, 0.67, 0.085], 5: [-0.032, 0.67, 0.08], 6: [-0.047, 0.67, 0.072],
  7: [0.075, 0.655, -0.01], 8: [-0.075, 0.655, -0.01],
  9: [0.025, 0.6, 0.085], 10: [-0.025, 0.6, 0.085],
  11: [0.19, 0.5, 0], 12: [-0.19, 0.5, 0],
  13: [0.21, 0.22, 0.05], 14: [-0.21, 0.22, 0.05],
  15: [0.14, 0.08, 0.25], 16: [-0.14, 0.08, 0.25],
  17: [0.12, 0.07, 0.31], 18: [-0.12, 0.07, 0.31],
  19: [0.13, 0.08, 0.33], 20: [-0.13, 0.08, 0.33],
  21: [0.15, 0.1, 0.29], 22: [-0.15, 0.1, 0.29],
  23: [0.1, 0, 0], 24: [-0.1, 0, 0],
  25: [0.1, 0.02, 0.45], 26: [-0.1, 0.02, 0.45],
  27: [0.1, -0.42, 0.45], 28: [-0.1, -0.42, 0.45],
  29: [0.1, -0.45, 0.4], 30: [-0.1, -0.45, 0.4],
  31: [0.1, -0.45, 0.55], 32: [-0.1, -0.45, 0.55],
};
/** The affected (right-side) arm with the cup at the lips; mirrored for the left side. */
const HAND_AT_MOUTH: Record<number, P3> = { 14: [-0.2, 0.36, 0.18], 16: [-0.04, 0.55, 0.17], 18: [-0.03, 0.57, 0.19], 20: [-0.01, 0.6, 0.16], 22: [0, 0.59, 0.13] };
const NECK_PIVOT: P3 = [0, 0.52, -0.03];

export type SeatedPosture = {
  /** 0 = hand resting on the lap, 1 = cup at the lips. */
  hand?: number;
  /** Neck flexion that brings the face down and forward, degrees. */
  headFlexDeg?: number;
  /** Forward head travel without tilting (a chin poke), metres. */
  headForwardM?: number;
  /** Forward lean of the whole trunk about the hips, degrees. */
  trunkLeanDeg?: number;
  /** Affected shoulder raised toward the ear, metres. */
  shoulderHikeM?: number;
  /** Front camera height above the hips and distance from the hips, metres. */
  camera?: { y: number; z: number };
};

/** Rotate forward about a pivot (positive degrees move points above the pivot toward the camera and down). */
function flex([x, y, z]: P3, [, py, pz]: P3, degrees: number): P3 {
  const a = degrees * Math.PI / 180, dy = y - py, dz = z - pz;
  return [x, py + dy * Math.cos(a) - dz * Math.sin(a), pz + dy * Math.sin(a) + dz * Math.cos(a)];
}

/**
 * MediaPipe-style landmarks (image and world) of a seated patient seen by a front camera, for the
 * simulator and tests. A hand at the lips partly hides the mouth corners, as it does on camera.
 */
export function seatedPose(side: Side, posture: SeatedPosture = {}): PoseInput {
  const hand = Math.max(0, Math.min(1, posture.hand ?? 0));
  const camera = posture.camera ?? { y: 0.35, z: 1 };
  const mirror = side === "left" ? -1 : 1;
  const affected = new Set([14, 16, 18, 20, 22].map(index => (side === "left" ? index - 1 : index)));
  const shoulder = poseJoints(side).shoulder;
  const landmarks: Pt[] = [];
  const world: Pt[] = [];
  for (let index = 0; index < 33; index++) {
    let point = SEATED_BODY[index];
    if (affected.has(index)) {
      const [mx, my, mz] = HAND_AT_MOUTH[side === "left" ? index + 1 : index];
      const goal: P3 = [mx * mirror, my, mz];
      point = [point[0] + (goal[0] - point[0]) * hand, point[1] + (goal[1] - point[1]) * hand, point[2] + (goal[2] - point[2]) * hand];
    }
    // The tracked affected shoulder drifts up a little as its arm lifts; a hike raises it (and the elbow) further.
    if (index === shoulder) point = [point[0], point[1] + 0.01 * hand + (posture.shoulderHikeM ?? 0), point[2]];
    if (index === poseJoints(side).elbow) point = [point[0], point[1] + (posture.shoulderHikeM ?? 0), point[2]];
    if (index <= 10) {
      point = flex(point, NECK_PIVOT, posture.headFlexDeg ?? 0);
      point = [point[0], point[1], point[2] + (posture.headForwardM ?? 0)];
    }
    if (index <= 22) point = flex(point, [0, 0, 0], posture.trunkLeanDeg ?? 0);
    const visibility = hand >= 0.85 && (index === 9 || index === 10) ? 0.3 : 1;
    const depth = camera.z - point[2];
    // A 4:3 frame with a typical front camera (focal length 0.75 frame widths).
    landmarks.push({ x: 0.5 + 0.75 * point[0] / depth, y: 0.5 - (point[1] - camera.y) / depth, z: -0.75 * point[2] / camera.z, visibility });
    world.push({ x: point[0], y: -point[1], z: -point[2], visibility });
  }
  return { landmarks, world };
}

const smoothstep = (value: number) => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };
const SIM_REFERENCE: Partial<Record<Side, Geo>> = {};

/**
 * Compensation measures of the simulated patient, computed by the camera code from simulated landmarks.
 * A compensation builds up as the hand nears the mouth (as when someone leans in to meet a cup), so the
 * simulator's "leaning" patient produces a real head-forward signal rather than a number over a threshold.
 * A normal movement still dips the chin slightly (4°), as people do.
 */
export function simulatedMouthComps(level: number, compensations: string[], side: Side = "right"): Frame["comps"] {
  const hand = Math.max(0, Math.min(1, level));
  const lean = smoothstep((hand - 0.3) / 0.6);
  const reference = SIM_REFERENCE[side] ??= geoFrom(seatedPose(side), side);
  const pose = seatedPose(side, {
    hand,
    headFlexDeg: 4 * hand + (compensations.includes("head_forward") ? 20 * lean : 0),
    trunkLeanDeg: compensations.includes("trunk_forward") ? 12 * lean : 0,
    shoulderHikeM: compensations.includes("shoulder_hike") ? 0.11 * lean : 0,
  });
  return mouthCompensations(pose, side, reference, poseFrameValues(pose, side, reference).comps);
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
