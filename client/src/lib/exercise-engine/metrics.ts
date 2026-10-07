// Turns MediaPipe landmarks into the per-frame numbers the exercise engine scores.
// Angles come from world landmarks (metres, 3D) so a front-on phone camera still gives usable joint angles.
// Everything here is a camera estimate, not a goniometer reading.

import type { Compensation, Side } from "./config";

export type Pt = { x: number; y: number; z: number; visibility?: number };
export type PoseInput = { landmarks: Pt[]; world: Pt[] };
export type HandInput = { landmarks: Pt[]; world: Pt[] };
export type LapRest = { x: number; y: number; bodyScale: number };

/** One processed camera frame (or one simulated frame) as the session controller sees it. */
export type Frame = {
  /** ms timestamp. */
  t: number;
  /** ROM metric values, keyed by RomStep.metric. A missing key means "not measurable this frame". */
  values: Record<string, number | undefined>;
  /** Compensation measures, keyed by Compensation.metric; units come from the rule. */
  comps: Record<string, number | undefined>;
  /** Everything the exercise needs is in view. */
  visible: boolean;
  targetContact?: boolean;
  /** The hand was at the target moments ago and tracking has briefly lost it: the hold pauses, nothing resets. */
  targetUnsure?: boolean;
  targetProgress?: number;
  /** What is missing, in the patient's words, when not visible. */
  missing?: string;
  /** Scalar pose snapshot used to learn resting positions. */
  geo?: Geo;
  /** Affected wrist confirmed at the visible upper thigh, for seated reach setup only. */
  lapRest?: LapRest;
  lapMissing?: string;
  /** Observed mouth midpoint during seated setup, before an approaching hand can occlude it. */
  mouthPoint?: { x: number; y: number };
};

const RAD = 180 / Math.PI;
type V3 = [number, number, number];
const sub = (a: Pt, b: Pt): V3 => [a.x - b.x, a.y - b.y, a.z - b.z];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

export function angleBetween(a: V3, b: V3): number {
  const l = len(a) * len(b);
  if (!l) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / l))) * RAD;
}
/** Interior angle at b between a-b and c-b. 180 = straight. */
export function angleAt(a: Pt, b: Pt, c: Pt): number {
  return angleBetween(sub(a, b), sub(c, b));
}

// MediaPipe pose landmark indices (right side = even, left = odd, for the paired joints).
const POSE = { nose: 0, earL: 7, earR: 8, shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16, hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28, heelL: 29, heelR: 30, footL: 31, footR: 32 };
const pick = (side: Side, left: number, right: number) => (side === "left" ? left : right);
const other = (side: Side): Side => (side === "left" ? "right" : "left");

export function poseJoints(side: Side) {
  return {
    nose: POSE.nose,
    ear: pick(side, POSE.earL, POSE.earR),
    shoulder: pick(side, POSE.shoulderL, POSE.shoulderR),
    elbow: pick(side, POSE.elbowL, POSE.elbowR),
    wrist: pick(side, POSE.wristL, POSE.wristR),
    hip: pick(side, POSE.hipL, POSE.hipR),
    knee: pick(side, POSE.kneeL, POSE.kneeR),
    ankle: pick(side, POSE.ankleL, POSE.ankleR),
    foot: pick(side, POSE.footL, POSE.footR),
    shoulderOther: pick(other(side), POSE.shoulderL, POSE.shoulderR),
    hipOther: pick(other(side), POSE.hipL, POSE.hipR),
  };
}

/** Landmarks each exercise needs in view, with what to tell the patient if one is missing. */
export type Need = { joint: keyof ReturnType<typeof poseJoints>; say: string };
export const POSE_NEEDS: Record<string, Need[]> = {
  upper: [
    { joint: "nose", say: "Lower the phone a little so I can see your face." },
    { joint: "shoulder", say: "Lift the phone a little so I can see your shoulder." },
    { joint: "shoulderOther", say: "Move so both of your shoulders are in view." },
    { joint: "elbow", say: "Sit back a little so I can see your whole arm." },
    { joint: "wrist", say: "Bring your hand into view." },
    { joint: "hip", say: "Move the phone back a little so I can see the top of your thigh." },
  ],
  lower: [
    { joint: "hip", say: "Move the phone back until I can see your hips, knees and feet." },
    { joint: "knee", say: "Move the phone back until I can see your hips, knees and feet." },
    { joint: "ankle", say: "Tilt the phone down so I can see your feet." },
    { joint: "foot", say: "Tilt the phone down so I can see your toes." },
  ],
};

function inView(p: Pt | undefined, min = 0.5): boolean {
  if (!p) return false;
  const vis = p.visibility ?? 1;
  return vis >= min && p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.99;
}

export function poseVisibility(pose: PoseInput | null, side: Side, group: "upper" | "lower"): { ok: boolean; missing?: string } {
  if (!pose) return { ok: false, missing: "I can't see you yet. Sit in front of the camera." };
  const joints = poseJoints(side);
  for (const need of POSE_NEEDS[group]) {
    if (!inView(pose.landmarks[joints[need.joint]])) return { ok: false, missing: need.say };
  }
  return { ok: true };
}

/** Scalar snapshot of posture; resting values are the median of a few of these. */
export type Geo = Record<"tx" | "ty" | "tz" | "hx" | "hy" | "hz" | "shoulderTilt" | "hipTilt" | "nosePitch" | "anklePitch" | "rest_shoulder_flexion" | "rest_elbow_interior" | "rest_shoulder_abduction" | "rest_knee_extension", number> & {
  faceEyeSpan?: number; faceHeight?: number; shoulderWidth?: number; shoulderEarGap?: number;
  /** Image distance between the eye centres. Uses the eyes only, so a hand at the mouth cannot hide it. */
  eyeSpan?: number;
  /** Height of the eye line above the unaffected shoulder, in shoulder widths. A lifting affected arm cannot shift it. */
  headLift?: number;
};

/** Apparent face size in the image. Both dimensions must grow to indicate camera approach.
 * Shoulder landmarks do not contribute, so a shoulder hike cannot increase this measure.
 * Head rotation tends to shrink one dimension; missing face points stay unmeasured. */
export function faceGeometry(pose: PoseInput): Pick<Geo, "faceEyeSpan" | "faceHeight"> {
  const [eyeLeft, eyeRight, mouthLeft, mouthRight] = [2, 5, 9, 10].map(i => pose.landmarks[i]);
  if (![eyeLeft, eyeRight, mouthLeft, mouthRight].every(p => inView(p))) return {};
  const eyes = mid(eyeLeft, eyeRight);
  const mouth = mid(mouthLeft, mouthRight);
  const faceEyeSpan = Math.hypot(eyeLeft.x - eyeRight.x, eyeLeft.y - eyeRight.y);
  const faceHeight = Math.hypot(eyes.x - mouth.x, eyes.y - mouth.y);
  return faceEyeSpan > 0.005 && faceHeight > 0.005 ? { faceEyeSpan, faceHeight } : {};
}

/** Check the selected hand at the visible top of its thigh; knees/full lap are not required. */
export function reachLapRest(pose: PoseInput | null, side: Side): { lapRest?: LapRest; lapMissing?: string } {
  const name = side === "left" ? "left" : "right";
  if (!pose) return { lapMissing: "Sit in front of the camera so I can see you." };
  const joints = poseJoints(side);
  const wrist = pose.landmarks[joints.wrist];
  const hip = pose.landmarks[joints.hip];
  const shoulder = pose.landmarks[joints.shoulder];
  const opposite = pose.landmarks[joints.shoulderOther];
  if (!inView(wrist)) return { lapMissing: `Bring your ${name} hand into view and rest it on your lap.` };
  if (!inView(hip)) return { lapMissing: `Move the camera back a little so I can see the top of your ${name} thigh.` };
  if (!inView(shoulder) || !inView(opposite)) return { lapMissing: "Move so both shoulders are in view." };
  const torso = hip.y - shoulder.y;
  const width = Math.abs(shoulder.x - opposite.x);
  if (torso < 0.12 || width < 0.08) return { lapMissing: "Adjust the camera so your shoulders and the top of your thigh are clearly visible." };
  if (wrist.y < hip.y - torso * 0.3) return { lapMissing: `Lower your ${name} hand and rest it on the visible top of your ${name} thigh.` };
  if (wrist.y > hip.y + torso * 0.55) return { lapMissing: `Bring your ${name} hand onto the visible top of your ${name} thigh.` };
  if (Math.abs(wrist.x - hip.x) > Math.max(width * 0.55, torso * 0.25)) return { lapMissing: `Rest your ${name} hand on your ${name} thigh, closer to your body.` };
  return { lapRest: { x: wrist.x, y: wrist.y, bodyScale: torso } };
}

/** Percent increase in apparent face size since setup; a camera estimate, not an angle. */
export function faceApproachPercent(current: Pick<Geo, "faceEyeSpan" | "faceHeight">, reference: Pick<Geo, "faceEyeSpan" | "faceHeight">): number | undefined {
  if (!current.faceEyeSpan || !current.faceHeight || !reference.faceEyeSpan || !reference.faceHeight) return undefined;
  return Math.max(0, (Math.min(current.faceEyeSpan / reference.faceEyeSpan, current.faceHeight / reference.faceHeight) - 1) * 100);
}

// Seated front camera model behind the hand-to-mouth lean checks (engineering defaults, needs clinician review).
// Under a rigid forward trunk lean about the hips, the face is farther from the pivot than the shoulders, so
// its apparent size grows about 1.5 times as fast (log scale) as the shoulder span, and the eye line sinks
// toward the shoulder line by up to about half the shoulder growth. Both are removed before head movement
// is measured, so a trunk lean is reported as the trunk, not also as the head.
const TRUNK_FACE_GROWTH_EXPONENT = 1.6;
const TRUNK_EYE_DROP_PER_APPROACH = 0.5;
/** A typical phone or laptop front camera's focal length in image widths (about a 65° field of view). */
const FRONT_CAMERA_FOCAL = 0.75;

/**
 * Hand-to-mouth lean measures against the upright setup posture, from image landmarks only (eyes and
 * shoulders: the hand at the mouth cannot hide them, and the noisy world depth is not used).
 * - trunk_approach_pct: the shoulders AND the face came closer to the camera (the smaller of the two growths).
 * - head_drop_pct: the eye line sank toward the unaffected shoulder, in % of shoulder width, beyond a trunk lean.
 * - head_approach_pct: the face grew beyond what the shoulders' approach explains, in %.
 * - head_forward_pct: the head's travel relative to the trunk, down and toward the camera, in % of shoulder width
 *   (12% is about 4.5 cm for an adult).
 */
export function headLeanMetrics(geo: Geo, ref: Geo): Frame["comps"] {
  const out: Frame["comps"] = {};
  const shoulders = geo.shoulderWidth && ref.shoulderWidth ? geo.shoulderWidth / ref.shoulderWidth : undefined;
  const face = geo.eyeSpan && ref.eyeSpan ? geo.eyeSpan / ref.eyeSpan : undefined;
  if (shoulders === undefined || face === undefined) return out;
  out.trunk_approach_pct = Math.max(0, (Math.min(shoulders, face) - 1) * 100);
  if (geo.headLift === undefined || ref.headLift === undefined) return out;
  // A narrowing shoulder span (the affected shoulder rolling forward) must not inflate head movement.
  const trunk = Math.max(1, shoulders);
  const down = Math.max(0, ref.headLift - geo.headLift - TRUNK_EYE_DROP_PER_APPROACH * (trunk - 1));
  const growth = Math.max(0, face / trunk ** TRUNK_FACE_GROWTH_EXPONENT - 1);
  // Face growth is forward travel over the camera distance; the camera is about focal / apparent width
  // shoulder widths away, which turns the growth into shoulder widths of forward travel.
  const forward = growth * Math.max(1, Math.min(3, FRONT_CAMERA_FOCAL / ref.shoulderWidth!));
  out.head_drop_pct = down * 100;
  out.head_approach_pct = growth * 100;
  out.head_forward_pct = Math.hypot(down, forward) * 100;
  return out;
}

/** Threshold ratio for the primary signal OR an alternative group of corroborating signals. */
export function compensationStatus(values: Frame["comps"], rule: Compensation): { ratio: number | undefined; over: boolean } {
  const primary = values[rule.metric];
  const ratios: number[] = typeof primary === "number" && Number.isFinite(primary) ? [primary / rule.thresholdDeg] : [];
  if (rule.alternative?.every(signal => typeof values[signal.metric] === "number" && Number.isFinite(values[signal.metric]))) {
    ratios.push(Math.min(...rule.alternative.map(signal => values[signal.metric]! / signal.threshold)));
  }
  const ratio = ratios.length ? Math.max(0, ...ratios) : undefined;
  return { ratio, over: ratio !== undefined && ratio >= 1 };
}

const tilt = (a: Pt, b: Pt) => Math.atan2(a.y - b.y, Math.abs(a.x - b.x) || 1e-6) * RAD;

export function geoFrom(pose: PoseInput, side: Side): Geo {
  const j = poseJoints(side);
  const w = pose.world;
  const shoulderMid = mid(w[POSE.shoulderL], w[POSE.shoulderR]);
  const hipMid = mid(w[POSE.hipL], w[POSE.hipR]);
  const trunk = sub(shoulderMid, hipMid);
  const thigh = sub(w[j.knee], w[j.hip]);
  const earNose = sub(w[j.nose], w[j.ear]);
  const face = faceGeometry(pose);
  const p = pose.landmarks;
  // Horizontal span excludes the vertical movement of a unilateral shoulder hike.
  const shoulderWidth = inView(p[11]) && inView(p[12]) ? Math.abs(p[11].x - p[12].x) : undefined;
  // Divide by shoulder width so camera approach changes size without shortening this gap.
  const shoulderEarGap = shoulderWidth && inView(p[j.shoulder]) && inView(p[j.ear])
    ? (p[j.shoulder].y - p[j.ear].y) / shoulderWidth : undefined;
  // Head position from the eyes, which stay visible while a hand or cup covers the mouth. The unaffected
  // shoulder is the vertical reference: the affected shoulder point drifts upward as that arm lifts.
  const eyes = inView(p[2]) && inView(p[5]) ? { span: Math.hypot(p[2].x - p[5].x, p[2].y - p[5].y), y: (p[2].y + p[5].y) / 2 } : undefined;
  const headLift = eyes && shoulderWidth && shoulderWidth > 0.02 && inView(p[j.shoulderOther]) ? (p[j.shoulderOther].y - eyes.y) / shoulderWidth : undefined;
  return {
    ...face,
    shoulderWidth: shoulderWidth && shoulderWidth > 0.02 ? shoulderWidth : undefined,
    shoulderEarGap: shoulderEarGap && shoulderEarGap > 0.05 ? shoulderEarGap : undefined,
    eyeSpan: eyes && eyes.span > 0.005 ? eyes.span : undefined,
    headLift,
    tx: trunk[0], ty: trunk[1], tz: trunk[2],
    hx: thigh[0], hy: thigh[1], hz: thigh[2],
    // Positive = the affected shoulder / hip sits higher than the other side.
    shoulderTilt: -tilt(w[j.shoulder], w[j.shoulderOther]),
    hipTilt: -tilt(w[j.hip], w[j.hipOther]),
    nosePitch: Math.atan2(earNose[1], Math.hypot(earNose[0], earNose[2]) || 1e-6) * RAD,
    anklePitch: angleAt(w[j.knee], w[j.ankle], w[j.foot]),
    rest_shoulder_flexion: angleBetween(sub(w[j.elbow], w[j.shoulder]), sub(w[j.hip], w[j.shoulder])),
    rest_elbow_interior: angleAt(w[j.shoulder], w[j.elbow], w[j.wrist]),
    rest_shoulder_abduction: abduction(w, j),
    rest_knee_extension: angleAt(w[j.hip], w[j.knee], w[j.ankle]),
  };
}

function abduction(w: Pt[], j: ReturnType<typeof poseJoints>): number {
  const arm: V3 = [w[j.elbow].x - w[j.shoulder].x, w[j.elbow].y - w[j.shoulder].y, 0];
  const down: V3 = [w[j.hip].x - w[j.shoulder].x, w[j.hip].y - w[j.shoulder].y, 0];
  return angleBetween(arm, down);
}

export function medianGeo(samples: Geo[]): Geo | null {
  if (!samples.length) return null;
  const out = {} as Geo;
  const keys = new Set(samples.flatMap(sample => Object.keys(sample)) as (keyof Geo)[]);
  keys.forEach(key => {
    const sorted = samples.map(sample => sample[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
    if (sorted.length) out[key] = sorted[Math.floor(sorted.length / 2)];
  });
  return out;
}

/** Pose-derived ROM values and compensation deltas against the learned resting posture. */
export function poseFrameValues(pose: PoseInput, side: Side, ref: Geo | null): Pick<Frame, "values" | "comps" | "geo"> {
  const geo = geoFrom(pose, side);
  const values: Frame["values"] = {
    shoulder_flexion: geo.rest_shoulder_flexion,
    elbow_extension: geo.rest_elbow_interior,
    elbow_flexion: 180 - geo.rest_elbow_interior,
    shoulder_abduction: geo.rest_shoulder_abduction,
    knee_extension: geo.rest_knee_extension,
  };
  const comps: Frame["comps"] = {};
  if (ref) {
    const trunk: V3 = [geo.tx, geo.ty, geo.tz];
    const refTrunk: V3 = [ref.tx, ref.ty, ref.tz];
    comps.trunk_lean_delta = angleBetween(trunk, refTrunk);
    comps.face_approach_pct = faceApproachPercent(geo, ref);
    if (geo.faceEyeSpan && geo.faceHeight && ref.faceEyeSpan && ref.faceHeight) {
      comps.face_mean_growth_pct = Math.max(0, ((geo.faceEyeSpan / ref.faceEyeSpan + geo.faceHeight / ref.faceHeight) / 2 - 1) * 100);
    }
    if (geo.shoulderWidth && ref.shoulderWidth) comps.shoulder_approach_pct = Math.max(0, (geo.shoulderWidth / ref.shoulderWidth - 1) * 100);
    if (geo.shoulderEarGap && ref.shoulderEarGap) comps.shoulder_elevation_pct = Math.max(0, (1 - geo.shoulderEarGap / ref.shoulderEarGap) * 100);
    const side2d = (t: V3) => Math.atan2(t[0], -t[1]) * RAD;
    comps.trunk_side_lean_delta = Math.abs(side2d(trunk) - side2d(refTrunk));
    const joints = poseJoints(side);
    comps.shoulder_hike_delta = inView(pose.landmarks[joints.shoulder]) && inView(pose.landmarks[joints.shoulderOther]) ? Math.max(0, geo.shoulderTilt - ref.shoulderTilt) : undefined;
    comps.hip_hike_delta = Math.max(0, geo.hipTilt - ref.hipTilt);
    comps.head_drop_deg = Math.max(0, geo.nosePitch - ref.nosePitch);
    comps.knee_motion_delta = angleBetween([geo.hx, geo.hy, geo.hz], [ref.hx, ref.hy, ref.hz]);
    values.ankle_dorsiflexion = Math.max(0, ref.anklePitch - geo.anklePitch);
    Object.assign(comps, headLeanMetrics(geo, ref));
  }
  return { values, comps, geo };
}

// ---------- Hand ----------

// MediaPipe hand landmarks: wrist 0; thumb 1-4; index 5-8; middle 9-12; ring 13-16; little 17-20.
const FINGER_BASE = [5, 9, 13, 17];

export function handVisible(hand: HandInput | null): { ok: boolean; missing?: string } {
  if (!hand) return { ok: false, missing: "Hold your hand toward the camera so I can see every finger." };
  const tips = [4, 8, 12, 16, 20].map(i => hand.landmarks[i]);
  if (tips.some(p => !p || p.x < 0.01 || p.x > 0.99 || p.y < 0.01 || p.y > 0.99)) return { ok: false, missing: "Move your hand back a little so I can see every fingertip." };
  return { ok: true };
}

const fingerJoints = (finger: number) => {
  const base = FINGER_BASE[finger];
  return { mcp: base, pip: base + 1, dip: base + 2, tip: base + 3 };
};

/** Mean finger straightness in degrees (180 = every finger straight). */
export function fingerExtension(hand: HandInput): number {
  const w = hand.world;
  let sum = 0;
  for (let finger = 0; finger < 4; finger++) {
    const f = fingerJoints(finger);
    sum += (angleAt(w[f.mcp], w[f.pip], w[f.dip]) + angleAt(w[f.pip], w[f.dip], w[f.tip])) / 2;
  }
  return sum / 4;
}

/** Thumb meets the given finger: how far that finger has curled (degrees) and whether the tips touch. */
export function pinchState(hand: HandInput, finger: number): { flexion: number; contact: boolean } {
  const w = hand.world;
  const f = fingerJoints(finger);
  const palm = len(sub(w[0], w[9])) || 0.08;
  const gap = len(sub(w[4], w[f.tip]));
  const flexion = 180 - angleAt(w[f.mcp], w[f.pip], w[f.dip]);
  return { flexion, contact: gap / palm < 0.35 };
}

export function handFrameValues(hand: HandInput, pinchFinger: number): Pick<Frame, "values" | "comps"> {
  const pinch = pinchState(hand, pinchFinger);
  return {
    values: { finger_extension: fingerExtension(hand), pinch_flexion: pinch.contact ? pinch.flexion : 0 },
    comps: {},
  };
}

// ---------- Drawing ----------

export const POSE_LINES: [number, number][] = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32]];
export const HAND_LINES: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
