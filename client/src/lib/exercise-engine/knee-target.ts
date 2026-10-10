import type { Side } from "./config";
import { angleAt, inView, poseFrameValues, poseJoints, type Frame, type Geo, type LapRest, type PoseInput, type Pt } from "./metrics";
import { TARGET_COMPLETION_MS, TARGET_HOLD_MS } from "./target-timing";
import { drawTargetCompletion, drawTestingTarget } from "./target-visual";

// Seated Knee Extension on the shared target flow: a front camera with the patient seated, head to feet in view,
// feet flat on the floor. From the front the lower leg swings toward the camera, so straightening the knee hardly
// moves the foot in the picture: the knee angle comes from the pose model's 3D landmarks. Those read a leg pointing
// exactly straight at the camera poorly, so an arrow by the knee shows the foot coming forward toward the camera and a
// little out to the side, where the camera sees it straighten. A knee dial beside the shoulder shows the knee angle:
// a side view of a knee whose foot turns into the target circle as the knee straightens, with the same circle
// activation as the other exercises (a gauge of the knee, not a place for the real foot to go; the demonstration
// shows the same dial). The patient never has to move out of view: everything is done seated. Positions are raw
// (unmirrored) image coordinates: x in frame widths, y in frame heights; lengths in frame heights.

const DEG = 180 / Math.PI;
type P2 = { x: number; y: number };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The cycle's steps, by index (config.ts ex_lower_selective). */
export const KNEE_STEP = { lift: 0, lower: 1 } as const;

// ---------- the knee's measure and the set-up snapshot ----------

/** The lower leg's length in the picture (frame heights), knee to ankle. */
export function shinLength(knee: Pt, ankle: Pt, aspect: number) {
  return Math.hypot((ankle.x - knee.x) * aspect, ankle.y - knee.y);
}

/**
 * The knee's part of the posture snapshot (Geo), kept in the set-up reference: the affected knee and ankle in the
 * picture with the lower leg's image length, the other ankle in the picture, and the other knee's 3D angle.
 */
export function kneeGeo(pose: PoseInput, side: Side, aspect: number): Partial<Geo> {
  const lm = pose.landmarks, w = pose.world, j = poseJoints(side);
  const out: Partial<Geo> = {};
  const knee = lm[j.knee], ankle = lm[j.ankle], otherAnkle = lm[j.ankleOther];
  if (inView(knee) && inView(ankle)) {
    out.kneeImgX = knee.x; out.kneeImgY = knee.y; out.kneeShin = shinLength(knee, ankle, aspect);
    out.ankleImgX = ankle.x; out.ankleImgY = ankle.y;
  }
  if (inView(otherAnkle)) { out.otherAnkleImgX = otherAnkle.x; out.otherAnkleImgY = otherAnkle.y; }
  if ([j.hipOther, j.kneeOther, j.ankleOther].every(index => inView(lm[index])) && w[j.hipOther] && w[j.kneeOther] && w[j.ankleOther]) {
    out.otherKnee = angleAt(w[j.hipOther], w[j.kneeOther], w[j.ankleOther]);
  }
  return out;
}

/**
 * The knee's own compensation measures against the set-up reference:
 * - trunk_retreat_pct: leaning back, the shoulders AND the face both smaller in the picture (the mirror of
 *   leaning forward, trunk_approach_pct), in %;
 * - thigh_lift_pct: the affected knee higher in the picture than at set-up (the thigh lifting off the chair), in %
 *   of the resting lower leg's image length;
 * - other_leg_pct: the other ankle's travel in the picture since set-up, in % of that length;
 * - other_knee_delta: the other knee's 3D angle change since set-up, degrees.
 */
export function kneeComps(pose: PoseInput, geo: Geo, ref: Geo | null, side: Side, aspect: number): Frame["comps"] {
  const out: Frame["comps"] = {};
  if (!ref) return out;
  const lm = pose.landmarks, j = poseJoints(side);
  if (geo.shoulderWidth && ref.shoulderWidth && geo.eyeSpan && ref.eyeSpan) {
    out.trunk_retreat_pct = Math.max(0, (1 - Math.max(geo.shoulderWidth / ref.shoulderWidth, geo.eyeSpan / ref.eyeSpan)) * 100);
  }
  const shin = ref.kneeShin;
  if (shin && shin > 0.02) {
    const knee = lm[j.knee];
    if (inView(knee) && ref.kneeImgY !== undefined) out.thigh_lift_pct = Math.max(0, (ref.kneeImgY - knee.y) / shin * 100);
    const otherAnkle = lm[j.ankleOther];
    if (inView(otherAnkle) && ref.otherAnkleImgX !== undefined && ref.otherAnkleImgY !== undefined) {
      out.other_leg_pct = Math.hypot((otherAnkle.x - ref.otherAnkleImgX) * aspect, otherAnkle.y - ref.otherAnkleImgY) / shin * 100;
    }
  }
  if (geo.otherKnee !== undefined && ref.otherKnee !== undefined) out.other_knee_delta = Math.abs(geo.otherKnee - ref.otherKnee);
  return out;
}

/** A resting knee reads at most this (3D, degrees): beyond it the foot is out in front, not below the knee. */
const REST_KNEE_MAX_DEG = 130;
/** Both knees straighter than this (3D, degrees): the patient is standing. */
const STANDING_KNEE_DEG = 150;

/**
 * What set-up waits for, in the patient's words: head to feet in view with some space round them, both feet flat.
 * options.restAngle: whether the knee's 3D angle must read bent too (default yes; the toe lift leaves it out).
 */
export function kneeRestCheck(pose: PoseInput | null, side: Side, aspect: number, options: { restAngle?: boolean } = {}): { lapRest?: LapRest; lapMissing?: string } {
  if (!pose) return { lapMissing: "Sit in front of the camera so I can see you." };
  const lm = pose.landmarks, j = poseJoints(side);
  const seen = (...indices: number[]) => indices.every(index => inView(lm[index]));
  if (!seen(j.nose)) return { lapMissing: "Move the camera back so I can see you from your head to your feet." };
  if (!seen(j.shoulder, j.shoulderOther)) return { lapMissing: "Move the camera back so I can see both shoulders." };
  if (!seen(j.hip, j.hipOther)) return { lapMissing: "Sit facing the camera so I can see both hips." };
  if (!seen(j.knee, j.kneeOther)) return { lapMissing: "Move the camera back so I can see both knees." };
  // The ankles, not the toes: everything the exercise measures uses the ankle.
  if (!seen(j.ankle, j.ankleOther)) return { lapMissing: "Move the camera back, or tilt it down, so I can see both feet." };
  const knee = lm[j.knee], ankle = lm[j.ankle], otherAnkle = lm[j.ankleOther];
  // Standing up: both knees straight. The exercise is done sitting down.
  const w = pose.world;
  const angle = (hip: number, kneeAt: number, ankleAt: number) => (w[hip] && w[kneeAt] && w[ankleAt] ? angleAt(w[hip], w[kneeAt], w[ankleAt]) : undefined);
  const bentAngle = angle(j.hip, j.knee, j.ankle), otherAngle = angle(j.hipOther, j.kneeOther, j.ankleOther);
  if (bentAngle !== undefined && otherAngle !== undefined && Math.min(bentAngle, otherAngle) > STANDING_KNEE_DEG) {
    return { lapMissing: "Sit down on a chair facing the camera, with your knees bent and both feet flat on the floor." };
  }
  // Room round the body: the ankle first comes a little lower in the picture as the knee starts to straighten.
  if (lm[j.nose].y < 0.05) return { lapMissing: "Tilt the camera up a little so there is space above your head." };
  if (Math.max(ankle.y, otherAnkle.y) > 0.94) return { lapMissing: "Tilt the camera down a little so there is space below your feet." };
  if ([j.shoulder, j.shoulderOther, j.knee, j.kneeOther, j.ankle, j.ankleOther].some(index => lm[index].x < 0.04 || lm[index].x > 0.96)) {
    return { lapMissing: "Move the camera so you are in the middle of the picture." };
  }
  const shin = shinLength(knee, ankle, aspect);
  if (shin < 0.06) return { lapMissing: "Move the camera a little closer." };
  // Feet flat on the floor: each lower leg hangs down from its knee, and both ankles are level. From the front a foot
  // placed forward still looks below its knee, so the knee's 3D angle (generously, for its jitter) says it is bent.
  if (ankle.y - knee.y < 0.6 * shin || (options.restAngle !== false && bentAngle !== undefined && bentAngle > REST_KNEE_MAX_DEG)) return { lapMissing: "Put your foot flat on the floor, below your knee." };
  if (Math.abs(ankle.y - otherAnkle.y) > 0.25 * shin) return { lapMissing: "Put both feet flat on the floor, about hip-width apart." };
  return { lapRest: { x: ankle.x, y: ankle.y, bodyScale: shin } };
}

/**
 * One camera frame: the affected knee's angle (3D), the six checks and the set-up's resting foot. During the
 * movement only the affected leg has to stay in view; a check whose body part is out of view stays unmeasured.
 */
export function kneeFrame(det: { pose: PoseInput | null }, side: Side, t: number, aspect: number, ref: Geo | null): Frame {
  const pose = det.pose;
  if (!pose) return { t, values: {}, comps: {}, visible: false, missing: "Sit in front of the camera so I can see you.", ...kneeRestCheck(null, side, aspect) };
  const lm = pose.landmarks, j = poseJoints(side);
  const seen = (...indices: number[]) => indices.every(index => inView(lm[index]));
  const body = poseFrameValues(pose, side, ref);
  const geo = { ...body.geo!, ...kneeGeo(pose, side, aspect) } as Geo;
  const legSeen = seen(j.hip, j.knee, j.ankle);
  const trunkSeen = seen(j.shoulder, j.shoulderOther, j.hip, j.hipOther);
  const comps: Frame["comps"] = {
    trunk_approach_pct: body.comps.trunk_approach_pct,
    trunk_side_lean_delta: trunkSeen ? body.comps.trunk_side_lean_delta : undefined,
    hip_hike_delta: seen(j.hip, j.hipOther) ? body.comps.hip_hike_delta : undefined,
    ...kneeComps(pose, geo, ref, side, aspect),
  };
  return {
    t, values: { knee_extension: legSeen ? body.values.knee_extension : undefined }, comps, geo,
    visible: legSeen, missing: legSeen ? undefined : "Keep your knees and feet in view of the camera.",
    ...kneeRestCheck(pose, side, aspect),
  };
}

// ---------- the knee dial beside the body ----------

export type KneeDial = {
  /** The dial's knee, beside the affected shoulder at chest height, out from the body. */
  pivot: P2;
  /** The dial's lower leg length, frame heights. */
  radius: number;
  /** +1 when the affected side (and the dial's swinging foot) is toward +x in the raw image, else -1. */
  out: number;
};

/** The dial's angle (from straight down) where the target circle sits: the goal is always drawn here. */
export const DIAL_GOAL_DEG = 70;
/** The target circle's radius on the dial, a share of its lower leg. */
const DIAL_CIRCLE_SHARE = 0.3;
/** The dial's thigh, drawn from its knee back toward the body, as a share of its lower leg. */
const DIAL_THIGH_SHARE = 0.4;

/**
 * The dial from the set-up posture: beside the affected shoulder at chest height, out from the body, where the
 * patient sees it at eye level and the leg's own path (shown by the arrow at the foot) stays clear. A gauge of the
 * knee's straightening, not a place for the foot to go. Sized by the trunk and kept inside the picture.
 */
export function kneeDial(pose: PoseInput | null, side: Side, aspect: number): KneeDial | null {
  const lm = pose?.landmarks, j = poseJoints(side);
  const s = lm?.[j.shoulder], o = lm?.[j.shoulderOther], h = lm?.[j.hip], ho = lm?.[j.hipOther];
  if (!s || !o || !h || !ho || ![s, o, h, ho].every(p => inView(p))) return null;
  const width = Math.abs(s.x - o.x) * aspect;
  const torso = (h.y + ho.y) / 2 - (s.y + o.y) / 2;
  if (width < 0.04 || torso < 0.06) return null;
  const out = Math.sign(s.x - o.x) || 1;
  // Out from the shoulder past the arm, then the dial's thigh, its swing out to the goal and the circle (frame heights).
  const gap = 0.55 * width;
  const swing = DIAL_THIGH_SHARE + Math.sin(DIAL_GOAL_DEG / DEG) + DIAL_CIRCLE_SHARE + 0.12;
  const room = (out > 0 ? 0.98 - s.x : s.x - 0.02) * aspect - gap;
  const top = s.y + 0.15 * torso;
  const radius = Math.min(clamp(0.55 * torso, 0.1, 0.2), room / swing, (0.98 - top) / (1 + DIAL_CIRCLE_SHARE));
  if (radius < 0.07) return null;
  return { pivot: { x: s.x + out * (gap + DIAL_THIGH_SHARE * radius) / aspect, y: top }, radius, out };
}

/** Set-up estimates move the dial this share of the way each frame, so it settles steadily. */
export function followDial(last: KneeDial | null, next: KneeDial | null, share = 0.2): KneeDial | null {
  if (!next) return last;
  if (!last) return next;
  const mix = (a: number, b: number) => a + (b - a) * share;
  return { pivot: { x: mix(last.pivot.x, next.pivot.x), y: mix(last.pivot.y, next.pivot.y) }, radius: mix(last.radius, next.radius), out: next.out };
}

/** The dial's foot at `degrees` from straight down (raw image coordinates). */
export function dialPoint(dial: KneeDial, degrees: number, aspect: number): P2 {
  const a = degrees / DEG;
  return { x: dial.pivot.x + dial.out * Math.sin(a) * dial.radius / aspect, y: dial.pivot.y + Math.cos(a) * dial.radius };
}

/** Where the dial's foot is drawn for a movement progress (0 resting, 1 at the goal). */
export const dialDegrees = (progress: number) => clamp(Number.isFinite(progress) ? progress : 0, -0.15, 1.3) * DIAL_GOAL_DEG;
export const dialCircleRadius = (dial: KneeDial) => DIAL_CIRCLE_SHARE * dial.radius;

// ---------- each step's target ----------

/** The practice goal: a modest straightening from the resting knee, before the personal goal is learned. */
export function kneePracticeGoal(rest: number): number {
  return rest + clamp(0.35 * (170 - rest), 15, 30);
}
/** A practice lift not on target for this long comes closer: straighten as far as is comfortable. */
export const KNEE_EASE_MS = 12000, KNEE_EASED_DEG = 10;
/** Once on target, the knee may sag this much before it counts as off (a hold is not lost to a flicker). */
export const KNEE_HYSTERESIS_DEG = 4;
/**
 * The knee is down again within this share of the way from rest to the goal (at least KNEE_LOWER_MIN_DEG above
 * rest, so a small goal still leaves room for the 3D angle's jitter), with the foot down.
 */
export const KNEE_LOWER_SHARE = 0.3, KNEE_LOWER_MIN_DEG = 8;
/**
 * The foot back where it rested also counts with the knee a little further up (the 3D angle may not settle exactly
 * where it was at set-up), and, after this long lowering, at any angle: a foot on the floor where it rested is down.
 */
const KNEE_BACK_SHARE = 0.4, KNEE_LOWER_LENIENT_MS = 10000;
/** The resting foot's circle in the picture, and how far above its resting point the foot still counts as down. */
const FOOT_BACK_SHARE = 0.25, FOOT_DOWN_SHARE = 0.2;

export type KneeTargetInput = {
  value: number | undefined;
  /** The resting knee angle learned at set-up. */
  rest: number;
  /** The goal angle: the practice goal, or the goal learned in practice. */
  goal: number;
  lowering: boolean;
  /** The affected ankle now, and where it rested at set-up (its lower leg's image length as the scale). */
  ankle?: P2 | null;
  restFoot?: LapRest | null;
  aspect: number;
  armed: boolean;
  practice: boolean;
  t: number;
};

/**
 * Whether the knee is on this step's target, and how far along it is. Straighten: the knee at its goal (it stays
 * on target until it sags a few degrees below). Lower: the knee most of the way back with the foot down. From the
 * front a raised lower leg points at the camera, so the foot's place in the picture hardly changes as the knee
 * straightens: the foot alone never decides that it is down. A practice lift not on target for a while eases to a
 * small straightening.
 */
export class KneeTarget {
  private key = "";
  private on = false;
  private armedSince: number | null = null;
  private lastOn: number | null = null;
  private eased = false;

  reset() { this.key = ""; this.on = false; this.armedSince = null; this.lastOn = null; this.eased = false; }

  update(key: string, input: KneeTargetInput): { contact: boolean; progress: number; goal: number; eased: boolean } {
    if (key !== this.key) { this.reset(); this.key = key; }
    if (input.armed) this.armedSince ??= input.t;
    let goal = input.goal;
    if (input.practice && !input.lowering) {
      // Eased after a while without contact (since arming, or since the knee last sagged off the target).
      if (this.armedSince !== null && input.t - Math.max(this.armedSince, this.lastOn ?? -Infinity) >= KNEE_EASE_MS) this.eased = true;
      if (this.eased) goal = Math.min(goal, input.rest + KNEE_EASED_DEG);
    }
    const value = input.value;
    const measured = value !== undefined && Number.isFinite(value);
    const range = Math.max(1, goal - input.rest);
    const progress = measured ? (value - input.rest) / range : 0;
    if (input.lowering) {
      const foot = input.restFoot, ankle = input.ankle;
      const scale = foot?.bodyScale ?? 0;
      const back = Boolean(foot && ankle && scale > 0 && Math.hypot((ankle.x - foot.x) * input.aspect, ankle.y - foot.y) <= FOOT_BACK_SHARE * scale);
      const down = Boolean(foot && ankle && scale > 0 && ankle.y >= foot.y - FOOT_DOWN_SHARE * scale);
      const slack = this.on ? KNEE_HYSTERESIS_DEG : 0;
      const bent = measured && value - input.rest <= Math.max(KNEE_LOWER_SHARE * range, KNEE_LOWER_MIN_DEG) + slack;
      const nearlyBent = measured && value - input.rest <= Math.max(KNEE_BACK_SHARE * range, KNEE_LOWER_MIN_DEG) + slack;
      const lenient = this.armedSince !== null && input.t - this.armedSince >= KNEE_LOWER_LENIENT_MS;
      this.on = (down && bent) || (back && (nearlyBent || lenient));
    } else {
      this.on = measured && (this.on ? value >= goal - KNEE_HYSTERESIS_DEG : value >= goal);
    }
    if (this.on) this.lastOn = input.t;
    return { contact: this.on, progress, goal, eased: this.eased };
  }
}

// ---------- drawing the dial ----------

/** A dial in canvas pixels: its knee, its lower leg's length, and which way (+1 right, -1 left) its foot swings out. */
type DialPx = { x: number; y: number; r: number; dir: number };
const dialPx = (d: DialPx, degrees: number) => ({ x: d.x + d.dir * Math.sin(degrees / DEG) * d.r, y: d.y + Math.cos(degrees / DEG) * d.r });

/** The dial on the mirrored camera view, in canvas pixels. */
function liveDial(dial: KneeDial, width: number, height: number): DialPx {
  return { x: (1 - dial.pivot.x) * width, y: dial.pivot.y * height, r: dial.radius * height, dir: -dial.out };
}

/**
 * The dial's gauge without its circle: the path its foot travels, a side-view leg (thigh level on the chair, lower
 * leg turning out from the knee) whose foot follows the knee's straightening, and a "Knee angle" caption, so it
 * reads as a measure of the knee and not as a place for the real foot to go.
 */
/** Light: drawn on the pale demonstration canvas (dark text and path), rather than over the camera picture. */
function drawDialBase(ctx: CanvasRenderingContext2D, d: DialPx, progress: number, caption: string, light = false) {
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  for (let degrees = -8; degrees <= DIAL_GOAL_DEG + 18; degrees += 2) { const p = dialPx(d, degrees); if (degrees === -8) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
  ctx.strokeStyle = light ? "rgba(40,91,73,.35)" : "rgba(255,254,250,.6)"; ctx.lineWidth = Math.max(2, d.r * 0.05); ctx.setLineDash([6, 8]); ctx.stroke(); ctx.setLineDash([]);
  const foot = dialPx(d, dialDegrees(progress));
  ctx.strokeStyle = "rgba(40,91,73,.9)"; ctx.lineWidth = Math.max(5, d.r * 0.16);
  ctx.beginPath(); ctx.moveTo(d.x - d.dir * DIAL_THIGH_SHARE * d.r, d.y); ctx.lineTo(d.x, d.y); ctx.stroke();
  ctx.strokeStyle = "#e18e6d"; ctx.lineWidth = Math.max(4, d.r * 0.13);
  ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(foot.x, foot.y); ctx.stroke();
  ctx.fillStyle = "#fffefa";
  ctx.beginPath(); ctx.arc(d.x, d.y, Math.max(3, d.r * 0.07), 0, Math.PI * 2); ctx.fill();
  // The caption above the dial's thigh, so the gauge says what it measures.
  ctx.font = `800 ${Math.max(11, Math.round(d.r * 0.22))}px Manrope, sans-serif`;
  ctx.textAlign = "center";
  if (light) ctx.fillStyle = "#285b49";
  else { ctx.fillStyle = "#fffefa"; ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 5; }
  // Over the dial's thigh, clear of the circle's own label out at the goal.
  ctx.fillText(caption, d.x - d.dir * DIAL_THIGH_SHARE * d.r * 1.1, d.y - d.r * 0.3);
  ctx.restore();
}

/** The dial's foot, drawn over its circle so it can be seen entering it. */
function drawDialFoot(ctx: CanvasRenderingContext2D, d: DialPx, progress: number) {
  const foot = dialPx(d, dialDegrees(progress));
  ctx.save();
  ctx.fillStyle = "#fffefa"; ctx.strokeStyle = "#e18e6d"; ctx.lineWidth = Math.max(2, d.r * 0.04);
  ctx.beginPath(); ctx.arc(foot.x, foot.y, Math.max(4, d.r * 0.09), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

export type DialDrawing = {
  /** The movement's progress (0 resting, 1 at the goal) for the dial's foot. */
  progress: number;
  lowering: boolean;
  armed: boolean;
  contact: boolean;
  /** The hold's progress, 0-1. */
  hold: number;
  label: string;
  now: number;
  reducedMotion: boolean;
  /** A line under the dial (practice: that its foot moves with the patient's knee). */
  hint?: string;
};

/** The knee dial on the mirrored camera view: the gauge, and the active circle at the goal (straighten) or at rest (lower). */
export function drawKneeDial(ctx: CanvasRenderingContext2D, dial: KneeDial, width: number, height: number, state: DialDrawing) {
  const d = liveDial(dial, width, height);
  drawDialBase(ctx, d, state.progress, "Knee angle");
  const target = dialPx(d, state.lowering ? 0 : DIAL_GOAL_DEG);
  const radius = DIAL_CIRCLE_SHARE * d.r;
  drawTestingTarget(ctx, { x: target.x, y: target.y, radius, armed: state.armed, contact: state.contact, progress: state.hold, now: state.now, reducedMotion: state.reducedMotion });
  drawDialFoot(ctx, d, state.progress);
  // The circle's label below it (the dial's own caption is above), kept inside the picture.
  ctx.save();
  const labelPx = Math.max(14, Math.round(height / 28));
  ctx.font = `800 ${labelPx}px Manrope, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = state.armed ? "#fffefa" : "rgba(255,254,250,.7)"; ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 6;
  const labelHalf = ctx.measureText(state.label).width / 2;
  ctx.fillText(state.label, clamp(target.x, labelHalf + 8, Math.max(labelHalf + 8, width - labelHalf - 8)), Math.min(height - 8, target.y + radius + labelPx + 4));
  ctx.restore();
  if (state.hint) {
    // Under the dial's resting foot, kept inside the picture.
    ctx.save();
    const fontPx = Math.max(13, Math.round(height / 34));
    ctx.font = `800 ${fontPx}px Manrope, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#fffefa"; ctx.shadowColor = "rgba(0,0,0,.7)"; ctx.shadowBlur = 6;
    const half = ctx.measureText(state.hint).width / 2;
    const x = clamp(d.x, half + 8, Math.max(half + 8, width - half - 8));
    ctx.fillText(state.hint, x, Math.min(height - 8, d.y + d.r * (1 + DIAL_CIRCLE_SHARE) + fontPx * 1.1));
    ctx.restore();
  }
}

/** The circle the last step completed, in canvas pixels (for its completion animation). */
export function dialCircle(dial: KneeDial, lowering: boolean, width: number, height: number) {
  const d = liveDial(dial, width, height);
  return { ...dialPx(d, lowering ? 0 : DIAL_GOAL_DEG), radius: DIAL_CIRCLE_SHARE * d.r };
}

// ---------- the arrow at the foot: which way to straighten ----------

/**
 * Which way the foot goes, from the set-up posture. Straightening, it comes forward toward the camera and a little out
 * to the side: a long arrow from just out from the resting foot, rising gently out to the side, its head up and away
 * (`lift`). Lowering: the same path back to the resting foot (`lower`). Exactly straight at the camera, the camera can
 * hardly see the knee straighten; a little out to the side, it can.
 */
export type KneeGuide = { lift: { start: P2; control: P2; end: P2 }; lower: { start: P2; control: P2; end: P2 }; shin: number; out: number };

/** The lifting arrow's shape: its points out from the resting ankle and down from it, in lower legs (as on the mirrored view, out from the body). */
const GUIDE_LIFT = { start: [0.4, 0.22], control: [1.2, 0.22], end: [2, -0.55] } as const;

export function kneeGuide(ref: Geo | null, dial: KneeDial | null, aspect: number): KneeGuide | null {
  if (!ref || !dial || ref.kneeImgX === undefined || ref.kneeImgY === undefined || ref.ankleImgX === undefined || ref.ankleImgY === undefined || !ref.kneeShin) return null;
  const shin = ref.kneeShin, out = dial.out, ankleX = ref.ankleImgX, ankleY = ref.ankleImgY;
  // As far out as the picture allows (a phone held upright, or a patient off-centre, has less room on that side).
  const room = (out > 0 ? 0.96 - ankleX : ankleX - 0.04) * aspect;
  const reach = clamp((room - 0.02) / (GUIDE_LIFT.end[0] * shin), 0.35, 1);
  // Kept inside the picture.
  const fromAnkle = ([across, down]: readonly [number, number]): P2 => ({ x: clamp(ankleX + out * across * reach * shin / aspect, 0.03, 0.97), y: clamp(ankleY + down * shin, 0.03, 0.97) });
  const lift = { start: fromAnkle(GUIDE_LIFT.start), control: fromAnkle(GUIDE_LIFT.control), end: fromAnkle(GUIDE_LIFT.end) };
  return { lift, lower: { start: lift.end, control: lift.control, end: lift.start }, shin, out };
}

/** How long the arrow's bright pulse takes to sweep from the foot to the arrowhead, ms. */
const ARROW_SWEEP_MS = 1300;

/** A point along the arrow's curve (k 0 at its start, 1 at its end): quadratic through `c`, or cubic through `c` then `d`. */
const along = (a: P2, c: P2, b: P2, k: number, d?: P2): P2 => d
  ? { x: (1 - k) ** 3 * a.x + 3 * (1 - k) ** 2 * k * c.x + 3 * (1 - k) * k ** 2 * d.x + k ** 3 * b.x, y: (1 - k) ** 3 * a.y + 3 * (1 - k) ** 2 * k * c.y + 3 * (1 - k) * k ** 2 * d.y + k ** 3 * b.y }
  : { x: (1 - k) ** 2 * a.x + 2 * (1 - k) * k * c.x + k ** 2 * b.x, y: (1 - k) ** 2 * a.y + 2 * (1 - k) * k * c.y + k ** 2 * b.y };

/** A drawing arrow draws itself along its path over this long, ms, then stays whole for ARROW_GROWN_MS before drawing again. */
const ARROW_GROW_MS = 1300, ARROW_GROWN_MS = 700;

/**
 * A curved arrow (canvas pixels) with a label, and a dot running along it unless motion is reduced. With
 * `control2`, the curve is cubic (through `control`, then `control2`), for a path that curls back on itself. With
 * `grow`, it draws itself instead: a solid line growing from its start along the path, the head riding its tip.
 */
export function drawArrow(ctx: CanvasRenderingContext2D, from: P2, control: P2, to: P2, options: { width: number; label: string; emphasis: boolean; now: number; reducedMotion: boolean; labelAt: P2; fontPx: number; light?: boolean; bounds?: { width: number; height: number }; control2?: P2; grow?: boolean }) {
  if (options.grow) return drawGrowingArrow(ctx, from, control, to, options);
  ctx.save();
  ctx.globalAlpha = options.emphasis ? 1 : 0.5;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // Moving while the patient is asked to make this movement: the band breathes, the dashes flow toward the head, a
  // bright pulse sweeps from the foot along the path and the head throbs as it arrives. Still when motion is reduced.
  const animate = options.emphasis && !options.reducedMotion;
  const breathe = animate ? 0.5 + 0.5 * Math.sin((options.now / 900) * Math.PI * 2) : 0;
  const sweep = animate ? (options.now % ARROW_SWEEP_MS) / ARROW_SWEEP_MS : 0;
  const control2 = options.control2;
  const path = () => {
    ctx.beginPath(); ctx.moveTo(from.x, from.y);
    if (control2) ctx.bezierCurveTo(control.x, control.y, control2.x, control2.y, to.x, to.y);
    else ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
  };
  // A soft band under a dashed line, so it shows on any background.
  ctx.strokeStyle = `rgba(255,254,250,${0.4 + 0.25 * breathe})`; ctx.lineWidth = options.width * (2.2 + 0.6 * breathe);
  path(); ctx.stroke();
  const dash = options.width * 2.2, gap = options.width * 1.6;
  ctx.strokeStyle = "#e18e6d"; ctx.lineWidth = options.width; ctx.setLineDash([dash, gap]);
  if (animate) ctx.lineDashOffset = -((options.now / 1000) * options.width * 18) % (dash + gap);
  path(); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  if (animate) {
    // The pulse: a bright head with a fading tail, sweeping along the path toward the arrowhead.
    for (let i = 7; i >= 0; i--) {
      const k = sweep - i * 0.035;
      if (k < 0) continue;
      const p = along(from, control, to, Math.min(1, k), control2);
      ctx.fillStyle = `rgba(255,254,250,${(1 - i / 8) * 0.95})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, options.width * (1.15 - i * 0.1), 0, Math.PI * 2); ctx.fill();
    }
  }
  // The head, along the curve's last direction; it swells as the pulse reaches it.
  const tail = along(from, control, to, 0.9, control2);
  const arrive = animate ? Math.max(0, 1 - Math.abs(sweep - 0.95) / 0.18) : 0;
  const angle = Math.atan2(to.y - tail.y, to.x - tail.x), head = options.width * 3.4 * (1 + 0.15 * breathe + 0.3 * arrive);
  ctx.fillStyle = "#e18e6d"; ctx.strokeStyle = "rgba(255,254,250,.9)"; ctx.lineWidth = Math.max(1.5, options.width * 0.35);
  if (animate) { ctx.shadowColor = "rgba(255,226,200,.9)"; ctx.shadowBlur = options.width * (2 + 4 * arrive); }
  ctx.beginPath();
  ctx.moveTo(to.x + Math.cos(angle) * head * 0.4, to.y + Math.sin(angle) * head * 0.4);
  ctx.lineTo(to.x + Math.cos(angle + 2.5) * head, to.y + Math.sin(angle + 2.5) * head);
  ctx.lineTo(to.x + Math.cos(angle - 2.5) * head, to.y + Math.sin(angle - 2.5) * head);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.font = `800 ${options.fontPx}px Manrope, sans-serif`;
  ctx.textAlign = "center";
  ctx.globalAlpha = 1;
  if (options.light) ctx.fillStyle = "#a14d32";
  else { ctx.fillStyle = "#fffefa"; ctx.shadowColor = "rgba(0,0,0,.65)"; ctx.shadowBlur = 6; }
  // Kept inside the canvas (bounds given in the canvas's own units), however near the edge the arrow ends.
  let { x, y } = options.labelAt;
  if (options.bounds) {
    const half = ctx.measureText(options.label).width / 2, margin = 8;
    x = clamp(x, half + margin, Math.max(half + margin, options.bounds.width - half - margin));
    y = clamp(y, options.fontPx + margin, options.bounds.height - margin);
  }
  ctx.fillText(options.label, x, y);
  ctx.restore();
}

/**
 * drawArrow's drawing style: while the patient is asked to make the movement, a solid line draws itself from the
 * arrow's start along its path, the head riding the line's tip, then the whole arrow stays a moment and draws again.
 * Whole and still when motion is reduced, faint when not asked.
 */
function drawGrowingArrow(ctx: CanvasRenderingContext2D, from: P2, control: P2, to: P2, options: Parameters<typeof drawArrow>[4]) {
  const control2 = options.control2;
  const animate = options.emphasis && !options.reducedMotion;
  const t = animate ? options.now % (ARROW_GROW_MS + ARROW_GROWN_MS) : ARROW_GROW_MS;
  const k = smooth(unit(t / ARROW_GROW_MS));
  ctx.save();
  ctx.globalAlpha = options.emphasis ? 1 : 0.5;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // The line so far: whole, through the curve itself; growing, through points along it.
  const path = () => {
    ctx.beginPath(); ctx.moveTo(from.x, from.y);
    if (k >= 1) {
      if (control2) ctx.bezierCurveTo(control.x, control.y, control2.x, control2.y, to.x, to.y);
      else ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
    } else {
      const steps = Math.max(2, Math.ceil(k * 32));
      for (let i = 1; i <= steps; i++) { const p = along(from, control, to, (k * i) / steps, control2); ctx.lineTo(p.x, p.y); }
    }
  };
  if (k > 0.01) {
    // A soft band under the line, so it shows on any background.
    ctx.strokeStyle = "rgba(255,254,250,.55)"; ctx.lineWidth = options.width * 2.4;
    path(); ctx.stroke();
    ctx.strokeStyle = "#e18e6d"; ctx.lineWidth = options.width;
    path(); ctx.stroke();
    // The head at the tip, along the line's direction there.
    const tip = along(from, control, to, k, control2), back = along(from, control, to, Math.max(0, k - 0.04), control2);
    const angle = Math.atan2(tip.y - back.y, tip.x - back.x), head = options.width * 3.4;
    ctx.fillStyle = "#e18e6d"; ctx.strokeStyle = "rgba(255,254,250,.9)"; ctx.lineWidth = Math.max(1.5, options.width * 0.35);
    ctx.beginPath();
    ctx.moveTo(tip.x + Math.cos(angle) * head * 0.4, tip.y + Math.sin(angle) * head * 0.4);
    ctx.lineTo(tip.x + Math.cos(angle + 2.5) * head, tip.y + Math.sin(angle + 2.5) * head);
    ctx.lineTo(tip.x + Math.cos(angle - 2.5) * head, tip.y + Math.sin(angle - 2.5) * head);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.font = `800 ${options.fontPx}px Manrope, sans-serif`;
  ctx.textAlign = "center";
  ctx.globalAlpha = 1;
  if (options.light) ctx.fillStyle = "#a14d32";
  else { ctx.fillStyle = "#fffefa"; ctx.shadowColor = "rgba(0,0,0,.65)"; ctx.shadowBlur = 6; }
  let { x, y } = options.labelAt;
  if (options.bounds) {
    const half = ctx.measureText(options.label).width / 2, margin = 8;
    x = clamp(x, half + margin, Math.max(half + margin, options.bounds.width - half - margin));
    y = clamp(y, options.fontPx + margin, options.bounds.height - margin);
  }
  ctx.fillText(options.label, x, y);
  ctx.restore();
}

/**
 * The arrow on the mirrored camera view: forward toward the camera and a little out while straightening ("Straighten
 * toward the camera"), back down to where the foot rested while lowering ("Foot down here"). Bright while the step is
 * active and the knee is not yet at its goal; faint otherwise.
 */
export function drawKneeGuide(ctx: CanvasRenderingContext2D, guide: KneeGuide, width: number, height: number, state: { lowering: boolean; emphasis: boolean; now: number; reducedMotion: boolean }) {
  const px = (p: P2) => ({ x: (1 - p.x) * width, y: p.y * height });
  const lineWidth = Math.max(4, guide.shin * height * 0.05), fontPx = Math.max(14, Math.round(height / 30));
  const bounds = { width, height };
  const lowering = state.lowering, path = lowering ? guide.lower : guide.lift;
  const start = px(path.start), control = px(path.control), end = px(path.end);
  // The label under the path, reading outward from the foot's end of it (clear of the leg, and of the knee dial's
  // practice hint about level with the knee), or over it near the bottom edge; shortened, then smaller (down to 12 px),
  // in a narrow picture. Out from the body on the mirrored view is -out in the raw image.
  const foot = lowering ? end : start, sag = along(start, control, end, 0.5), below = Math.max(foot.y, sag.y) + lineWidth * 4.5;
  ctx.save(); ctx.font = `800 ${fontPx}px Manrope, sans-serif`;
  const full = lowering ? "Foot down here" : "Straighten toward the camera", short = lowering ? "Foot down" : "Toward the camera";
  const fullWidth = ctx.measureText(full).width, shortWidth = ctx.measureText(short).width;
  ctx.restore();
  const room = (guide.out < 0 ? width - foot.x : foot.x) - 8 + lineWidth, label = fullWidth <= room ? full : short, natural = label === full ? fullWidth : shortWidth;
  const labelPx = natural <= room ? fontPx : Math.max(12, Math.floor((fontPx * room) / natural)), half = (natural * labelPx) / fontPx / 2;
  drawArrow(ctx, start, control, end, {
    width: lineWidth, label, emphasis: state.emphasis, now: state.now, reducedMotion: state.reducedMotion, grow: true,
    labelAt: { x: foot.x - guide.out * (half - lineWidth), y: below <= height - 8 ? below : Math.min(foot.y, sag.y) - lineWidth * 3 }, fontPx: labelPx, bounds,
  });
}

// ---------- the demonstration and the no-camera simulator (front view, 300 x 270 drawing space) ----------

const MOVE_MS = 1400;
const smooth = (k: number) => k * k * (3 - 2 * k);
const unit = (k: number) => clamp(k, 0, 1);
const poseAt = (fraction: number, returning: boolean) => (returning ? 1 - smooth(fraction) : smooth(fraction));

/** The front-view figure for an affected right leg (drawn on the canvas's right, as the mirror shows it); a left leg is mirrored. */
const FRONT = {
  head: [150, 40] as const, shoulderA: [182, 82] as const, shoulderO: [118, 82] as const, hipA: [172, 156] as const, hipO: [128, 156] as const,
  kneeA: [178, 182] as const, kneeO: [122, 182] as const, ankleO: [121, 244] as const,
};
/**
 * The lower leg's length, how far the demonstration straightens it (degrees), and how far out to the side of straight
 * at the viewer it points as it does (degrees).
 */
const DEMO_SHIN = 62, DEMO_SWING = 70, DEMO_OUT = 22;
/** The demonstration's dial: beside the affected shoulder, as on the camera view. */
const DEMO_DIAL = { x: 240, y: 92, r: 46 };

/** The scene's x for the affected side: as drawn for a right leg, mirrored for a left. */
export const sideX = (x: number, side: Side) => (side === "left" ? 300 - x : x);

function demoDial(side: Side): DialPx {
  return { x: sideX(DEMO_DIAL.x, side), y: DEMO_DIAL.y, r: DEMO_DIAL.r, dir: side === "left" ? -1 : 1 };
}

/**
 * The demonstration's affected ankle at progress p, as the front camera sees the lower leg straighten toward it and a
 * little out to the side: pointing more at the viewer, it shows shorter, so the ankle rises toward the knee.
 */
function demoAnkle(p: number, side: Side): [number, number] {
  const a = (p * DEMO_SWING) / DEG, out = Math.sin(DEMO_OUT / DEG);
  const [kx, ky] = FRONT.kneeA;
  return [sideX(kx + DEMO_SHIN * Math.sin(a) * out, side), ky + DEMO_SHIN * Math.cos(a)];
}
/** How far toward the viewer the demonstration's foot has come at progress p (0 resting, 1 straightened). */
const demoForward = (p: number) => Math.sin((clamp(p, 0, 1.2) * DEMO_SWING) / DEG) / Math.sin(DEMO_SWING / DEG);

/**
 * The seated figure seen from the front, in the 300 x 270 drawing space (the caller has scaled to it): chair and
 * floor, head, trunk, both arms resting on the thighs, and the other leg. The affected leg is the caller's (the knee
 * straightens it, the toe lift lifts its toes; frontHip and frontKnee give where it starts).
 */
export function drawSeatedFront(ctx: CanvasRenderingContext2D, side: Side) {
  const P = (p: readonly [number, number]): [number, number] => [sideX(p[0], side), p[1]];
  const line = (points: [number, number][]) => { ctx.beginPath(); points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = "#b9d3c2"; ctx.lineWidth = 6;
  line([[100, 70], [100, 166]]); line([[200, 70], [200, 166]]); line([[96, 166], [204, 166]]);
  ctx.lineWidth = 3; line([[60, 258], [240, 258]]);
  ctx.strokeStyle = "#3c8255"; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(150, FRONT.head[1], 18, 0, Math.PI * 2); ctx.stroke();
  line([P(FRONT.shoulderO), P(FRONT.shoulderA)]);
  line([P(FRONT.shoulderO), P(FRONT.hipO), P(FRONT.hipA), P(FRONT.shoulderA)]);
  line([P(FRONT.shoulderO), P([110, 126]), P([134, 166])]);
  line([P(FRONT.shoulderA), P([190, 126]), P([166, 166])]);
  line([P(FRONT.hipO), P(FRONT.kneeO), P(FRONT.ankleO)]);
  line([P(FRONT.ankleO), P([117, 252])]);
  ctx.restore();
}

/** The front figure's affected knee, and where its foot rests, in the drawing space (mirrored for a left side). */
export const frontKnee = (side: Side): [number, number] => [sideX(FRONT.kneeA[0], side), FRONT.kneeA[1]];
export const frontHip = (side: Side): [number, number] => [sideX(FRONT.hipA[0], side), FRONT.hipA[1]];

/**
 * The front-view scene for the demonstration, the simulator and the screen previews: the seated figure as the
 * camera sees it, its affected lower leg straightening toward the viewer and a little out to the side (shorter as it
 * points at the viewer, the foot nearer and larger with its sole turning to face the viewer, its shadow coming
 * forward), the arrow, and the knee dial beside its shoulder filling toward its circle. The circle itself is drawn by
 * the caller (the shared target visuals).
 */
export function drawKneeScene(ctx: CanvasRenderingContext2D, width: number, height: number, state: { progress: number; lowering: boolean; side: Side; arrow: boolean; armed: boolean; now: number; reducedMotion: boolean }) {
  const s = Math.min(width / 300, height / 270);
  const side = state.side, dir = side === "left" ? -1 : 1;
  const P = (p: readonly [number, number]): [number, number] => [sideX(p[0], side), p[1]];
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.translate((width - 300 * s) / 2, (height - 270 * s) / 2);
  ctx.scale(s, s);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const line = (points: [number, number][]) => { ctx.beginPath(); points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
  drawSeatedFront(ctx, side);
  const [kx, ky] = P(FRONT.kneeA);
  // The arrow, as on the camera view: from just out from the resting foot, rising out to the side, drawing itself
  // while straightening; the same path back while lowering. A little shorter, to fit the drawing.
  if (state.arrow) {
    const [rx, ry] = demoAnkle(0, side);
    const fromAnkle = ([across, down]: readonly [number, number]): P2 => ({ x: rx + dir * across * 0.75 * DEMO_SHIN, y: Math.min(ry + down * DEMO_SHIN, 254) });
    const start = fromAnkle(GUIDE_LIFT.start), control = fromAnkle(GUIDE_LIFT.control), end = fromAnkle(GUIDE_LIFT.end);
    if (state.lowering) {
      drawArrow(ctx, end, control, start, {
        width: 3.4, label: "Foot down", emphasis: state.armed, now: state.now, reducedMotion: state.reducedMotion, grow: true,
        labelAt: { x: sideX(238, side), y: 266 }, fontPx: 11, light: true,
      });
    } else {
      drawArrow(ctx, start, control, end, {
        width: 3.4, label: "Toward the camera", emphasis: state.armed, now: state.now, reducedMotion: state.reducedMotion, grow: true,
        labelAt: { x: sideX(238, side), y: 266 }, fontPx: 11, light: true,
      });
    }
  }
  // The affected leg: the thigh, then the lower leg straightening toward the viewer, wider as it comes nearer; under
  // it the foot's shadow on the floor, coming forward (lower in the picture).
  const [ax, ay] = demoAnkle(state.progress, side);
  const forward = demoForward(state.progress), near = 1 + 0.6 * forward;
  ctx.fillStyle = "rgba(60,130,85,.18)";
  ctx.beginPath(); ctx.ellipse(ax, 252 + 8 * forward, 9 * near, 2.5 * near, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#e18e6d"; ctx.lineWidth = 9;
  line([P(FRONT.hipA), [kx, ky]]);
  ctx.lineWidth = 9 * (1 + 0.25 * forward);
  line([[kx, ky], [ax, ay]]);
  // The foot: resting, its top seen from the front; straightened, its sole facing the viewer, nearer and larger.
  ctx.fillStyle = forward > 0.3 ? "#f2c2ad" : "#e18e6d"; ctx.strokeStyle = "#e18e6d"; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(ax + dir * 2, ay + (6 - 2 * forward) * near, 6 * near, (3.5 + 8 * forward) * near, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // The knee dial beside the shoulder: its foot follows the knee.
  drawDialBase(ctx, demoDial(side), state.progress, "Knee angle", true);
  drawDialFoot(ctx, demoDial(side), state.progress);
  ctx.restore();
}

/** The demonstration's circle on its dial, in canvas pixels: the goal while straightening, resting while lowering. */
export function kneeGhostTarget(width: number, height: number, returning: boolean, side: Side = "right") {
  const s = Math.min(width / 300, height / 270);
  const p = dialPx(demoDial(side), returning ? 0 : DIAL_GOAL_DEG);
  return { x: (width - 300 * s) / 2 + p.x * s, y: (height - 270 * s) / 2 + p.y * s, radius: DIAL_CIRCLE_SHARE * DEMO_DIAL.r * s };
}

/** The instant the dial's foot enters its circle as the demonstration moves. */
function contactStartMs(returning: boolean) {
  const d = demoDial("right"), target = dialPx(d, returning ? 0 : DIAL_GOAL_DEG), radius = DIAL_CIRCLE_SHARE * d.r;
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    const foot = dialPx(d, dialDegrees(poseAt(middle, returning)));
    if (Math.hypot(foot.x - target.x, foot.y - target.y) <= radius) high = middle;
    else low = middle;
  }
  return high * MOVE_MS;
}
const CONTACT_MS = [contactStartMs(false), contactStartMs(true)];

export const kneeDemoDuration = (returning: boolean) => CONTACT_MS[returning ? 1 : 0] + TARGET_HOLD_MS + TARGET_COMPLETION_MS;

/** The simulated patient is on target at the end of each movement (level 1 is the goal, 0 resting). */
export function kneeGhostContact(level: number, returning: boolean): boolean {
  return returning ? level <= 0.05 : level >= 0.95;
}

export function kneeDemoState(elapsedMs: number, returning: boolean, armed = true) {
  const elapsed = armed ? Math.max(0, elapsedMs) : 0;
  const reached = CONTACT_MS[returning ? 1 : 0];
  const contact = armed && elapsed >= reached;
  const progress = contact ? unit((elapsed - reached) / TARGET_HOLD_MS) : 0;
  const completionElapsedMs = elapsed - reached - TARGET_HOLD_MS;
  const phase = !armed ? "waiting" : !contact ? "move" : progress < 1 ? "hold" : "complete";
  const pose = poseAt(unit(elapsed / MOVE_MS), returning);
  const t = dialPx(demoDial("right"), returning ? 0 : DIAL_GOAL_DEG);
  const target: [number, number] = [t.x, t.y];
  const label = returning ? "Foot down" : "Straighten";
  const instruction = !armed ? "Listen to the instruction. The circle will become active when the voice finishes."
    : phase === "complete" ? returning ? "Foot down complete" : "Knee straight enough — now lower your foot slowly"
    : phase === "hold" ? `${returning ? "Rest your foot on the floor" : "Hold your knee straight"} · ${Math.round(progress * 100)}%`
    : returning ? "Bend your knee and lower your foot slowly to the floor"
    : "Straighten your knee toward the camera and a little out to the side, along the arrow. The knee dial moves with the knee, toward its circle";
  return { pose, target, radius: DIAL_CIRCLE_SHARE * DEMO_DIAL.r, armed, contact, progress, completionElapsedMs, phase, label, instruction };
}

export function drawKneeDemo(ctx: CanvasRenderingContext2D, elapsedMs: number, returning: boolean, width: number, height: number, now: number, reducedMotion = false, armed = true, side: Side = "right") {
  const state = kneeDemoState(elapsedMs, returning, armed);
  drawKneeScene(ctx, width, height, { progress: state.pose, lowering: returning, side, arrow: true, armed, now, reducedMotion });
  const { x, y, radius } = kneeGhostTarget(width, height, returning, side);
  if (state.phase === "complete") {
    drawTargetCompletion(ctx, { x, y, radius, elapsed: Math.min(state.completionElapsedMs, TARGET_COMPLETION_MS - 1), now, reducedMotion: reducedMotion || state.completionElapsedMs >= TARGET_COMPLETION_MS });
  } else {
    drawTestingTarget(ctx, { x, y, radius, armed, contact: state.contact, progress: state.progress, now, reducedMotion });
  }
  ctx.save();
  ctx.font = "600 12px Manrope, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = state.contact ? "#285b49" : "#a14d32";
  // Under the circle, kept inside the canvas (the dial sits near its edge).
  const text = state.phase === "complete" ? "Complete" : state.label, half = ctx.measureText(text).width / 2;
  ctx.fillText(text, clamp(x, half + 4, Math.max(half + 4, width - half - 4)), y + radius + 16);
  ctx.restore();
}
